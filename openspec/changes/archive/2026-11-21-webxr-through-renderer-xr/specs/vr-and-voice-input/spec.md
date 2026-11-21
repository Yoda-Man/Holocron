## MODIFIED Requirements

### Requirement: VR session
`requestVRSession()` MUST throw `WebXR immersive-vr is not available on this device` when VR is unsupported. It SHALL end any active session first and request `immersive-vr` with required feature `local-floor` and optional `hand-tracking`. It SHALL enable the renderer's WebXR support, use a `local-floor` reference space, start the session through the renderer's WebXR manager, switch the viewer to the XR animation loop and emit `vr-ready`.

#### Scenario: Session goes through the renderer
- **WHEN** a VR session starts
- **THEN** the renderer's WebXR manager receives the session and the renderer's animation loop drives frames

#### Scenario: Session ends
- **WHEN** the XR session fires `end`
- **THEN** controller state is cleared, the XR loop stops, the desktop loop resumes and `vr-end` is emitted once

### Requirement: Controller gestures
Controller poses and select and squeeze events SHALL come from the renderer's WebXR controllers for indices 0 and 1, whose ray and grip spaces are added to the scene. A trigger released under 1000 ms SHALL cast a ray from the controller's pose along its forward direction and emit `node-select` with `nodeId` and `instanceIdx` for a hit. A trigger held 1000 ms or longer SHALL emit `pin-node` with `handedness`. Squeezing both grips SHALL emit `return-to-centre` once per squeeze.

#### Scenario: Long press
- **WHEN** the trigger is held for 1.2 seconds
- **THEN** `pin-node` is emitted instead of a selection

#### Scenario: Short press on a node
- **WHEN** the controller points at a node and the trigger is released at once
- **THEN** `node-select` names that node

## REMOVED Requirements

### Requirement: XR frame loop
**Reason**: three.js's WebXR manager now renders each eye and places the cameras; the controller no longer runs its own per-view loop.
**Migration**: see `XR animation loop`.

## ADDED Requirements

### Requirement: XR animation loop
While a session is active, frames SHALL come only from the renderer's animation loop, which renders the viewer's scene for the headset and polls controller state every second frame. No code SHALL call `requestAnimationFrame` while a session is active.

#### Scenario: XR frames render
- **WHEN** the XR loop runs two frames
- **THEN** the scene is rendered twice

#### Scenario: No window frames in VR
- **WHEN** a session is active and a stale desktop frame or a `start()` call runs
- **THEN** `requestAnimationFrame` is not called
