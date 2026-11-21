## MODIFIED Requirements

### Requirement: Worker protocol
`layoutWorker.js` SHALL post `{ type: 'ready' }` on start and again with `wasmAvailable` once loading ends. A `layout` message SHALL post `progress` and then `result` with a transferred `positions` Float32Array, `nodeCount`, `layoutTimeMs` and `engine` (`wasm` or `js`). `abort` SHALL drop the pending result and free engine memory.

#### Scenario: Empty graph
- **WHEN** a `layout` message has no nodes
- **THEN** the worker posts an `error` with code 4 and `fallback: false`, saying the graph has no nodes

#### Scenario: Unknown message
- **WHEN** a message has an unknown type
- **THEN** the worker logs `[VR] Unknown message type: <type>`

### Requirement: Refinement
A `refine` message SHALL call `update_positions(maxIterations)`, 50 by default, and post `partial` positions with the returned energy. With no engine or no graph loaded it SHALL post the error `Refinement not available in JS fallback mode`. A finished layout SHALL keep its engine memory until the next layout or an abort, so refinement has positions to move.

#### Scenario: JS mode refinement
- **WHEN** a `refine` message arrives and the engine did not load
- **THEN** the worker posts that error with `fallback: false`

#### Scenario: Refine after layout
- **WHEN** a `refine` message follows a WASM layout of three nodes
- **THEN** the worker posts `partial` with nine position values

## ADDED Requirements

### Requirement: Worker id mapping
Cluster ids, strings or numbers, SHALL reach both engines as dense integers from 0, with -1 for none. Edges without `sourceIdx` and `targetIdx` SHALL be resolved from their `source` and `target` node ids.

#### Scenario: Folder cluster ids
- **WHEN** nodes have cluster ids `src/auth`, `src/auth` and `src/db`
- **THEN** the engine receives cluster ids 0, 0 and 1
