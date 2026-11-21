## Why
Writing the baseline spec (2026-11-21) found twelve defects. Some stop the viewer from rendering at all, and several make controls do the opposite of what they say. They shipped because no test exercised the paths involved.

## What Changes
- `frontend/VRViewer.js`: set up `_lodTransitions` and `_lodSwapThrottle` before the first frame, so `start()` reaches `renderer.render`.
- Cluster ids are strings (for example `src/auth`) but go into an `Int32Array`, so every cluster becomes 0 and cluster lines never draw. Map ids to integers once, in `VRViewer.js:455`, `layoutWorker.js:173` (WASM path) and `layoutWorker.js:291` (JS fallback).
- `VRViewer.js:1131,1335`: index the glow mesh by glow index, not node index.
- Filters: the TS, JS and Python chips are refused as unknown (`VRViewer.js:1261`, `SettingsPanel.jsx:422`), and `markdown` never matches `md`.
- `SettingsPanel.jsx:390`: "Show test files" enables the filter that hides tests.
- `layoutWorker.js:223`: memory is freed after every layout, so `refine` returns empty positions.
- `frontend/VRController.js`: import `THREE`; line 447 passes a `Matrix4` to `fromArray`.
- `frontend/voiceCommands.js:41,59,67`: "find similar" and "what can I say" can never match; the unit test checks its own copy of the parser instead of the real one.
- `frontend/InfoPanel.jsx:231`: an early return before hooks breaks React's hook order.
- `main.js:74,85` and `plugin.json:29` name files that do not exist (`backend/graphCache.js`, `#VRExplorerModal`, `AgenticChat.jsx`, `chat-icon.svg`). YodaMan core vendors `main.js` and `plugin.json`, so sync the fix there.
- `plugin.json` declares `uiExtensions` that nothing in YodaMan renders; core 0.6.7 removed them from its copy.
- Version 0.6.7, in step with YodaMan.
- `.github/workflows/release.yml:112` names the zip `graphify-vr-explorer-*`; `scripts/package-release.sh` makes `holocron-vr-*`.
- `.github/workflows/ci.yml:92`: the privacy scan can never fail.
- Decide whether `VRController`, `voiceCommands`, `SettingsPanel`, `InfoPanel` and the backend clients, which no build entry reaches, should be wired in or deleted.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `scene-rendering`, `layout-engine`, `views-and-overlays`, `vr-and-voice-input`, `plugin-integration`, `build-and-release`: requirements stay; scenarios that today describe intended behaviour become true.

## Impact
Frontend viewer, layout worker, settings and voice code, plugin manifest (vendored into YodaMan core: `plugins/main.js`, `plugins/plugin.json`), CI and release workflows. Every fix needs a regression test that fails without it, and a guard test where the bug is one of a class (for example, unit tests must import the real module, not a copy).
