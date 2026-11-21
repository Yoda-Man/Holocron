## MODIFIED Requirements

### Requirement: Animation loop
`start()` SHALL run one `requestAnimationFrame` loop, ignoring repeat calls and calls during a VR session, that updates level of detail, eases tier changes, updates edge visibility every third frame, updates the controls, renders and tracks frame rate. The first frame SHALL log `[VR PERF] first_frame_ms: <ms>`. The loop SHALL work from the first frame after `render`.

#### Scenario: Started twice
- **WHEN** `start()` is called while the loop runs
- **THEN** no second loop starts

#### Scenario: First frames
- **WHEN** `start()` runs after `render` with edges
- **THEN** each of the first three frames calls `renderer.render`

## ADDED Requirements

### Requirement: XR loop handoff
`startXR(onFrame)` SHALL stop the desktop loop and run the same frame work, without the controls, through `renderer.setAnimationLoop`, calling `onFrame` first. `stopXR()` SHALL clear the renderer's loop and restart the desktop loop.

#### Scenario: Back from VR
- **WHEN** `stopXR()` runs after `startXR()`
- **THEN** `renderer.setAnimationLoop(null)` is called and a `requestAnimationFrame` frame is queued
