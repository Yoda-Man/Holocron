# Layout Engine Specification

## Purpose
The layout engine computes a 3D position for every node. It is C++ in `wasm-src/layout_engine.cpp`, compiled to WebAssembly as `frontend/layout_engine.mjs` and `frontend/layout_engine.wasm`, bound by `frontend/bindLayoutEngine.js` and driven from the Web Worker `frontend/layoutWorker.js`, which falls back to a JavaScript simulation. `backend/layoutStore.js` caches results in IndexedDB. YodaMan core vendors the engine files.

## Requirements

### Requirement: Compiled module
`npm run build:wasm` SHALL compile `wasm-src/layout_engine.cpp` with `emcc -O3 -msimd128 -flto` into an ES6 module factory for the worker environment at `frontend/layout_engine.mjs`, with 32 MB initial memory, a 50 MB maximum and memory growth on. It SHALL export the fourteen functions in `LAYOUT_ENGINE_EXPORTS` plus `HEAPF32` and `HEAP32`.

#### Scenario: Debug build
- **WHEN** `npm run build:wasm:debug` runs
- **THEN** it compiles with `-O0 -g` and `ASSERTIONS=2` to `frontend/layout_engine_debug.mjs`

#### Scenario: CMake build
- **WHEN** `npm run build:wasm:cmake` runs
- **THEN** `wasm-src/CMakeLists.txt` builds the same module into `frontend/` through `build/wasm`

### Requirement: Export binding
`bindLayoutEngine` SHALL make each name in `LAYOUT_ENGINE_EXPORTS` callable under its plain name, taking the underscore-prefixed Emscripten export when the plain one is missing. It MUST throw `Layout engine is missing: <names>` when any function or heap view is absent. Heap views SHALL be read on demand, never cached.

#### Scenario: Emscripten names
- **WHEN** the module exports `_init_graph`
- **THEN** `Module.init_graph` calls it

#### Scenario: Incomplete module
- **WHEN** `HEAP32` is missing
- **THEN** `bindLayoutEngine` throws naming `HEAP32`

### Requirement: Buffers and call sequence
`init_graph(nodeCount, edgeCount)` SHALL allocate zeroed buffers: 7 floats per node (x, y, z, mass, cluster id, importance, reserved), 3 int32 per edge (source index, target index, weight), and 3 floats per node for positions, velocities and forces. It SHALL return 4 (`ERR_INVALID_GRAPH`) for zero nodes and 1 when allocation fails. `free_memory` SHALL release all buffers.

#### Scenario: Not initialised
- **WHEN** `compute_layout` is called before `init_graph`
- **THEN** it returns 7 (`ERR_NOT_INITIALISED`)

#### Scenario: After free
- **WHEN** `free_memory` has run
- **THEN** `get_node_count` returns 0

### Requirement: Two-level layout
`compute_layout` SHALL place clusters on a golden-angle sphere of radius `sceneRadius` (default 20), larger clusters nearer the centre, scatter each node deterministically inside its cluster sphere, then run the force simulation. When no node has a cluster id of 0 or more, nodes SHALL be spread on a golden-angle sphere of half the scene radius.

#### Scenario: Unclustered graph stays finite
- **WHEN** every node has cluster id -1
- **THEN** every output position is a finite number

#### Scenario: Bad edge index
- **WHEN** an edge points to a node index outside the graph
- **THEN** that edge is zeroed and ignored instead of failing the layout

### Requirement: Force simulation
Each iteration SHALL apply repulsion `K_rep / dist²` between node pairs in the same cluster, attraction `dist * K_att * weight` along edges, then `v = (v + F / mass) * damping` and `x += v`, keeping nodes inside their cluster sphere. It SHALL stop at `maxIterations` or when total speed falls below `convergenceDelta * nodeCount`. Defaults SHALL be 1.0, 0.1, 0.85, 500 and 0.001.

#### Scenario: Settings applied
- **WHEN** the worker receives `config.repulsionK`, `attractionK`, `damping`, `maxIterations`, `convergenceDelta` or `sceneRadius`
- **THEN** it calls the matching `set_*` function before `init_graph`

### Requirement: Worker protocol
`layoutWorker.js` SHALL post `{ type: 'ready' }` on start and again with `wasmAvailable` once loading ends. A `layout` message SHALL post `progress` and then `result` with a transferred `positions` Float32Array, `nodeCount`, `layoutTimeMs` and `engine` (`wasm` or `js`). `abort` SHALL drop the pending result and free engine memory.

#### Scenario: Empty graph
- **WHEN** a `layout` message has no nodes
- **THEN** the worker posts an `error` with code 4 and `fallback: false`, saying the graph has no nodes

#### Scenario: Unknown message
- **WHEN** a message has an unknown type
- **THEN** the worker logs `[VR] Unknown message type: <type>`

### Requirement: JavaScript fallback
The worker SHALL use `runJsLayout`, the same algorithm in JavaScript seeded with random positions, when the engine fails to load. When a WASM error code marks fallback (1, 2 or 3), it SHALL post an `error` with `fallback: true` and then a `js` result. Other codes SHALL be posted as fatal errors.

#### Scenario: Engine missing
- **WHEN** `./layout_engine.mjs` cannot be imported
- **THEN** the worker logs `[VR] WASM layout unavailable; falling back to JS` and layouts report `engine: 'js'`

#### Scenario: Both fail
- **WHEN** the JS fallback also throws
- **THEN** the worker posts an `error` starting `Both WASM and JS layout failed:`

### Requirement: Refinement
A `refine` message SHALL call `update_positions(maxIterations)`, 50 by default, and post `partial` positions with the returned energy. With no engine or no graph loaded it SHALL post the error `Refinement not available in JS fallback mode`. A finished layout SHALL keep its engine memory until the next layout or an abort, so refinement has positions to move.

#### Scenario: JS mode refinement
- **WHEN** a `refine` message arrives and the engine did not load
- **THEN** the worker posts that error with `fallback: false`

#### Scenario: Refine after layout
- **WHEN** a `refine` message follows a WASM layout of three nodes
- **THEN** the worker posts `partial` with nine position values

### Requirement: Layout cache
`layoutStore.js` SHALL store layouts in IndexedDB database `constellation-vr-layout-cache`, store `layouts`, keyed `<workspacePath>|<graphHash>`, keeping at most 10 entries per workspace by least recent use. Every method MUST resolve to `false` or `null` instead of throwing when IndexedDB is unavailable.

#### Scenario: Corrupt entry
- **WHEN** `load` finds positions that are not a Float32Array or whose length is not `nodeCount * 3`
- **THEN** the entry is removed and `load` returns null

#### Scenario: No IndexedDB
- **WHEN** `indexedDB` is undefined
- **THEN** `save` returns false and `load` returns null

### Requirement: Engine verification
`npm run test:wasm` SHALL load the built module from `frontend/layout_engine.mjs` or the debug build through `bindLayoutEngine`, check all fourteen exports, run init, populate, compute, refine and free, and check that positions are finite, including a fully unclustered graph. It MUST exit 1 when the module is missing.

#### Scenario: Not built
- **WHEN** no compiled module exists
- **THEN** the script prints `✗ WASM module not found. Build first with: npm run build:wasm` and exits 1

### Requirement: Core vendors the engine
YodaMan core's `scripts/sync-holocron-layout.js` SHALL copy `layout_engine.mjs`, `layout_engine.wasm` and `bindLayoutEngine.js` from this repository's `frontend/` into core's `public/vendor/holocron-layout/` with a `MANIFEST.json` of sizes and SHA-256 hashes. A change to these files here MUST be synced into core.

#### Scenario: Check mode
- **WHEN** core runs the script with `--check` and the vendored bytes differ
- **THEN** it reports the stale files and exits 1

### Requirement: Worker id mapping
Cluster ids, strings or numbers, SHALL reach both engines as dense integers from 0, with -1 for none. Edges without `sourceIdx` and `targetIdx` SHALL be resolved from their `source` and `target` node ids.

#### Scenario: Folder cluster ids
- **WHEN** nodes have cluster ids `src/auth`, `src/auth` and `src/db`
- **THEN** the engine receives cluster ids 0, 0 and 1
