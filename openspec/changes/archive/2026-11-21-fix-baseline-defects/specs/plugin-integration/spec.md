## MODIFIED Requirements

### Requirement: Version moves together
The version in `package.json` and `plugin.json` MUST be the same, and SHALL be 0.6.7 today. The built `dist/plugin.json` SHALL be produced from `plugin.json` by the build, so it carries the same version.

#### Scenario: Release version
- **WHEN** `npm run build` packages the plugin
- **THEN** the zip is named `holocron-vr-<package.json version>.zip`

### Requirement: Enable and disable hooks
`onEnable(api)` SHALL register shortcut `constellation-vr-open` on Ctrl+Shift+V that opens the full-screen, closable modal `constellation-vr-modal` with component `./frontend/VRViewer.js`. It SHALL start no worker. `onDisable(api)` SHALL terminate all workers and unregister the shortcut. `onUnload(api)` SHALL terminate all workers. Every file path `main.js` and `plugin.json` name SHALL exist.

#### Scenario: Disable
- **WHEN** the user disables the plugin
- **THEN** the log reads `[VR] Plugin disabled` and Ctrl+Shift+V no longer opens the modal

#### Scenario: Named files exist
- **WHEN** a path in `main.js` or `plugin.json` is resolved against the repository
- **THEN** the file exists, with `.jsx` sources standing for their built `.js`

### Requirement: Settings drawer
`SettingsPanel` SHALL load each key of `DEFAULTS` (`lodNear` 5, `lodMid` 15, `lodFar` 30, `maxNodes` 3000, `voiceEnabled` true, `comfortMode` true, `theme` `auto`) from `api.config.get('graphify-vr-explorer.<key>')` when opened. Save SHALL write every key with `api.config.set`, call `onSave` and close. Reset Defaults SHALL write and pass the defaults.

#### Scenario: Ranges
- **WHEN** a threshold is typed as 500
- **THEN** it is clamped to 100, and `maxNodes` moves from 500 to 10000 in steps of 100

#### Scenario: Config errors
- **WHEN** `api.config.get` throws for a key
- **THEN** that key keeps its default

## REMOVED Requirements

### Requirement: UI extensions
**Reason**: Nothing in YodaMan renders `uiExtensions`, and the `Agent` entry named `frontend/AgenticChat.jsx` and `assets/chat-icon.svg`, which do not exist. Core 0.6.7 already dropped them from its copy.
**Migration**: The Plugins-tab card registered by `onLoad` is the plugin's UI entry.

## ADDED Requirements

### Requirement: Show checkboxes
A "Show" checkbox in the settings drawer SHALL be checked when its hide filter is off, and checking it SHALL turn that filter off. Language chips SHALL toggle filters the viewer accepts.

#### Scenario: Show test files
- **WHEN** "Show test files" is checked
- **THEN** `onFilterChange('tests', false)` is called
