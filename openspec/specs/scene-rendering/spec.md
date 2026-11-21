# Scene Rendering Specification

## Purpose
Scene rendering draws the graph as a 3D constellation in the browser with three.js. It lives in the `VRViewer` class in `frontend/VRViewer.js`: scene setup, instanced node spheres, typed edge lines, level of detail, desktop navigation and selection, frame-rate tracking and disposal. Filters and overlays on the same class are in the views-and-overlays spec.

## Requirements

### Requirement: Viewer setup
`new VRViewer(container, options)` MUST throw `VRViewer requires a container element` without a container. Options SHALL set `lodNear` (5), `lodMid` (15), `lodFar` (30), `maxNodes` (3000), `workspacePath` (or `workspace`) and `apiBaseUrl`. `init()` SHALL add a WebGL canvas with background `0x0d0d1a`, fog from 40 to 80, and `renderer.xr.enabled` set to true.

#### Scenario: Camera defaults
- **WHEN** `init()` runs
- **THEN** a perspective camera with 60 degree field of view, near 0.1 and far 200 is placed at (0, 5, 20) looking at the origin

#### Scenario: Colour handling
- **WHEN** the module loads
- **THEN** `THREE.ColorManagement.enabled` is false and the renderer outputs linear sRGB

### Requirement: Desktop navigation
`init()` SHALL attach `OrbitControls` to the canvas with damping 0.08, a minimum distance of 2 and a maximum of 80, and SHALL resize the camera and renderer on window `resize`. `flyToNode(nodeId)` SHALL target the node and move the camera to the node position plus (5, 3, 8). `restoreCamera(state)` SHALL apply a saved position and quaternion.

#### Scenario: Zero-size container
- **WHEN** the window resizes while the container has zero width or height
- **THEN** the camera and renderer are left unchanged

#### Scenario: Unknown node
- **WHEN** `flyToNode` is called with an id not in the scene
- **THEN** nothing moves

### Requirement: Instanced nodes
`render(nodes, edges, positions)` SHALL draw at most `maxNodes` nodes as one `InstancedMesh` of unlit spheres, placed from the flat `positions` array. Scale SHALL grow linearly with `size` from 0.12 at 0 lines to 0.5 at 2000 lines or more. Nodes with importance above 5 SHALL get a second translucent, additive glow sphere 1.6 times larger. Every change to a node's glow SHALL reach that node's own glow sphere.

#### Scenario: Too many nodes
- **WHEN** 5000 nodes are rendered with `maxNodes` 3000
- **THEN** only the first 3000 are drawn and edges to the rest are skipped

#### Scenario: Rebuild
- **WHEN** `render` is called again
- **THEN** the previous meshes, geometries and materials are disposed first

#### Scenario: Only some nodes glow
- **WHEN** the second of three nodes is the only one with importance above 5 and it is selected
- **THEN** its glow sphere turns cyan, and selecting the first node leaves that glow unchanged

### Requirement: Node colours
Colour SHALL follow `getNodeColor`: folders dim grey; paths with `/test/`, `/tests/`, `/spec/`, `_test.` or `.spec.` grey; paths with `/asset/`, `/assets/`, `/static/`, `/image/`, `/images/`, `/font/` or `/fonts/` yellow; otherwise a per-language colour from the language (with aliases such as `javascript` to `js`) or the extension, else grey `0x6b7280`.

#### Scenario: Test file
- **WHEN** a node's path is `lib/tests/auth_test.dart`
- **THEN** it is coloured test grey, not Dart blue

### Requirement: Typed edges
Edges SHALL be drawn as one `LineSegments` object per edge type, coloured white for `import`, orange for `call`, purple for `inheritance` and teal for `composition`, with opacity 0.35, 0.45, 0.40 and 0.35. Every third frame a type's lines SHALL be shown only when at least one of its edges has both ends within 15 units of the camera.

#### Scenario: Camera far away
- **WHEN** no edge of a type has both ends within 15 units of the camera
- **THEN** that type's lines are hidden

### Requirement: Level of detail
Each frame the viewer SHALL assign every node a tier by camera distance: full below `lodNear`, mid below `lodMid`, dot below `lodFar`, otherwise culled, with a 0.5 unit hysteresis band that keeps the previous tier. Tier scale factors SHALL be 1.0, 0.7, 0.15 and 0, eased over 10 frames.

#### Scenario: Hysteresis
- **WHEN** a node at full detail moves to 5.3 units with `lodNear` 5
- **THEN** it stays at full detail

#### Scenario: Leaving the band
- **WHEN** the same node moves to 5.6 units
- **THEN** it drops to mid detail

### Requirement: Animation loop
`start()` SHALL run one `requestAnimationFrame` loop, ignoring repeat calls and calls during a VR session, that updates level of detail, eases tier changes, updates edge visibility every third frame, updates the controls, renders and tracks frame rate. The first frame SHALL log `[VR PERF] first_frame_ms: <ms>`. The loop SHALL work from the first frame after `render`.

#### Scenario: Started twice
- **WHEN** `start()` is called while the loop runs
- **THEN** no second loop starts

#### Scenario: First frames
- **WHEN** `start()` runs after `render` with edges
- **THEN** each of the first three frames calls `renderer.render`

### Requirement: Frame rate guard
The viewer SHALL keep the last 30 frame times and every 60 frames log `[VR PERF] fps_rolling: <fps>`. When the rolling rate falls below 45 it SHALL enter low performance mode once: scale `lodNear`, `lodMid` and `lodFar` by 0.7 and set every edge opacity to 0.15, warning `[VR] Low perf mode (FPS: <fps>)`.

#### Scenario: Slow machine
- **WHEN** the rolling frame rate is 30
- **THEN** low performance mode turns on and stays on

### Requirement: Selection
A canvas click SHALL raycast the node mesh, select the nearest hit node, colour it cyan `0x22d3ee`, restore the previously selected node's colour and notify `onSelect` listeners with `(nodeId, index)`. A click on empty space SHALL clear the selection and notify `(null, -1)`. A selecting click SHALL also emit `node-selected` with `source: 'click'`.

#### Scenario: Select by id
- **WHEN** `selectNodeById` is called with an id not in the scene
- **THEN** the selection is cleared

#### Scenario: Listener error
- **WHEN** a selection listener throws
- **THEN** the error is logged as `[VR] select listener error:` and other listeners still run

### Requirement: Viewer events
`on(event, fn)` SHALL register listeners called by `_emit`. A listener that throws SHALL be logged as `[VR] event error:` without stopping the others. Events SHALL include `node-selected`, `filter-change`, `change-frequency-loaded`, `git-heatmap-change`, `spec-coverage-change`, `impact-change`, `time-travel-enabled`, `time-travel-change`, `context-panel-update` and `voice-command`.

#### Scenario: Two listeners
- **WHEN** the first `filter-change` listener throws
- **THEN** the second still receives the event

### Requirement: Disposal
`dispose()` SHALL stop the loop and time travel playback, clear highlights, remove the overlay and header controls, remove the resize listener, dispose controls, meshes, geometries, materials and the renderer, remove the canvas, and log `[VR] Scene disposed`.

#### Scenario: Close the viewer
- **WHEN** `dispose()` runs
- **THEN** the canvas and the overlay controls are gone from the container

### Requirement: Cluster lines
Edges between different clusters SHALL also be drawn as one faint line per cluster pair, shown when any cluster is more than 20 units away. Cluster ids MAY be strings such as `src/auth` or numbers.

#### Scenario: Folder cluster ids
- **WHEN** nodes in clusters `src/auth` and `src/db` are joined by an edge
- **THEN** one cluster line joins the two clusters

### Requirement: XR loop handoff
`startXR(onFrame)` SHALL stop the desktop loop and run the same frame work, without the controls, through `renderer.setAnimationLoop`, calling `onFrame` first. `stopXR()` SHALL clear the renderer's loop and restart the desktop loop.

#### Scenario: Back from VR
- **WHEN** `stopXR()` runs after `startXR()`
- **THEN** `renderer.setAnimationLoop(null)` is called and a `requestAnimationFrame` frame is queued
