## Why
VR rendered outside three.js's WebXR support. `VRController` built its own `XRWebGLLayer` and frame loop beside a renderer that knew nothing of the session, so frames may never reach the headset and controller poses were read by hand. The README also stated stale counts (173 unit tests, 52 intrinsics, a 601-line manual). Both should be right in 0.6.7.

## What Changes
- The VR session starts and ends through `renderer.xr.setSession`, with `renderer.xr.enabled` set and a `local-floor` reference space.
- XR frames run through `renderer.setAnimationLoop`. The desktop `requestAnimationFrame` loop stops while a session is active and resumes when it ends.
- Controller poses and select and squeeze events come from `renderer.xr.getController(i)` and `getControllerGrip(i)`.
- **BREAKING** (internal): `requestVRSession()` no longer takes a GL context. No host calls it today.
- README and USER_MANUAL counts are corrected, and a unit test fails when they drift.

## Capabilities
### New Capabilities
None.

### Modified Capabilities
- `vr-and-voice-input`: VR session, XR frame loop and controller gestures go through three.js's WebXR manager.
- `scene-rendering`: the animation loop yields to the XR loop during a session.
- `build-and-release`: adds a guard on the counts the docs state.

## Impact
`frontend/VRController.js`, `frontend/VRViewer.js`, `README.md`, `USER_MANUAL.md`, `tests/unit/VRController.test.js`, new `tests/unit/readmeCounts.test.js`. Both frontend files are Vite entries, so `dist/frontend/` changes. No new dependency: three 0.187 already ships `renderer.xr`.
