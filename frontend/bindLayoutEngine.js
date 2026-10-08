/**
 * Bind the compiled layout engine to the names its callers use.
 *
 * Emscripten exports C functions with a leading underscore (`_init_graph`),
 * and with the build's runtime exports the heap views as `HEAPF32` / `HEAP32`.
 * layoutWorker.js called `Module.init_graph` and read `Module.HEAPF32`, neither
 * of which existed, so loading the engine always failed its own export check
 * and fell back to the JavaScript layout. scripts/test-wasm.mjs made the same
 * assumption and failed on load, and it was not run anywhere, so nothing
 * noticed.
 *
 * Both now bind through this function, so the test exercises the exact path
 * the worker uses.
 */
export const LAYOUT_ENGINE_EXPORTS = [
  // Core layout (04-WASM-Spec.md §2.1)
  'init_graph', 'get_node_input_ptr', 'get_edge_input_ptr', 'compute_layout',
  'get_positions_ptr', 'update_positions', 'get_node_count', 'free_memory',
  // Configuration (§2.2)
  'set_convergence_threshold', 'set_repulsion_k', 'set_attraction_k',
  'set_damping', 'set_max_iterations', 'set_scene_radius',
];

/**
 * @param {object} raw The instantiated Emscripten module.
 * @returns {object} The same module, with each export also under its plain name.
 * @throws {Error} Naming every missing export or heap view.
 */
export function bindLayoutEngine(raw) {
  const missing = [];
  for (const name of LAYOUT_ENGINE_EXPORTS) {
    const fn = raw[name] ?? raw[`_${name}`];
    if (typeof fn === 'function') raw[name] = fn;
    else missing.push(name);
  }
  // Read on demand by callers, never cached: with ALLOW_MEMORY_GROWTH the
  // buffer behind these views is replaced when memory grows.
  for (const view of ['HEAPF32', 'HEAP32']) {
    if (!raw[view]) missing.push(view);
  }
  if (missing.length) throw new Error(`Layout engine is missing: ${missing.join(', ')}`);
  return raw;
}
