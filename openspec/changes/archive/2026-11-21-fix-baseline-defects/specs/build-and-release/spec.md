## MODIFIED Requirements

### Requirement: Vite bundle
`vite build` SHALL bundle every entry listed in the Build entries requirement into `dist/` with the same paths and `.js` names, as compact CommonJS with source maps, target `es2020`. `react`, `react-dom`, the JSX runtimes and `three` SHALL stay external, supplied by the host.

#### Scenario: Built entry
- **WHEN** `npm run build` finishes
- **THEN** `dist/main.js` exists and assigns `module.exports`

#### Scenario: Dev flag
- **WHEN** `NODE_ENV` is `production`
- **THEN** `__DEV__` is defined as `false`, and otherwise `true`

### Requirement: Static copies
The build SHALL copy `plugin.json` to `dist/plugin.json` unchanged, and SHALL copy the whole `assets/` folder to `dist/assets/`, keeping `screenshots/` and `shaders/` (`node.frag`, `node.vert`).

#### Scenario: Shaders shipped
- **WHEN** the build runs
- **THEN** `dist/assets/shaders/node.frag` and `dist/assets/shaders/node.vert` exist

### Requirement: Unit tests
`npm run test:unit` SHALL run Jest with ES modules in a Node environment on `tests/unit/**/*.test.js` and `*.test.mjs`. `npm run test:unit:coverage` SHALL measure `backend/**` and fail below 17% branches, 18% functions, 11% lines or 12% statements. A unit test SHALL import the module it checks and MUST NOT redeclare a function or constant of a module under `frontend/` or `backend/`.

#### Scenario: Coverage gate
- **WHEN** backend line coverage falls to 10%
- **THEN** `npm run test:unit:coverage` fails

#### Scenario: Copied logic
- **WHEN** a test file declares its own `parseCommand`
- **THEN** the guard test fails naming the file

### Requirement: Tagged release
`release.yml` SHALL run on tags matching `v*.*.*`. It SHALL build and test the engine, build the plugin, run unit tests, fail on an external `fetch(` URL, run the layout benchmark, and publish a GitHub release named `Holocron VR <tag>` with the `holocron-vr-<version>.zip` that `npm run build` makes.

#### Scenario: Pre-release tag
- **WHEN** the tag contains `-beta` or `-rc`
- **THEN** the GitHub release is marked as a pre-release

### Requirement: Continuous integration
`ci.yml` SHALL run on every push and on pull requests to `main`. The `validate` job on Ubuntu with Node 24 SHALL install Emscripten, run `build:wasm`, `test:wasm`, `test:unit`, `test:unit:coverage`, `npm run build`, check `plugin.json` is valid JSON, require `dist/plugin.json` and `dist/main.js`, fail when the privacy scan finds an external URL, and upload `plugin-build`.

#### Scenario: Other platforms
- **WHEN** CI runs
- **THEN** `test-macos` and `test-windows` run `npm run test:unit`, and `benchmark` runs `bench:layout:json` after `validate`

#### Scenario: Audit is advisory
- **WHEN** `npm audit --audit-level=moderate` finds issues
- **THEN** the job continues

#### Scenario: Privacy finding
- **WHEN** a source file fetches an external URL
- **THEN** the privacy scan step exits non-zero

## ADDED Requirements

### Requirement: Build entries
The entries SHALL be `main.js`, `frontend/UIPanel.jsx`, `frontend/VRViewer.js`, `frontend/VRController.js`, `frontend/voiceCommands.js`, `frontend/InfoPanel.jsx`, `frontend/SettingsPanel.jsx` and the backend modules `graphProcessor`, `layoutStore`, `agentClient`, `agentContextProvider`, `viewStore`, `vscodeClient`, `auditLogger` and `perfLogger`. `frontend/layoutWorker.js` and `frontend/bindLayoutEngine.js` SHALL ship as source.

#### Scenario: Every module reached
- **WHEN** a module under `frontend/` or `backend/` is neither reached from a build entry nor shipped as source
- **THEN** a unit test fails naming it
