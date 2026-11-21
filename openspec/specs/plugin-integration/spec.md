# Plugin Integration Specification

## Purpose
Plugin integration is how Holocron VR plugs into YodaMan: the manifest `plugin.json`, the lifecycle entry `main.js`, the Plugins-tab card `frontend/UIPanel.jsx` and the settings drawer `frontend/SettingsPanel.jsx`. YodaMan core vendors the built `dist/main.js` and `dist/plugin.json` as `plugins/main.js` and `plugins/plugin.json`, so a change here must be synced into core.

## Requirements

### Requirement: Manifest
`plugin.json` SHALL name the plugin `holocron-vr` with display name `Holocron VR`, entry `main.js`, `minYodaManVersion` `0.3.8` and `mandatory` false. It SHALL list the permissions `graphify:read`, `agent:invoke`, `audit:write`, `task:create`, `desktop:openFile`, `storage:indexeddb`, `webxr`, `speech`, `git:read`, `upload:temp` and `filesystem:read-selected`.

#### Scenario: Same permissions in code
- **WHEN** `main.js` is loaded
- **THEN** its `permissions` array holds the same eleven entries as `plugin.json`

### Requirement: Version moves together
The version in `package.json` and `plugin.json` MUST be the same, and SHALL be 0.6.7 today. The built `dist/plugin.json` SHALL be produced from `plugin.json` by the build, so it carries the same version.

#### Scenario: Release version
- **WHEN** `npm run build` packages the plugin
- **THEN** the zip is named `holocron-vr-<package.json version>.zip`

### Requirement: Config schema
`plugin.json` SHALL declare `configSchema` with `lodNear` 5, `lodMid` 15, `lodFar` 30, `maxNodes` 3000 and `voiceEnabled` true. These defaults SHALL match the viewer's own defaults.

#### Scenario: Defaults agree
- **WHEN** a `VRViewer` is created with no options
- **THEN** its `lodNear`, `lodMid`, `lodFar` and `maxNodes` equal the manifest defaults

### Requirement: Execute actions
`main.js` SHALL export a CommonJS object whose `execute(params)` answers `_action` `open` with `{ opened: true, renderer: 'yodaman-host', project, message: 'Holocron VR launch accepted by the YodaMan host.' }`, `enable`, `disable` and `unload` with `{ enabled | disabled | unloaded: true }`, and anything else with `{ ok: true, name: 'holocron-vr' }`.

#### Scenario: Open request
- **WHEN** `execute({ _action: 'open', project: 'p1' })` is called
- **THEN** the result has `opened: true` and `project: 'p1'`

### Requirement: Load hook
`onLoad(api)` SHALL fetch `/api/graphify/status` and warn `[VR] Graphify not available; plugin loaded but inactive` when `available` is false, or `[VR] Could not reach Graphify API; plugin loaded but inactive` when the request fails. It SHALL then register the plugin card `constellation-vr-card` with component `./frontend/UIPanel.jsx` and log `[VR] Plugin loaded successfully`.

#### Scenario: Graphify down
- **WHEN** the status request throws
- **THEN** the plugin still registers its card

### Requirement: Enable and disable hooks
`onEnable(api)` SHALL register shortcut `constellation-vr-open` on Ctrl+Shift+V that opens the full-screen, closable modal `constellation-vr-modal` with component `./frontend/VRViewer.js`. It SHALL start no worker. `onDisable(api)` SHALL terminate all workers and unregister the shortcut. `onUnload(api)` SHALL terminate all workers. Every file path `main.js` and `plugin.json` name SHALL exist.

#### Scenario: Disable
- **WHEN** the user disables the plugin
- **THEN** the log reads `[VR] Plugin disabled` and Ctrl+Shift+V no longer opens the modal

#### Scenario: Named files exist
- **WHEN** a path in `main.js` or `plugin.json` is resolved against the repository
- **THEN** the file exists, with `.jsx` sources standing for their built `.js`

### Requirement: Launch card
`UIPanel` SHALL render a `Launch VR Explorer` button. On click it SHALL check `api.graphify.status()` when present, then open modal `constellation-vr-modal` with component `./frontend/VRViewer.js`, full screen and closable. It SHALL show `Launching…` and disable the button while working.

#### Scenario: Graphify empty
- **WHEN** the status call does not return `ok: true`
- **THEN** an info message says the constellation will be empty and suggests Sync Repository

#### Scenario: Launch fails
- **WHEN** opening the modal throws
- **THEN** an error message starts `Failed to launch VR Explorer:` and mentions WebGL and port 3090

### Requirement: Settings drawer
`SettingsPanel` SHALL load each key of `DEFAULTS` (`lodNear` 5, `lodMid` 15, `lodFar` 30, `maxNodes` 3000, `voiceEnabled` true, `comfortMode` true, `theme` `auto`) from `api.config.get('graphify-vr-explorer.<key>')` when opened. Save SHALL write every key with `api.config.set`, call `onSave` and close. Reset Defaults SHALL write and pass the defaults.

#### Scenario: Ranges
- **WHEN** a threshold is typed as 500
- **THEN** it is clamped to 100, and `maxNodes` moves from 500 to 10000 in steps of 100

#### Scenario: Config errors
- **WHEN** `api.config.get` throws for a key
- **THEN** that key keeps its default

### Requirement: Show checkboxes
A "Show" checkbox in the settings drawer SHALL be checked when its hide filter is off, and checking it SHALL turn that filter off. Language chips SHALL toggle filters the viewer accepts.

#### Scenario: Show test files
- **WHEN** "Show test files" is checked
- **THEN** `onFilterChange('tests', false)` is called
