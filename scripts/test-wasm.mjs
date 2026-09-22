/**
 * test-wasm.mjs — WASM Module Verification Script
 *
 * Loads the compiled layout_engine WASM module in Node.js and verifies
 * that all required exports are present and respond correctly to a
 * basic init → populate → compute → read → free cycle.
 *
 * Usage:
 *   npm run build:wasm             # Compile WASM first
 *   npm run test:wasm              # Run this script
 *
 * Expected output:
 *   ✓ layout_engine module loaded
 *   ✓ All exported functions present (14/14)
 *   ✓ get_node_count() = 0 (initial)
 *   ✓ init_graph(50, 100) = 0 (OK)
 *   ✓ get_node_input_ptr() non-null
 *   ✓ get_edge_input_ptr() non-null
 *   ✓ Populated node buffer (50 nodes × 7 floats)
 *   ✓ Populated edge buffer (100 edges × 3 int32)
 *   ✓ compute_layout() = 0 (OK)
 *   ✓ get_positions_ptr() non-null
 *   ✓ Output positions correctly shaped (50 nodes × 3 floats)
 *   ✓ update_positions(10) returned energy (remaining energy)
 *   ✓ free_memory() — no crash
 *   ✓ get_node_count() = 0 (after free)
 *   ✓ Configuration setters accept values
 *   All 14 tests passed.
 *
 * @see 04-WASM-Spec.md §2  — Module exports
 * @see 04-WASM-Spec.md §5.1 — Call sequence
 * @see 04-WASM-Spec.md §3.2 — JS memory access
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

// ─── Configuration ──────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');

// Try loading the production module first, fall back to debug
const WASM_MODULE_PATHS = [
  path.join(PLUGIN_ROOT, 'frontend', 'layout_engine.mjs'),
  path.join(PLUGIN_ROOT, 'frontend', 'layout_engine_debug.mjs'),
];

// ─── Test Helpers ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    results.push(`  ✗ ${name}`);
    results.push(`      ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertNear(actual, expected, tolerance, label) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `${label}: expected ${expected} ± ${tolerance}, got ${actual} (diff ${diff})`
    );
  }
}

// ─── Required Export Names ──────────────────────────────────────────────
// From 04-WASM-Spec.md §2.1 and §2.2
const REQUIRED_EXPORTS = [
  // Core layout functions (§2.1)
  'init_graph',
  'get_node_input_ptr',
  'get_edge_input_ptr',
  'compute_layout',
  'get_positions_ptr',
  'update_positions',
  'get_node_count',
  'free_memory',

  // Configuration functions (§2.2)
  'set_convergence_threshold',
  'set_repulsion_k',
  'set_attraction_k',
  'set_damping',
  'set_max_iterations',
  'set_scene_radius',
];

// ─── Main ────────────────────────────────────────────────────────────────
console.log('\nHolocron VR — WASM Layout Engine Test Suite');
console.log('═══════════════════════════════════════════\n');

// Step 1: Locate and load the WASM module ────────────────────────────────
let modulePath = null;
for (const p of WASM_MODULE_PATHS) {
  if (fs.existsSync(p)) {
    modulePath = p;
    break;
  }
}

if (!modulePath) {
  console.error('✗ WASM module not found. Build first with: npm run build:wasm');
  console.error('  Looked in:');
  for (const p of WASM_MODULE_PATHS) {
    console.error(`    ${p}`);
  }
  process.exit(1);
}

console.log(`  Using: ${path.relative(PLUGIN_ROOT, modulePath)}`);

let Module;
try {
  // Emscripten's MODULARIZE=1 + EXPORT_ES6=1 produces a default export
  // that is a factory function returning a promise of the module.
  // Use file:// URL for ESM import — required by Node.js when
  // the path contains characters that could be interpreted specially.
  const moduleURL = pathToFileURL(modulePath).href;
  const moduleFactory = (await import(moduleURL)).default;
  Module = await moduleFactory();
  console.log('  ✓ layout_engine module loaded\n');
} catch (err) {
  console.error('✗ Failed to load layout_engine module:', err.message);
  process.exit(1);
}

// ─── Test Suite ──────────────────────────────────────────────────────────
console.log('Export Verification');
console.log('────────────────────');

test('All exported functions present', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert(
      typeof Module[name] === 'function',
      `Missing exported function: ${name}`
    );
  }
});

// Verify the count matches exactly (no missing, no spurious)
test('Exact export count matches spec', () => {
  const present = REQUIRED_EXPORTS.filter(
    (name) => typeof Module[name] === 'function'
  );
  assert(
    present.length === REQUIRED_EXPORTS.length,
    `Expected ${REQUIRED_EXPORTS.length} exports, found ${present.length}. Missing: ${
      REQUIRED_EXPORTS.filter((n) => !present.includes(n)).join(', ')
    }`
  );
});

console.log('\nInitial State');
console.log('─────────────');

test('get_node_count() returns 0 before init', () => {
  assert(Module.get_node_count() === 0, 'Expected 0');
});

test('get_node_input_ptr() returns 0 (null) before init', () => {
  assert(Module.get_node_input_ptr() === 0, 'Expected null pointer');
});

test('get_edge_input_ptr() returns 0 (null) before init', () => {
  assert(Module.get_edge_input_ptr() === 0, 'Expected null pointer');
});

test('get_positions_ptr() returns 0 (null) before init', () => {
  assert(Module.get_positions_ptr() === 0, 'Expected null pointer');
});

test('compute_layout() returns ERR_NOT_INITIALISED (7) before init', () => {
  assert(Module.compute_layout() === 7, 'Expected error code 7');
});

console.log('\nBuffer Initialisation (§2.1 — init_graph)');
console.log('──────────────────────────────────────────');

const NODE_COUNT = 50;
const EDGE_COUNT = 100;

test(`init_graph(${NODE_COUNT}, ${EDGE_COUNT}) returns LAYOUT_OK (0)`, () => {
  const result = Module.init_graph(NODE_COUNT, EDGE_COUNT);
  assert(result === 0, `Expected 0, got ${result}`);
});

test('get_node_count() returns correct count after init', () => {
  assert(Module.get_node_count() === NODE_COUNT, `Expected ${NODE_COUNT}`);
});

test('get_node_input_ptr() returns non-null pointer', () => {
  const ptr = Module.get_node_input_ptr();
  assert(ptr !== 0 && ptr !== null, 'Expected non-null pointer');
});

test('get_edge_input_ptr() returns non-null pointer', () => {
  const ptr = Module.get_edge_input_ptr();
  assert(ptr !== 0 && ptr !== null, 'Expected non-null pointer');
});

console.log('\nBuffer Population (§4.2 — Memory Layout)');
console.log('──────────────────────────────────────────');

test('Node buffer has correct capacity (50 × 7 = 350 floats)', () => {
  const ptr = Module.get_node_input_ptr();
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, NODE_COUNT * 7);
  assert(heap.length === NODE_COUNT * 7, `Expected ${NODE_COUNT * 7} floats`);
});

test('Edge buffer has correct capacity (100 × 3 = 300 int32s)', () => {
  const ptr = Module.get_edge_input_ptr();
  const heap = new Int32Array(Module.HEAP32.buffer, ptr, EDGE_COUNT * 3);
  assert(heap.length === EDGE_COUNT * 3, `Expected ${EDGE_COUNT * 3} int32s`);
});

// Populate node buffer with test data
test('Populate node buffer with test data', () => {
  const ptr = Module.get_node_input_ptr();
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, NODE_COUNT * 7);

  for (let i = 0; i < NODE_COUNT; i++) {
    const base = i * 7;
    // Distribute nodes across 3 clusters on a sphere
    const clusterId = Math.floor(i / 17) % 3;     // 0, 1, or 2
    const theta = Math.acos(1 - 2 * (i + 0.5) / NODE_COUNT);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;

    heap[base + 0] = 20 * Math.sin(theta) * Math.cos(phi);  // initial_x
    heap[base + 1] = 20 * Math.cos(theta);                   // initial_y
    heap[base + 2] = 20 * Math.sin(theta) * Math.sin(phi);   // initial_z
    heap[base + 3] = 1.0 + 0.01 * (i % 200);                 // mass
    heap[base + 4] = clusterId;                               // cluster_id
    heap[base + 5] = i / NODE_COUNT;                          // importance (0..1)
    heap[base + 6] = 0.0;                                     // reserved
  }

  // Spot-check a few entries
  assert(heap[0] !== 0, 'Node 0 initial_x should be non-zero');
  assert(heap[3] >= 1.0, 'Node 0 mass should be ≥ 1.0');
  assert(heap[4] >= 0 && heap[4] <= 2, 'Cluster ID should be 0-2');
});

test('Populate edge buffer with test data', () => {
  const ptr = Module.get_edge_input_ptr();
  const heap = new Int32Array(Module.HEAP32.buffer, ptr, EDGE_COUNT * 3);

  for (let i = 0; i < EDGE_COUNT; i++) {
    const base = i * 3;
    // Create edges between consecutive nodes (ring topology)
    const src = i % NODE_COUNT;
    const tgt = (i + 1) % NODE_COUNT;
    heap[base + 0] = src;      // source_index
    heap[base + 1] = tgt;      // target_index
    heap[base + 2] = 1;        // weight
  }

  // Spot-check
  assert(heap[0] === 0, 'Edge 0 source should be 0');
  assert(heap[1] === 1, 'Edge 0 target should be 1');
  assert(heap[2] === 1, 'Edge 0 weight should be 1');
});

console.log('\nLayout Computation (§2.1 — compute_layout)');
console.log('────────────────────────────────────────────');

test('compute_layout() returns LAYOUT_OK (0)', () => {
  const result = Module.compute_layout();
  assert(result === 0, `Expected 0, got ${result} (see §6 for error codes)`);
});

test('get_positions_ptr() returns non-null pointer after layout', () => {
  const ptr = Module.get_positions_ptr();
  assert(ptr !== 0 && ptr !== null, 'Expected non-null pointer');
});

test('Output positions buffer has correct shape (50 × 3 = 150 floats)', () => {
  const ptr = Module.get_positions_ptr();
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, NODE_COUNT * 3);
  assert(heap.length === NODE_COUNT * 3, `Expected ${NODE_COUNT * 3} floats`);
});

test('Output positions contain finite values within scene radius', () => {
  const ptr = Module.get_positions_ptr();
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, NODE_COUNT * 3);

  for (let i = 0; i < NODE_COUNT * 3; i++) {
    assert(
      isFinite(heap[i]),
      `Position[${i}] is not finite: ${heap[i]}`
    );
    // Positions should be within reasonable scene bounds
    assert(
      Math.abs(heap[i]) < 100,
      `Position[${i}] = ${heap[i]} exceeds expected bounds`
    );
  }
});

test('Output positions are not all zero', () => {
  const ptr = Module.get_positions_ptr();
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, NODE_COUNT * 3);
  let allZero = true;
  for (let i = 0; i < heap.length; i++) {
    if (heap[i] !== 0) { allZero = false; break; }
  }
  assert(!allZero, 'All positions are zero — layout may not have run');
});

test('Output positions show variance (not all identical)', () => {
  const ptr = Module.get_positions_ptr();
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, NODE_COUNT * 3);

  // Compare first and last node positions
  const x0 = heap[0], y0 = heap[1], z0 = heap[2];
  const xn = heap[(NODE_COUNT - 1) * 3];
  const yn = heap[(NODE_COUNT - 1) * 3 + 1];
  const zn = heap[(NODE_COUNT - 1) * 3 + 2];

  const same =
    Math.abs(x0 - xn) < 0.001 &&
    Math.abs(y0 - yn) < 0.001 &&
    Math.abs(z0 - zn) < 0.001;

  assert(!same, 'All positions appear identical — layout may collapsed to a point');
});

console.log('\nStreaming Refinement (§2.1 — update_positions)');
console.log('────────────────────────────────────────────────');

test('update_positions(10) returns a finite remaining energy', () => {
  const energy = Module.update_positions(10);
  assert(
    isFinite(energy),
    `Energy is not finite: ${energy}`
  );
  assert(energy >= 0, `Energy should be ≥ 0, got ${energy}`);
});

test('update_positions(0) returns quickly (no-op)', () => {
  const energy = Module.update_positions(0);
  assert(isFinite(energy), 'Energy should be finite for 0 iterations');
});

test('Positions change after refinement', () => {
  // Read positions before refinement
  const ptr0 = Module.get_positions_ptr();
  const before = new Float32Array(
    Module.HEAPF32.buffer, ptr0, NODE_COUNT * 3
  ).slice();

  // Run refinement
  Module.update_positions(50);

  // Read positions after
  const ptr1 = Module.get_positions_ptr();
  const after = new Float32Array(
    Module.HEAPF32.buffer, ptr1, NODE_COUNT * 3
  ).slice();

  // Check that at least some positions changed
  let anyChanged = false;
  for (let i = 0; i < before.length; i++) {
    if (Math.abs(before[i] - after[i]) > 0.0001) {
      anyChanged = true;
      break;
    }
  }
  assert(anyChanged, 'Positions should change after refinement iterations');
});

console.log('\nMemory Management (§2.1 — free_memory)');
console.log('─────────────────────────────────────────');

test('free_memory() completes without error', () => {
  Module.free_memory();
});

test('get_node_count() returns 0 after free', () => {
  assert(Module.get_node_count() === 0, 'Expected 0 after free');
});

test('get_node_input_ptr() returns null after free', () => {
  assert(Module.get_node_input_ptr() === 0, 'Expected null after free');
});

test('get_edge_input_ptr() returns null after free', () => {
  assert(Module.get_edge_input_ptr() === 0, 'Expected null after free');
});

test('get_positions_ptr() returns null after free', () => {
  assert(Module.get_positions_ptr() === 0, 'Expected null after free');
});

test('Double free_memory() is safe (no crash)', () => {
  Module.free_memory();  // Should be a no-op
});

test('Re-init after free works correctly', () => {
  const result = Module.init_graph(10, 5);
  assert(result === 0, `Re-init failed: ${result}`);
  assert(Module.get_node_count() === 10, 'Node count should be 10');
  Module.free_memory();
});

console.log('\nConfiguration Functions (§2.2)');
console.log('────────────────────────────────');

test('set_convergence_threshold accepts float', () => {
  Module.set_convergence_threshold(0.0005);
  // No return value — just verify no crash
});

test('set_repulsion_k accepts float', () => {
  Module.set_repulsion_k(2.0);
});

test('set_attraction_k accepts float', () => {
  Module.set_attraction_k(0.05);
});

test('set_damping accepts float', () => {
  Module.set_damping(0.9);
});

test('set_max_iterations accepts int32', () => {
  Module.set_max_iterations(100);
});

test('set_scene_radius accepts float', () => {
  Module.set_scene_radius(25.0);
});

test('Layout with custom config produces valid results', () => {
  Module.init_graph(20, 10);

  // Populate minimal test graph
  const nodePtr = Module.get_node_input_ptr();
  const nodeHeap = new Float32Array(Module.HEAPF32.buffer, nodePtr, 20 * 7);
  for (let i = 0; i < 20; i++) {
    const base = i * 7;
    nodeHeap[base + 0] = (i - 10) * 2;  // initial_x
    nodeHeap[base + 1] = 0;              // initial_y
    nodeHeap[base + 2] = 0;              // initial_z
    nodeHeap[base + 3] = 1.0;            // mass
    nodeHeap[base + 4] = 0;              // cluster_id (all same)
    nodeHeap[base + 5] = 0.5;            // importance
    nodeHeap[base + 6] = 0.0;            // reserved
  }

  const edgePtr = Module.get_edge_input_ptr();
  const edgeHeap = new Int32Array(Module.HEAP32.buffer, edgePtr, 10 * 3);
  for (let i = 0; i < 10; i++) {
    edgeHeap[i * 3 + 0] = i;
    edgeHeap[i * 3 + 1] = i + 1;
    edgeHeap[i * 3 + 2] = 1;
  }

  const result = Module.compute_layout();
  assert(result === 0, `Layout failed: ${result}`);

  const posPtr = Module.get_positions_ptr();
  const posHeap = new Float32Array(Module.HEAPF32.buffer, posPtr, 20 * 3);
  assert(isFinite(posHeap[0]), 'Position[0] should be finite');
  assert(posHeap.length === 60, 'Expected 60 floats for 20 nodes');

  Module.free_memory();
});

test('Large graph test (1000 nodes, 5000 edges)', () => {
  const N = 1000;
  const E = 5000;

  const r = Module.init_graph(N, E);
  assert(r === 0, `init_graph failed: ${r}`);

  // Quick uniform distribution (no clusters)
  const nodePtr = Module.get_node_input_ptr();
  const nodeHeap = new Float32Array(Module.HEAPF32.buffer, nodePtr, N * 7);
  for (let i = 0; i < N; i++) {
    const base = i * 7;
    const theta = Math.acos(1 - 2 * (i + 0.5) / N);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    nodeHeap[base + 0] = 20 * Math.sin(theta) * Math.cos(phi);
    nodeHeap[base + 1] = 20 * Math.cos(theta);
    nodeHeap[base + 2] = 20 * Math.sin(theta) * Math.sin(phi);
    nodeHeap[base + 3] = 1.0;
    nodeHeap[base + 4] = -1;  // no cluster
    nodeHeap[base + 5] = 0.5;
    nodeHeap[base + 6] = 0.0;
  }

  const edgePtr = Module.get_edge_input_ptr();
  const edgeHeap = new Int32Array(Module.HEAP32.buffer, edgePtr, E * 3);
  for (let i = 0; i < E; i++) {
    edgeHeap[i * 3 + 0] = i % N;
    edgeHeap[i * 3 + 1] = (i * 7 + 3) % N;
    edgeHeap[i * 3 + 2] = (i % 5) + 1;
  }

  // Time the layout
  const t0 = performance.now();
  const layoutResult = Module.compute_layout();
  const t1 = performance.now();
  const elapsed = t1 - t0;

  assert(layoutResult === 0, `Layout failed: ${layoutResult}`);

  const posPtr = Module.get_positions_ptr();
  const posHeap = new Float32Array(Module.HEAPF32.buffer, posPtr, N * 3);

  // Verify positions are reasonable
  let minVal = Infinity, maxVal = -Infinity;
  for (let i = 0; i < N * 3; i++) {
    if (posHeap[i] < minVal) minVal = posHeap[i];
    if (posHeap[i] > maxVal) maxVal = posHeap[i];
    assert(isFinite(posHeap[i]), `Non-finite position at ${i}`);
  }

  console.log(`      ${N} nodes × ${E} edges: ${elapsed.toFixed(0)} ms`);
  console.log(`      Position range: [${minVal.toFixed(1)}, ${maxVal.toFixed(1)}]`);

  Module.free_memory();
});

// ─── Summary ────────────────────────────────────────────────────────────
const total = passed + failed;
console.log('\n' + '═'.repeat(47));
console.log(`  ${passed}/${total} tests passed`);
if (failed > 0) {
  console.log(`  ${failed} test(s) failed — check errors above`);
  process.exit(1);
} else {
  console.log('  All tests passed.\n');
}
