## 1. WebXR through renderer.xr
- [x] 1.1 Move the frame body in `VRViewer.js` to `_renderFrame()`; add `startXR(onFrame)` with `renderer.setAnimationLoop` and `stopXR()` that resumes `start()`; reuse `isVRActive`
- [x] 1.2 In `VRController.js`, start the session with `renderer.xr.enabled`, `setReferenceSpaceType('local-floor')` and `renderer.xr.setSession`; drop the hand-built `XRWebGLLayer` loop
- [x] 1.3 Take controllers from `renderer.xr.getController(i)` and `getControllerGrip(i)`; raycast and fly from their world matrix
- [x] 1.4 Resume the desktop loop once on session end, from either the `end` event or `endSession()`
- [x] 1.5 Regression test with a fake `navigator.xr` session and the real modules; guard that nothing calls `requestAnimationFrame` during a session; prove both fail on the original files

## 2. README counts
- [x] 2.1 Recount and fix the counts in `README.md` and `USER_MANUAL.md`
- [x] 2.2 Add `tests/unit/readmeCounts.test.js`; prove it fails on the old README

## 3. Close
- [x] 3.1 `openspec validate --strict`
- [x] 3.2 `npm run test:unit`, `npm run test:wasm`, `npm run build`
- Verify, then archive the change
