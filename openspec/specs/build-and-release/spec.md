# Build and Release Specification

## Purpose
Build and release turns the source into the plugin YodaMan loads and the zip users download, and checks it on every push. It lives in `package.json` scripts, `vite.config.js`, `scripts/package-release.sh`, `scripts/clean.mjs`, `jest.config.js`, `tests/`, `scripts/bench-*.js` and the workflows `.github/workflows/ci.yml` and `.github/workflows/release.yml`. Node 24 or later is required (`engines.node` `>=24`).

## Requirements

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

### Requirement: No source-only references
The `rewrite-jsx-paths` plugin SHALL change `.jsx` followed by `"`, `'`, a backtick or `#` to `.js` in every emitted chunk. `scripts/package-release.sh` MUST then fail with `dist/ still references .jsx files:` and exit 1 when any `dist/*.js` file still has such a reference.

#### Scenario: Card component path
- **WHEN** `main.js` registers `./frontend/UIPanel.jsx`
- **THEN** `dist/main.js` registers `./frontend/UIPanel.js`

### Requirement: Release zip
`npm run build` SHALL run `vite build` and then `scripts/package-release.sh`, which zips `dist`, `plugin.json`, `assets`, `frontend`, `backend`, `README.md` and `USER_MANUAL.md`, without `.DS_Store` files, into `holocron-vr-<version>.zip` at the repository root, replacing any old zip.

#### Scenario: Core checkout beside it
- **WHEN** `../core/website` exists
- **THEN** the zip is also copied to `../core/website/downloads/holocron-vr-<version>.zip`

#### Scenario: Standalone checkout
- **WHEN** `../core/website` does not exist
- **THEN** the script prints `No core checkout beside this one; skipped the website copy.` and still succeeds

### Requirement: Clean scripts
`scripts/clean.mjs` SHALL remove each path given as an argument, recursively and without failing on missing paths, and print `clean: removed <n> of <m> target(s)`. With no arguments it SHALL print usage and exit 1. `npm run clean` SHALL remove `dist`; `npm run clean:wasm` SHALL remove the compiled engine files in `frontend/`.

#### Scenario: Nothing to clean
- **WHEN** `npm run clean` runs and `dist` does not exist
- **THEN** it prints `clean: removed 0 of 1 target(s)` and exits 0

### Requirement: Unit tests
`npm run test:unit` SHALL run Jest with ES modules in a Node environment on `tests/unit/**/*.test.js` and `*.test.mjs`. `npm run test:unit:coverage` SHALL measure `backend/**` and fail below 17% branches, 18% functions, 11% lines or 12% statements. A unit test SHALL import the module it checks and MUST NOT redeclare a function or constant of a module under `frontend/` or `backend/`.

#### Scenario: Coverage gate
- **WHEN** backend line coverage falls to 10%
- **THEN** `npm run test:unit:coverage` fails

#### Scenario: Copied logic
- **WHEN** a test file declares its own `parseCommand`
- **THEN** the guard test fails naming the file

### Requirement: Integration and privacy tests
`npm run test:int` SHALL run Playwright with `tests/integration/playwright.config.js`, covering `graphify.test.js`, `lifecycle.test.js`, `wasm.test.js` and every test in `tests/privacy/`. `test:int:headed` SHALL set `HEADFUL=1` and `test:int:debug` SHALL set `PWDEBUG=1`.

#### Scenario: Privacy suite
- **WHEN** `npm run test:int` runs
- **THEN** the network isolation, audit log and voice transcript tests in `tests/privacy/` run too

### Requirement: Benchmarks
`npm run bench:layout` SHALL time the JavaScript force layout for 100 to 5000 nodes. `bench:fps` SHALL measure frame rate with 3000 nodes in headless Chromium and `bench:memory` SHALL check heap growth over 10 open and close cycles. Each `:json` variant SHALL pass `--json`; `bench:all` SHALL run all three.

#### Scenario: Machine-readable output
- **WHEN** `npm run bench:layout:json` runs
- **THEN** the script receives `--json` and prints JSON only

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

### Requirement: Tagged release
`release.yml` SHALL run on tags matching `v*.*.*`. It SHALL build and test the engine, build the plugin, run unit tests, fail on an external `fetch(` URL, run the layout benchmark, and publish a GitHub release named `Holocron VR <tag>` with the `holocron-vr-<version>.zip` that `npm run build` makes.

#### Scenario: Pre-release tag
- **WHEN** the tag contains `-beta` or `-rc`
- **THEN** the GitHub release is marked as a pre-release

### Requirement: Workflow guard
`tests/unit/ciWorkflow.test.js` SHALL parse every workflow with `js-yaml` and SHALL check that `ci.yml` installs Emscripten, builds the module without hiding failures, runs the compiled engine and builds before the tests that need it.

#### Scenario: Engine never run
- **WHEN** `ci.yml` stops running `npm run test:wasm`
- **THEN** the unit test fails

### Requirement: Build entries
The entries SHALL be `main.js`, `frontend/UIPanel.jsx`, `frontend/VRViewer.js`, `frontend/VRController.js`, `frontend/voiceCommands.js`, `frontend/InfoPanel.jsx`, `frontend/SettingsPanel.jsx` and the backend modules `graphProcessor`, `layoutStore`, `agentClient`, `agentContextProvider`, `viewStore`, `vscodeClient`, `auditLogger` and `perfLogger`. `frontend/layoutWorker.js` and `frontend/bindLayoutEngine.js` SHALL ship as source.

#### Scenario: Every module reached
- **WHEN** a module under `frontend/` or `backend/` is neither reached from a build entry nor shipped as source
- **THEN** a unit test fails naming it
