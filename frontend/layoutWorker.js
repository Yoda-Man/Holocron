/**
 * layoutWorker.js — Holocron VR Layout Web Worker
 *
 * Bridges the main thread (which sends normalized graph data) with the WASM
 * layout engine (which computes 3D positions). Falls back to a pure-JS
 * force-directed simulation when WASM is unavailable or fails.
 *
 * ── Message Protocol ─────────────────────────────────────────────────────
 *
 * Main → Worker:
 *   { type: "layout",   nodes: GraphNode[], edges: GraphEdge[], config: object }
 *   { type: "refine",   maxIterations: number }
 *   { type: "abort" }
 *
 * Worker → Main:
 *   { type: "ready" }
 *   { type: "progress", phase: string, pct: number }
 *   { type: "result",   positions: Float32Array (Transferable), nodeCount: number,
 *                        layoutTimeMs: number, engine: "wasm" | "js" }
 *   { type: "partial",  positions: Float32Array (Transferable), energy: number }
 *   { type: "error",    code: number, message: string, fallback: boolean }
 *
 * ── Data Flow ────────────────────────────────────────────────────────────
 *
 *   main.js ──{ nodes, edges, config }──▶ layoutWorker.js
 *                                            │
 *                                            ├─▶ init_graph() ──▶ populate buffers
 *                                            ├─▶ compute_layout()
 *                                            ├─▶ read positions (zero-copy)
 *                                            ├─▶ postMessage(Transferable)
 *                                            │
 *                                            └─▶ WASM fail? ──▶ JS fallback
 *
 * @see 04-WASM-Spec.md §5.1 — WASM call sequence
 * @see 04-WASM-Spec.md §8   — JS fallback behaviour
 * @see 02-TSD.md §6.3       — Force-directed algorithm spec
 */

// ─── Module-level State ─────────────────────────────────────────────────

/** WASM module instance (Emscripten-wrapped), or null if not loaded. */
let Module = null;

/** Whether the WASM module loaded successfully. */
let wasmAvailable = false;

/** Current graph data — retained for refinement calls. */
let currentNodes = [];
let currentEdges = [];
let currentNodeCount = 0;
let currentEdgeCount = 0;

/** Abort flag — set by "abort" message. */
let abortRequested = false;

/** Performance timestamps. */
let layoutStartTime = 0;

// ─── WASM Error Codes (04-WASM-Spec.md §6) ─────────────────────────────

const ERR_CODES = {
  0: { label: 'LAYOUT_OK',        fallback: false },
  1: { label: 'ERR_ALLOC_NODES',  fallback: true  },
  2: { label: 'ERR_ALLOC_EDGES',  fallback: true  },
  3: { label: 'ERR_ALLOC_TEMP',   fallback: true  },
  4: { label: 'ERR_INVALID_GRAPH', fallback: false },
  5: { label: 'ERR_INVALID_EDGE',  fallback: false },
  6: { label: 'ERR_TIMEOUT',       fallback: false },
  7: { label: 'ERR_NOT_INITIALISED', fallback: false },
};

// ═════════════════════════════════════════════════════════════════════════
//  WASM MODULE LOADING
// ═════════════════════════════════════════════════════════════════════════

/**
 * Attempt to load the WASM layout engine module.
 *
 * The module is built by Emscripten with MODULARIZE=1 + EXPORT_ES6=1,
 * producing an ES module whose default export is a factory function.
 * The factory returns a Promise that resolves to the Module instance.
 *
 * On failure, wasmAvailable remains false and all layout requests fall
 * back to the pure-JS implementation (04-WASM-Spec.md §8).
 */
async function loadWasmModule() {
  try {
    const moduleFactory = (
      await import(/* webpackIgnore: true */ './layout_engine.mjs')
    ).default;

    Module = await moduleFactory();

    // Verify that all required exports are present
    const required = [
      'init_graph', 'get_node_input_ptr', 'get_edge_input_ptr',
      'compute_layout', 'get_positions_ptr', 'update_positions',
      'get_node_count', 'free_memory',
      'set_convergence_threshold', 'set_repulsion_k',
      'set_attraction_k', 'set_damping', 'set_max_iterations',
      'set_scene_radius',
    ];

    const missing = required.filter((name) => typeof Module[name] !== 'function');
    if (missing.length > 0) {
      throw new Error(`WASM module missing exports: ${missing.join(', ')}`);
    }

    wasmAvailable = true;
    console.log('[VR] WASM layout engine loaded');
    return true;
  } catch (err) {
    console.warn('[VR] WASM layout unavailable; falling back to JS', err);
    Module = null;
    wasmAvailable = false;
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  WASM LAYOUT — Call Sequence (04-WASM-Spec.md §5.1)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Run the layout using the WASM engine.
 *
 * Steps (per §5.1):
 *   1. Apply configuration
 *   2. Allocate WASM buffers via init_graph()
 *   3. Populate node buffer via get_node_input_ptr() + HEAPF32 view
 *   4. Populate edge buffer via get_edge_input_ptr() + HEAP32 view
 *   5. Run compute_layout()
 *   6. Read output positions via get_positions_ptr() (zero-copy)
 *   7. Transfer positions back to main thread (Transferable)
 *   8. Release WASM memory
 *
 * @param {object} config — Algorithm parameters
 * @returns {object} { positions: Float32Array, nodeCount: number, layoutTimeMs: number }
 * @throws {Error} On WASM error codes that should trigger fallback
 */
function runWasmLayout(config) {
  const t0 = performance.now();

  // ── Step 1: Apply configuration (§5.1 Step 3) ─────────────────────
  if (config.convergenceDelta !== undefined)
    Module.set_convergence_threshold(config.convergenceDelta);
  if (config.repulsionK !== undefined)
    Module.set_repulsion_k(config.repulsionK);
  if (config.attractionK !== undefined)
    Module.set_attraction_k(config.attractionK);
  if (config.damping !== undefined)
    Module.set_damping(config.damping);
  if (config.maxIterations !== undefined)
    Module.set_max_iterations(config.maxIterations);
  if (config.sceneRadius !== undefined)
    Module.set_scene_radius(config.sceneRadius);

  // ── Step 2: Allocate buffers (§5.1 Step 4) ───────────────────────
  const initResult = Module.init_graph(currentNodeCount, currentEdgeCount);
  if (initResult !== 0) {
    const info = ERR_CODES[initResult] || { label: 'UNKNOWN', fallback: true };
    throw new Error(
      `WASM init_graph failed: ${info.label} (${initResult})`
    );
  }

  // ── Step 3: Populate node buffer (§5.1 Step 5) ───────────────────
  // Memory layout per node (7 × float32 = 28 bytes):
  //   [0] seedX      [1] seedY      [2] seedZ
  //   [3] mass       [4] clusterId  [5] importance  [6] reserved
  const nodePtr = Module.get_node_input_ptr();
  const nodeHeap = new Float32Array(
    Module.HEAPF32.buffer, nodePtr, currentNodeCount * 7
  );

  for (let i = 0; i < currentNodeCount; i++) {
    const node = currentNodes[i];
    const base = i * 7;
    // Seed positions are initial cluster centroids (computed by graphProcessor
    // extractClusters; currently set to origin — the macro layout phase in
    // compute_layout() handles initial placement).
    nodeHeap[base + 0] = node.seedX ?? 0;
    nodeHeap[base + 1] = node.seedY ?? 0;
    nodeHeap[base + 2] = node.seedZ ?? 0;
    nodeHeap[base + 3] = 1.0 + 0.01 * (node.size ?? 0);        // mass
    nodeHeap[base + 4] = node.clusterId ?? -1;                   // cluster_id
    nodeHeap[base + 5] = node.importance ?? 0;                   // importance
    nodeHeap[base + 6] = 0;                                      // reserved
  }

  // ── Step 4: Populate edge buffer (§5.1 Step 6) ───────────────────
  // Memory layout per edge (3 × int32 = 12 bytes):
  //   [0] source_index  [1] target_index  [2] weight
  const edgePtr = Module.get_edge_input_ptr();
  const edgeHeap = new Int32Array(
    Module.HEAP32.buffer, edgePtr, currentEdgeCount * 3
  );

  for (let i = 0; i < currentEdgeCount; i++) {
    const edge = currentEdges[i];
    const base = i * 3;
    edgeHeap[base + 0] = edge.sourceIdx;   // index into node array
    edgeHeap[base + 1] = edge.targetIdx;
    edgeHeap[base + 2] = edge.weight ?? 1;
  }

  // ── Step 5: Run layout (§5.1 Step 7) ─────────────────────────────
  const layoutResult = Module.compute_layout();
  if (layoutResult !== 0) {
    Module.free_memory();
    const info = ERR_CODES[layoutResult] || { label: 'UNKNOWN', fallback: true };
    throw new Error(
      `WASM compute_layout failed: ${info.label} (${layoutResult})`
    );
  }

  // ── Step 6: Read output positions (§5.1 Step 8) ──────────────────
  // Zero-copy: we create a Float32Array view into WASM heap memory,
  // then slice the ArrayBuffer for transfer.
  const posPtr = Module.get_positions_ptr();
  const count = Module.get_node_count();
  const positionsView = new Float32Array(
    Module.HEAPF32.buffer, posPtr, count * 3
  );

  // ── Step 7: Copy + transfer (§5.1 Step 9) ────────────────────────
  // We must copy the data out of WASM heap because free_memory() will
  // release the underlying memory. Use slice() which creates a new
  // ArrayBuffer and copies the data.
  const byteLength = count * 3 * Float32Array.BYTES_PER_ELEMENT;
  const positions = new Float32Array(positionsView.slice());

  const t1 = performance.now();

  // ── Step 8: Release WASM memory (§5.1 Step 10) ───────────────────
  Module.free_memory();

  return { positions, nodeCount: count, layoutTimeMs: t1 - t0 };
}

// ═════════════════════════════════════════════════════════════════════════
//  PURE-JS FALLBACK LAYOUT (04-WASM-Spec.md §8)
// ═════════════════════════════════════════════════════════════════════════
//
// Simplified force-directed simulation for debugging and environments
// where WASM cannot be loaded. Implements the same algorithm as the WASM
// version (02-TSD.md §6.3) but in plain JavaScript.
//
// Performance: ~10× slower than WASM. Acceptable for < 500 nodes.
// Shows a warning toast in the UI when used.

/**
 * Default configuration for the JS fallback layout.
 */
const JS_FALLBACK_CONFIG = {
  repulsionK: 1.0,
  attractionK: 0.1,
  damping: 0.85,
  convergenceDelta: 0.001,
  maxIterations: 500,
};

/**
 * Run force-directed layout in pure JavaScript.
 *
 * Implements the algorithm from 02-TSD.md §6.3:
 *   1. Repulsion: O(n²) all-pairs within cluster, F = K_rep / dist²
 *   2. Attraction: along edges, F = dist · K_att · weight
 *   3. Integration: v = (v + F) · damping; pos += v
 *   4. Convergence: sum(|velocity|) < threshold × nodeCount
 *   5. Cluster sphere constraint
 *
 * @param {object}   config        — Algorithm parameters
 * @param {Function} [onProgress]  — Called each iteration with { iter, energy }
 * @returns {object} { positions: Float32Array, nodeCount: number, layoutTimeMs: number }
 */
function runJsLayout(config, onProgress) {
  const t0 = performance.now();
  const repK  = config.repulsionK  ?? JS_FALLBACK_CONFIG.repulsionK;
  const attK  = config.attractionK ?? JS_FALLBACK_CONFIG.attractionK;
  const damp  = config.damping     ?? JS_FALLBACK_CONFIG.damping;
  const delta = config.convergenceDelta ?? JS_FALLBACK_CONFIG.convergenceDelta;
  const maxIt = config.maxIterations    ?? JS_FALLBACK_CONFIG.maxIterations;

  const N = currentNodeCount;
  const E = currentEdges.length;

  // ── Initialise position and velocity arrays ──────────────────────
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);

  // Seed positions from node data (or random if not provided)
  for (let i = 0; i < N; i++) {
    const node = currentNodes[i];
    pos[i * 3 + 0] = node.seedX ?? (Math.random() - 0.5) * 10;
    pos[i * 3 + 1] = node.seedY ?? (Math.random() - 0.5) * 10;
    pos[i * 3 + 2] = node.seedZ ?? (Math.random() - 0.5) * 10;
  }

  // ── Pre-extract cluster and mass data ────────────────────────────
  const clusterIds = new Int32Array(N);
  const masses = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    clusterIds[i] = currentNodes[i].clusterId ?? -1;
    masses[i] = 1.0 + 0.01 * (currentNodes[i].size ?? 0);
  }

  // ── Compute cluster centroids from current positions ─────────────
  // Group nodes by cluster, compute average position per cluster.
  const clusterCentroids = new Map();
  const clusterRadii = new Map();

  for (let i = 0; i < N; i++) {
    const cid = clusterIds[i];
    if (cid < 0) continue;
    if (!clusterCentroids.has(cid)) {
      clusterCentroids.set(cid, { x: 0, y: 0, z: 0, count: 0, maxDist: 0 });
    }
    const c = clusterCentroids.get(cid);
    c.x += pos[i * 3 + 0];
    c.y += pos[i * 3 + 1];
    c.z += pos[i * 3 + 2];
    c.count++;
  }

  // Finalise centroids
  for (const [cid, c] of clusterCentroids) {
    c.x /= c.count;
    c.y /= c.count;
    c.z /= c.count;
  }

  // Compute radii (max distance from centroid)
  for (let i = 0; i < N; i++) {
    const cid = clusterIds[i];
    if (cid < 0) continue;
    const c = clusterCentroids.get(cid);
    const dx = pos[i * 3 + 0] - c.x;
    const dy = pos[i * 3 + 1] - c.y;
    const dz = pos[i * 3 + 2] - c.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > c.maxDist) c.maxDist = dist;
  }

  for (const [cid, c] of clusterCentroids) {
    clusterRadii.set(cid, c.maxDist + 1.0);  // Add padding
  }

  const minDist = 0.01;
  const minDistSq = minDist * minDist;
  const convThreshold = delta * N;

  // ── Force simulation loop ────────────────────────────────────────
  let totalEnergy = Infinity;
  let iteration;

  for (iteration = 0; iteration < maxIt; iteration++) {
    // ── Zero force accumulator ─────────────────────────────────────
    const forces = new Float32Array(N * 3);

    // ── Repulsion: O(n²) all-pairs within same cluster ─────────────
    for (let a = 0; a < N; a++) {
      const cidA = clusterIds[a];
      const posA_x = pos[a * 3 + 0];
      const posA_y = pos[a * 3 + 1];
      const posA_z = pos[a * 3 + 2];
      let fA_x = 0, fA_y = 0, fA_z = 0;

      for (let b = a + 1; b < N; b++) {
        if (clusterIds[b] !== cidA) continue;

        const dx = posA_x - pos[b * 3 + 0];
        const dy = posA_y - pos[b * 3 + 1];
        const dz = posA_z - pos[b * 3 + 2];
        let dsq = dx * dx + dy * dy + dz * dz;

        if (dsq < minDistSq) dsq = minDistSq;

        const invDist = 1.0 / Math.sqrt(dsq);
        const forceMag = repK * invDist * invDist;  // K / dist²
        const fx = dx * invDist * forceMag;
        const fy = dy * invDist * forceMag;
        const fz = dz * invDist * forceMag;

        fA_x += fx; fA_y += fy; fA_z += fz;
        forces[b * 3 + 0] -= fx;
        forces[b * 3 + 1] -= fy;
        forces[b * 3 + 2] -= fz;
      }

      forces[a * 3 + 0] += fA_x;
      forces[a * 3 + 1] += fA_y;
      forces[a * 3 + 2] += fA_z;
    }

    // ── Attraction along edges ─────────────────────────────────────
    for (let i = 0; i < E; i++) {
      const edge = currentEdges[i];
      const s = edge.sourceIdx;
      const t = edge.targetIdx;
      if (s < 0 || s >= N || t < 0 || t >= N) continue;
      const w = edge.weight ?? 1;
      if (w <= 0) continue;

      const dx = pos[t * 3 + 0] - pos[s * 3 + 0];
      const dy = pos[t * 3 + 1] - pos[s * 3 + 1];
      const dz = pos[t * 3 + 2] - pos[s * 3 + 2];
      let dsq = dx * dx + dy * dy + dz * dz;

      if (dsq < minDistSq) dsq = minDistSq;

      const dist = Math.sqrt(dsq);
      const forceMag = dist * attK * w;
      const fx = (dx / dist) * forceMag;
      const fy = (dy / dist) * forceMag;
      const fz = (dz / dist) * forceMag;

      forces[s * 3 + 0] += fx;
      forces[s * 3 + 1] += fy;
      forces[s * 3 + 2] += fz;
      forces[t * 3 + 0] -= fx;
      forces[t * 3 + 1] -= fy;
      forces[t * 3 + 2] -= fz;
    }

    // ── Integration: position += velocity; velocity *= damping ─────
    totalEnergy = 0;

    for (let i = 0; i < N; i++) {
      const invMass = 1.0 / masses[i];

      vel[i * 3 + 0] = (vel[i * 3 + 0] + forces[i * 3 + 0] * invMass) * damp;
      vel[i * 3 + 1] = (vel[i * 3 + 1] + forces[i * 3 + 1] * invMass) * damp;
      vel[i * 3 + 2] = (vel[i * 3 + 2] + forces[i * 3 + 2] * invMass) * damp;

      pos[i * 3 + 0] += vel[i * 3 + 0];
      pos[i * 3 + 1] += vel[i * 3 + 1];
      pos[i * 3 + 2] += vel[i * 3 + 2];

      totalEnergy += Math.abs(vel[i * 3 + 0])
                   + Math.abs(vel[i * 3 + 1])
                   + Math.abs(vel[i * 3 + 2]);

      // ── Cluster sphere constraint ────────────────────────────────
      const cid = clusterIds[i];
      if (cid >= 0 && clusterCentroids.has(cid)) {
        const cx = clusterCentroids.get(cid).x;
        const cy = clusterCentroids.get(cid).y;
        const cz = clusterCentroids.get(cid).z;
        const radius = clusterRadii.get(cid) || 10.0;

        const dx = pos[i * 3 + 0] - cx;
        const dy = pos[i * 3 + 1] - cy;
        const dz = pos[i * 3 + 2] - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (d > radius) {
          const scale = radius / d;
          pos[i * 3 + 0] = cx + dx * scale;
          pos[i * 3 + 1] = cy + dy * scale;
          pos[i * 3 + 2] = cz + dz * scale;
        }
      }
    }

    // ── Progress callback (for partial updates) ────────────────────
    if (onProgress) {
      onProgress({
        iteration,
        energy: totalEnergy,
        converged: totalEnergy < convThreshold,
      });
    }

    // ── Convergence check ──────────────────────────────────────────
    if (totalEnergy < convThreshold) break;
  }

  const t1 = performance.now();

  return {
    positions: pos,
    nodeCount: N,
    layoutTimeMs: t1 - t0,
    iterations: iteration + 1,
    finalEnergy: totalEnergy,
  };
}

// ═════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ═════════════════════════════════════════════════════════════════════════

/**
 * Handle an incoming "layout" message from the main thread.
 *
 * @param {object} data — { nodes: GraphNode[], edges: GraphEdge[], config: object }
 */
function handleLayoutMessage(data) {
  abortRequested = false;
  currentNodes = data.nodes ?? [];
  currentEdges = data.edges ?? [];
  currentNodeCount = currentNodes.length;
  currentEdgeCount = currentEdges.length;
  const config = data.config ?? {};

  // Validate graph
  if (currentNodeCount === 0) {
    self.postMessage({
      type: 'error',
      code: 4,
      message: 'Graph has no nodes — nothing to layout',
      fallback: false,
    });
    return;
  }

  // Report progress
  self.postMessage({
    type: 'progress',
    phase: wasmAvailable ? 'wasm_layout' : 'js_layout',
    pct: 0,
  });

  layoutStartTime = performance.now();

  try {
    let result;

    if (wasmAvailable) {
      // ── WASM path ────────────────────────────────────────────────
      result = runWasmLayout(config);
      result.engine = 'wasm';
    } else {
      // ── JS fallback path ─────────────────────────────────────────
      result = runJsLayout(config, (progress) => {
        // Send partial progress updates
        const pct = Math.min(
          99,
          Math.round((progress.iteration / (config.maxIterations ?? 500)) * 100)
        );
        self.postMessage({
          type: 'progress',
          phase: 'js_layout',
          pct,
          energy: progress.energy,
          iteration: progress.iteration,
        });
      });
      result.engine = 'js';
    }

    if (abortRequested) return;

    // ── Send result back to main thread (Transferable) ─────────────
    const layoutTimeMs = performance.now() - layoutStartTime;
    const posBuffer = result.positions.buffer;

    self.postMessage(
      {
        type: 'result',
        positions: result.positions,
        nodeCount: result.nodeCount,
        layoutTimeMs,
        engine: result.engine,
        iterations: result.iterations,
        finalEnergy: result.finalEnergy,
      },
      [posBuffer] // Transfer ownership — zero-copy to main thread
    );

    console.log(
      `[VR] Layout complete: ${result.nodeCount} nodes in ` +
      `${layoutTimeMs.toFixed(1)} ms (${result.engine})`
    );
  } catch (err) {
    if (abortRequested) return;

    // ── WASM failed — attempt JS fallback ──────────────────────────
    const wasmError = err.message;

    // Check if this error code allows fallback
    const codeMatch = wasmError.match(/\((\d+)\)$/);
    const errCode = codeMatch ? parseInt(codeMatch[1], 10) : -1;
    const errInfo = ERR_CODES[errCode];

    if (errInfo?.fallback) {
      console.warn(`[VR] WASM layout failed (${errInfo.label}); falling back to JS`, err);
      self.postMessage({
        type: 'error',
        code: errCode,
        message: `WASM failed: ${errInfo.label}. Falling back to JS layout.`,
        fallback: true,
      });

      // Retry with JS
      try {
        let result = runJsLayout(config, (progress) => {
          self.postMessage({
            type: 'progress',
            phase: 'js_layout_fallback',
            pct: Math.round((progress.iteration / (config.maxIterations ?? 500)) * 100),
            energy: progress.energy,
          });
        });
        result.engine = 'js';

        if (abortRequested) return;

        const layoutTimeMs = performance.now() - layoutStartTime;
        self.postMessage(
          {
            type: 'result',
            positions: result.positions,
            nodeCount: result.nodeCount,
            layoutTimeMs,
            engine: 'js',
            note: 'JS fallback after WASM failure',
          },
          [result.positions.buffer]
        );
      } catch (fallbackErr) {
        self.postMessage({
          type: 'error',
          code: -1,
          message: `Both WASM and JS layout failed: ${fallbackErr.message}`,
          fallback: false,
        });
      }
    } else {
      // Non-fallback error — send to main thread as fatal
      self.postMessage({
        type: 'error',
        code: errCode >= 0 ? errCode : -1,
        message: wasmError,
        fallback: false,
      });
    }
  }
}

/**
 * Handle a "refine" message — runs additional iterations on the current
 * layout (04-WASM-Spec.md §5.2).
 *
 * @param {object} data — { maxIterations: number }
 */
function handleRefineMessage(data) {
  if (!wasmAvailable || !Module || currentNodeCount === 0) {
    // JS fallback doesn't support streaming refinement
    self.postMessage({
      type: 'error',
      code: -1,
      message: 'Refinement not available in JS fallback mode',
      fallback: false,
    });
    return;
  }

  const maxIter = data.maxIterations ?? 50;

  try {
    const energy = Module.update_positions(maxIter);

    const posPtr = Module.get_positions_ptr();
    const count = Module.get_node_count();
    const partial = new Float32Array(Module.HEAPF32.buffer, posPtr, count * 3).slice();

    self.postMessage(
      {
        type: 'partial',
        positions: partial,
        nodeCount: count,
        energy,
        engine: 'wasm',
      },
      [partial.buffer]
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      code: -1,
      message: `Refinement failed: ${err.message}`,
      fallback: false,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  WORKER INITIALISATION
// ═════════════════════════════════════════════════════════════════════════

/**
 * Worker message dispatcher.
 *
 * @param {MessageEvent} event — { data: { type, ... } }
 */
self.onmessage = async function (event) {
  const { type, ...data } = event.data;

  switch (type) {
    case 'layout':
      // Ensure WASM is loaded (first call loads it; subsequent calls skip)
      if (!wasmAvailable && Module === null) {
        await loadWasmModule();
      }
      handleLayoutMessage(data);
      break;

    case 'refine':
      handleRefineMessage(data);
      break;

    case 'abort':
      abortRequested = true;
      // Free WASM memory if allocated
      if (Module && typeof Module.free_memory === 'function') {
        try { Module.free_memory(); } catch { /* ignore */ }
      }
      break;

    default:
      console.warn(`[VR] Unknown message type: ${type}`);
  }
};

// Signal that the worker is alive
self.postMessage({ type: 'ready', wasmAvailable: false });

// Kick off WASM loading immediately so it's warm by the time the first
// layout request arrives.
loadWasmModule().then((loaded) => {
  self.postMessage({ type: 'ready', wasmAvailable: loaded });
});
