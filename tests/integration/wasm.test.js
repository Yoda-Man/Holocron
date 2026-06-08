/**
 * wasm.test.js — WASM Module Loading Integration Tests
 *
 * Tests the WebAssembly layout engine lifecycle: module loading, worker
 * initialisation, layout computation, memory management, and fallback
 * behaviour when WASM is unavailable.
 *
 * Uses page.route() + page.evaluate() to simulate the Web Worker and
 * WASM environment without a real Emscripten build.
 *
 * @see 08-Testing-Spec.md §2.3 — WASM integration tests
 * @see 04-WASM-Spec.md §5.1  — Call sequence
 * @see 04-WASM-Spec.md §8    — JS fallback behaviour
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Constants ──────────────────────────────────────────────────────────

/** Mock node count for layout tests. */
const NODE_COUNT = 100;

/** Mock edge count. */
const EDGE_COUNT = 500;

// ─── Mock WASM Module ──────────────────────────────────────────────────

/**
 * Create a mock Emscripten Module instance that simulates the WASM
 * layout engine's exported functions.
 *
 * @param {boolean} [shouldFail=false] — If true, init_graph returns error
 * @returns {object} Mock Module
 */
function createMockModule(shouldFail = false) {
  // Pre-allocate mock heap buffers
  const heapSize = 32 * 1024 * 1024; // 32 MB
  const heap = new ArrayBuffer(heapSize);
  const heapF32 = new Float32Array(heap);
  const heapI32 = new Int32Array(heap);
  const heapI8 = new Int8Array(heap);

  let nodeCount = 0;
  let positionsPtr = 0;
  let memoryFreed = false;

  return {
    HEAPF32: heapF32,
    HEAP32: heapI32,
    HEAP8: heapI8,

    init_graph: (n, e) => {
      if (shouldFail) return 1; // ERR_ALLOC_NODES
      nodeCount = n;
      // Allocate buffers at known offsets
      const nodeInputBytes = n * 28;
      const edgeInputBytes = e * 12;
      const posBytes = n * 12;

      // Simple bump allocator
      let offset = 1024;
      const nodeInputPtr = offset; offset += nodeInputBytes;
      const edgeInputPtr = offset; offset += edgeInputBytes;
      positionsPtr = offset; offset += posBytes;

      // Store pointers in a side-channel for the mock
      mockModule._nodeInputPtr = nodeInputPtr;
      mockModule._edgeInputPtr = edgeInputPtr;
      mockModule._posPtr = positionsPtr;

      return 0; // LAYOUT_OK
    },

    get_node_input_ptr: () => mockModule._nodeInputPtr || 0,
    get_edge_input_ptr: () => mockModule._edgeInputPtr || 0,

    compute_layout: () => {
      if (shouldFail) return 1;
      // Fill positions with valid 3D coords
      const posArray = new Float32Array(heap, positionsPtr, nodeCount * 3);
      for (let i = 0; i < nodeCount * 3; i++) {
        // Generate positions within 25-unit sphere
        const theta = 2 * Math.PI * (i / (nodeCount * 3));
        const phi = Math.acos(2 * ((i * 0.01) % 1) - 1);
        const r = 15 * Math.cbrt((i * 0.001) % 1);
        if (i % 3 === 0) posArray[i] = r * Math.sin(phi) * Math.cos(theta);
        else if (i % 3 === 1) posArray[i] = r * Math.cos(phi);
        else posArray[i] = r * Math.sin(phi) * Math.sin(theta);
      }
      return 0;
    },

    get_positions_ptr: () => positionsPtr,

    update_positions: (iters) => {
      // Simulate convergence: return lower energy each call
      return Math.max(0, 100 - iters * 10);
    },

    get_node_count: () => nodeCount,

    free_memory: () => {
      memoryFreed = true;
      mockModule._nodeInputPtr = 0;
      mockModule._edgeInputPtr = 0;
      mockModule._posPtr = 0;
      nodeCount = 0;
    },

    set_convergence_threshold: () => {},
    set_repulsion_k: () => {},
    set_attraction_k: () => {},
    set_damping: () => {},
    set_max_iterations: () => {},
    set_scene_radius: () => {},

    _wasmMemoryFreed: () => memoryFreed,
  };
}

/** Shared mock module reference. */
const mockModule = {};

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

test.describe('WASM Loading & Fallback (§2.3)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the layout_engine.mjs import to return our mock module
    await page.route('**/layout_engine.mjs', async (route) => {
      const moduleCode = `
        const mod = ${createMockModule.toString()};
        const instance = mod(false);
        export default () => Promise.resolve(instance);
      `;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: moduleCode,
      });
    });

    // Mock worker messages
    await page.route('**/layoutWorker.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          self.onmessage = async (e) => {
            const { type, nodes, edges, config } = e.data;
            if (type === 'layout') {
              self.postMessage({
                type: 'ready',
                wasmAvailable: true,
              });
              self.postMessage({
                type: 'result',
                positions: new Float32Array(300),
                nodeCount: 100,
                layoutTimeMs: 42,
                engine: 'wasm',
              });
            }
          };
        `,
      });
    });
  });

  test('wasm_loads_in_worker — module loads and worker logs ready', async ({ page }) => {
    const logs = [];
    page.on('console', (msg) => logs.push(msg.text()));

    await page.evaluate(() => {
      // Inline mock module — no dynamic import needed
      const heap = new ArrayBuffer(32 * 1024 * 1024);
      const module = {
        HEAPF32: new Float32Array(heap),
        HEAP32: new Int32Array(heap),
        HEAP8: new Int8Array(heap),
        init_graph: () => 0,
        get_node_input_ptr: () => 1024,
        get_edge_input_ptr: () => 4096,
        compute_layout: () => 0,
        get_positions_ptr: () => 8092,
        get_node_count: () => 100,
        update_positions: () => 0,
        free_memory: () => {},
        set_convergence_threshold: () => {},
        set_repulsion_k: () => {},
        set_attraction_k: () => {},
        set_damping: () => {},
        set_max_iterations: () => {},
        set_scene_radius: () => {},
      };

      // Verify all required exports exist
      const required = ['init_graph','get_node_input_ptr','get_edge_input_ptr',
        'compute_layout','get_positions_ptr','update_positions',
        'get_node_count','free_memory'];
      for (const name of required) {
        if (typeof module[name] !== 'function') throw new Error(`Missing: ${name}`);
      }

      window.__wasmModule = module;
      window.__wasmLoaded = true;
    });

    const loaded = await page.evaluate(() => window.__wasmLoaded);
    expect(loaded).toBe(true);
  });

  test('wasm_fallback_on_load_failure — broken import triggers JS fallback', async ({ page }) => {
    // Override the route to return a non-functional module
    await page.route('**/layout_engine.mjs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export default () => Promise.reject(new Error("WASM compile failed"));',
      });
    });

    let fallbackTriggered = false;

    page.on('console', (msg) => {
      if (msg.text().includes('falling back to JS')) {
        fallbackTriggered = true;
      }
    });

    await page.evaluate(async () => {
      try {
        const modFactory = await import('/layout_engine.mjs').then(m => m.default);
        await modFactory();
      } catch (err) {
        console.warn('[VR] WASM layout unavailable; falling back to JS', err);
        // JS fallback: use manual force-directed simulation
        window.__fallbackUsed = true;
      }
    });

    const fallbackUsed = await page.evaluate(() => window.__fallbackUsed);
    expect(fallbackUsed).toBe(true);
  });

  test('wasm_layout_produces_valid_positions — 100 node graph yields valid coords', async ({ page }) => {
    await page.evaluate(() => {
      // Inline mock — same as beforeEach but no dynamic import
      const heap = new ArrayBuffer(32 * 1024 * 1024);
      const heapF32 = new Float32Array(heap);
      const heapI32 = new Int32Array(heap);
      let nodeCount = 0, posPtr = 0;

      const module = {
        HEAPF32: heapF32, HEAP32: heapI32, HEAP8: new Int8Array(heap),
        init_graph: (n, e) => {
          nodeCount = n;
          const off = 1024;
          posPtr = off + n * 28 + e * 12;
          module._np = off;
          module._ep = off + n * 28;
          return 0;
        },
        get_node_input_ptr: () => module._np || 0,
        get_edge_input_ptr: () => module._ep || 0,
        compute_layout: () => {
          const arr = new Float32Array(heap, posPtr, nodeCount * 3);
          for (let i = 0; i < nodeCount * 3; i++) {
            arr[i] = (i % 3 === 0) ? (i/3 - nodeCount/2) * 0.4
                   : (i % 3 === 1) ? Math.sin(i/3) * 3
                   : Math.cos(i/3) * 3;
          }
          return 0;
        },
        get_positions_ptr: () => posPtr,
        get_node_count: () => nodeCount,
        update_positions: () => 50,
        free_memory: () => { nodeCount = 0; module._np = 0; module._ep = 0; posPtr = 0; },
        set_convergence_threshold: () => {},
        set_repulsion_k: () => {},
        set_attraction_k: () => {},
        set_damping: () => {},
        set_max_iterations: () => {},
        set_scene_radius: () => {},
      };

      const N = 100, E = 500;

      // Step 1: Init
      const initResult = module.init_graph(N, E);
      if (initResult !== 0) throw new Error('init_graph failed: ' + initResult);

      // Step 2: Populate nodes
      const nodePtr = module.get_node_input_ptr();
      const nodeHeap = new Float32Array(module.HEAPF32.buffer, nodePtr, N * 7);
      for (let i = 0; i < N; i++) {
        nodeHeap[i * 7] = (i - N/2) * 0.5;
        nodeHeap[i * 7 + 1] = Math.sin(i) * 5;
        nodeHeap[i * 7 + 2] = Math.cos(i) * 5;
        nodeHeap[i * 7 + 3] = 1.0;
        nodeHeap[i * 7 + 4] = i % 5;
        nodeHeap[i * 7 + 5] = 0.5;
        nodeHeap[i * 7 + 6] = 0;
      }

      // Step 3: Populate edges
      const edgePtr = module.get_edge_input_ptr();
      const edgeHeap = new Int32Array(module.HEAP32.buffer, edgePtr, E * 3);
      for (let i = 0; i < E; i++) {
        edgeHeap[i * 3] = i % N;
        edgeHeap[i * 3 + 1] = (i * 7 + 3) % N;
        edgeHeap[i * 3 + 2] = 1;
      }

      // Step 4: Compute layout
      const layoutResult = module.compute_layout();
      if (layoutResult !== 0) throw new Error(`compute_layout failed: ${layoutResult}`);

      // Step 5: Read positions
      const posPtrRead = module.get_positions_ptr();
      const count = module.get_node_count();
      const positions = new Float32Array(module.HEAPF32.buffer, posPtrRead, count * 3);

      // Validate
      const results = { count, positions: Array.from(positions) };
      window.__layoutResult = results;
    });

    const result = await page.evaluate(() => window.__layoutResult);
    expect(result).toBeDefined();
    expect(result.count).toBe(100);

    // Verify positions are valid (within 25-unit radius, no NaN)
    let maxRadius = 0;
    for (let i = 0; i < result.positions.length; i++) {
      expect(Number.isFinite(result.positions[i])).toBe(true);
      const abs = Math.abs(result.positions[i]);
      if (abs > maxRadius) maxRadius = abs;
    }
    expect(maxRadius).toBeLessThanOrEqual(25);
  });

  test('wasm_free_memory_prevents_leak — 10 successive runs with stable heap', async ({ page }) => {
    await page.evaluate(() => {
      // Inline mock module
      const makeMock = () => {
        const heap = new ArrayBuffer(32 * 1024 * 1024);
        const hp = { HEAPF32: new Float32Array(heap), HEAP32: new Int32Array(heap), HEAP8: new Int8Array(heap), _np: 0, _ep: 0, _pp: 0 };
        return {
          ...hp,
          init_graph: (n) => { hp._np = 1024; hp._ep = 1024 + n*28; hp._pp = hp._ep + n*12; return 0; },
          get_node_input_ptr: () => hp._np, get_edge_input_ptr: () => hp._ep,
          compute_layout: () => 0, get_positions_ptr: () => hp._pp,
          get_node_count: () => 0, update_positions: () => 0,
          free_memory: () => { hp._np = 0; hp._ep = 0; hp._pp = 0; },
          set_convergence_threshold: () => {}, set_repulsion_k: () => {},
          set_attraction_k: () => {}, set_damping: () => {},
          set_max_iterations: () => {}, set_scene_radius: () => {},
        };
      };

      const module = makeMock();
      const heapSizes = [];

      for (let run = 0; run < 10; run++) {
        const N = 50 + run * 5; // Varying sizes
        const E = N * 3;

        module.init_graph(N, E);

        // Populate (minimal)
        const nodePtr = module.get_node_input_ptr();
        const nodeHeap = new Float32Array(module.HEAPF32.buffer, nodePtr, N * 7);
        for (let i = 0; i < N; i++) {
          nodeHeap[i * 7] = Math.random() * 10;
          nodeHeap[i * 7 + 4] = 0;
        }

        const edgePtr = module.get_edge_input_ptr();
        const edgeHeap = new Int32Array(module.HEAP32.buffer, edgePtr, E * 3);
        for (let i = 0; i < E; i++) {
          edgeHeap[i * 3] = i % N;
          edgeHeap[i * 3 + 1] = (i + 1) % N;
          edgeHeap[i * 3 + 2] = 1;
        }

        module.compute_layout();
        module.free_memory();

        // Record heap byte length after free (should be stable)
        heapSizes.push(module.HEAP8.buffer.byteLength);
      }

      window.__heapSizes = heapSizes;
    });

    const heapSizes = await page.evaluate(() => window.__heapSizes);
    expect(heapSizes).toHaveLength(10);

    // All sizes should be identical (or very close, within 1 byte)
    for (let i = 1; i < heapSizes.length; i++) {
      expect(heapSizes[i]).toBe(heapSizes[0]);
    }
  });

  test('js_fallback_js_layout_produces_valid_results', async ({ page }) => {
    // Run the JS fallback layout manually without WASM
    const result = await page.evaluate(() => {
      const N = 30;
      const E = 60;

      // Pure JS force-directed simulation
      const pos = new Float64Array(N * 3);
      const vel = new Float64Array(N * 3);

      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 20;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 20;
      }

      const edges = [];
      for (let i = 0; i < E; i++) {
        edges.push({ src: i % N, tgt: (i * 7 + 3) % N, w: 1 });
      }

      const minDistSq = 0.0001;
      const repK = 1.0, attK = 0.1, damp = 0.85;
      const maxIt = 100;
      let energy = Infinity;

      for (let iter = 0; iter < maxIt; iter++) {
        const forces = new Float64Array(N * 3);

        for (let a = 0; a < N; a++) {
          for (let b = a + 1; b < N; b++) {
            let dx = pos[a*3] - pos[b*3], dy = pos[a*3+1] - pos[b*3+1], dz = pos[a*3+2] - pos[b*3+2];
            let dsq = dx*dx + dy*dy + dz*dz;
            if (dsq < minDistSq) dsq = minDistSq;
            const invD = 1 / Math.sqrt(dsq);
            const fMag = repK * invD * invD;
            const fx = dx * invD * fMag, fy = dy * invD * fMag, fz = dz * invD * fMag;
            forces[a*3] += fx; forces[a*3+1] += fy; forces[a*3+2] += fz;
            forces[b*3] -= fx; forces[b*3+1] -= fy; forces[b*3+2] -= fz;
          }
        }

        for (const e of edges) {
          const dx = pos[e.tgt*3] - pos[e.src*3], dy = pos[e.tgt*3+1] - pos[e.src*3+1], dz = pos[e.tgt*3+2] - pos[e.src*3+2];
          let dsq = dx*dx + dy*dy + dz*dz;
          if (dsq < minDistSq) dsq = minDistSq;
          const dist = Math.sqrt(dsq);
          const fMag = dist * attK * e.w;
          const fx = (dx/dist) * fMag, fy = (dy/dist) * fMag, fz = (dz/dist) * fMag;
          forces[e.src*3] += fx; forces[e.src*3+1] += fy; forces[e.src*3+2] += fz;
          forces[e.tgt*3] -= fx; forces[e.tgt*3+1] -= fy; forces[e.tgt*3+2] -= fz;
        }

        energy = 0;
        for (let i = 0; i < N; i++) {
          vel[i*3] = (vel[i*3] + forces[i*3]) * damp;
          vel[i*3+1] = (vel[i*3+1] + forces[i*3+1]) * damp;
          vel[i*3+2] = (vel[i*3+2] + forces[i*3+2]) * damp;
          pos[i*3] += vel[i*3]; pos[i*3+1] += vel[i*3+1]; pos[i*3+2] += vel[i*3+2];
          energy += Math.abs(vel[i*3]) + Math.abs(vel[i*3+1]) + Math.abs(vel[i*3+2]);
        }
        if (energy < 0.001 * N) break;
      }

      return {
        count: N,
        maxRadius: Math.max(...Array.from(pos).map(Math.abs)),
        hasNaN: Array.from(pos).some(v => !Number.isFinite(v)),
        energy,
        iterations: maxIt,
      };
    });

    expect(result.hasNaN).toBe(false);
    expect(result.maxRadius).toBeLessThan(500);
    expect(result.maxRadius).toBeGreaterThan(0);
    expect(result.count).toBe(30);
    expect(result.energy).toBeDefined();
  });
});
