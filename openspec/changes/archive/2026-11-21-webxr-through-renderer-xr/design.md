## Context
See proposal.md. three 0.187's `WebGLRenderer` has a `WebXRManager` (`renderer.xr`). When a session is set, it owns the base layer, per-eye cameras and the session's frame callback. `renderer.setAnimationLoop` runs on that callback while presenting.

## Goals / Non-Goals
- Goal: the VR path uses only three.js's WebXR API. The desktop view behaves as before.
- Non-goal: hand-tracking models, controller meshes, or wiring a host "Enter VR" button. No host calls `VRController` yet.

## Decisions
- **Desktop keeps `requestAnimationFrame`.** `VRViewer.start()` is unchanged on desktop. `startXR(onFrame)` cancels it and calls `renderer.setAnimationLoop`. `stopXR()` clears the loop and calls `start()`. Alternative: always use `setAnimationLoop`, which three switches itself. Rejected to keep the desktop path exactly as it was.
- **One frame body.** The old loop body moves to `_renderFrame()`, shared by both loops. OrbitControls is skipped in XR, where the headset drives the camera.
- **Reuse `isVRActive`.** The viewer already declared it and never set it. It now marks the XR loop. A desktop frame that fires after the switch stops instead of requeueing.
- **Controllers from three.js.** `getController(i)` groups carry the target ray pose in `matrixWorld`. Raycasts and fly direction read from it. `connected` events give handedness. Thumbstick axes still come from `session.inputSources` gamepads, which three.js does not wrap.
- **One cleanup path.** The session `end` event and `endSession()` both run `_cleanupSession()`, which calls `viewer.stopXR()`. A guard stops the second call from emitting `vr-end` twice.

## Risks / Trade-offs
- [No headset to test on] → tests drive the real modules with a fake `navigator.xr` session and a renderer stub that records `renderer.xr` calls. On-device checking is still owed.
- [three.js API changes] → the calls used are long-stable and checked against 0.187 source.
