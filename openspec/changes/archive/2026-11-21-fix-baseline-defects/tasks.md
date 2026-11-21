## 1. Viewer renders
- [x] 1.1 Initialise LOD state in `VRViewer.js` before the first frame; test that `start()` renders one frame
- [x] 1.2 Map string cluster ids to integers for the viewer and both layout paths; test that cluster lines draw for `src/auth`-style ids
- [x] 1.3 Index the glow mesh by glow index; test with nodes where only some glow
- [x] 1.4 Keep layout memory for `refine`; test that refine returns positions

## 2. Controls do what they say
- [x] 2.1 Accept the TS, JS, Python and markdown (`md`) filters; test each chip
- [x] 2.2 "Show test files" shows tests; test it
- [x] 2.3 Fix `VRController.js` imports and `fromArray`; test controller setup
- [x] 2.4 Fix voice command matching; make the unit test import the real parser; guard test that tests import modules under `frontend/`, not copies
- [x] 2.5 Move `InfoPanel` hooks above the early return; test render with and without a node

## 3. Plugin and release
- [x] 3.1 Remove or create the missing files `main.js` and `plugin.json` name; sync into YodaMan core `plugins/`
- [x] 3.2 Make `release.yml` use the zip name `package-release.sh` produces
- [x] 3.3 Make the CI privacy scan fail on a finding; prove it with a planted finding
- [x] 3.4 Wire in or delete modules no build entry reaches
- [x] 3.5 Drop `uiExtensions` from `plugin.json`: nothing in YodaMan renders it, and core 0.6.7 already removed it from its copy
- [x] 3.6 Move the version to 0.6.7 with YodaMan (`package.json`, `plugin.json`, `dist/plugin.json`); core's `plugins/plugin.json` and its website download link already say 0.6.7

## 4. Close
- [x] 4.1 Update the affected spec scenarios; `openspec validate --specs --strict`
- [x] 4.2 Run unit and WASM tests and the build
