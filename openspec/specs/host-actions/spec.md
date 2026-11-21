# Host Actions Specification

## Purpose
Host actions are the things a user can do with a selected node through YodaMan's local API: ask the agent, save and restore a view, open the file in VS Code, and record each action in the audit log. They live in `frontend/InfoPanel.jsx` and in `backend/agentClient.js`, `backend/viewStore.js`, `backend/vscodeClient.js` and `backend/auditLogger.js`. All calls go to relative `/api/...` paths on the local host.

## Requirements

### Requirement: Info panel
`InfoPanel` SHALL render nothing without a node. With a node it SHALL show the path, shortened to its first two and last two segments with `…` when longer than 48 characters, plus lines of code, incoming and outgoing dependencies, last changed and test coverage, using a dash for unknown values. It SHALL offer Ask Agent, Find Related, Open in VS Code, Pin Panel and close buttons.

#### Scenario: Long path
- **WHEN** the path is `very/long/path/to/a/deeply/nested/folder/structure/file.dart`
- **THEN** the panel shows `very/long/…/structure/file.dart`

#### Scenario: Agent thinking
- **WHEN** `loading` is true
- **THEN** the Ask Agent button is disabled, pulses and reads `⏳ Thinking…`

### Requirement: Relative time
`formatLastChanged` SHALL return `Unknown` for a missing or invalid time, `Just now` under an hour, `<n>h ago` under a day, `<n>d ago` under a week, `<n>w ago` under 30 days, and the local date otherwise. `formatCoverage` SHALL turn a 0 to 1 fraction into a rounded percentage.

#### Scenario: Three days ago
- **WHEN** the time is 3 days before now
- **THEN** the result is `3d ago`

### Requirement: Ask agent
`askAgent(node, workspacePath, api, onLoading)` SHALL POST `{ path, node }` to `/api/graphify/explain` (10 s timeout), build a prompt naming the file, its size and incoming dependencies, POST `{ task, projectId }` to `/api/agent/task` (15 s timeout), open the `chat` panel with the task id and audit `vr_ask_agent`. It SHALL return `{ taskId }`.

#### Scenario: Request already running
- **WHEN** `askAgent` is called while another request is active
- **THEN** it returns null without a request

#### Scenario: Timeout
- **WHEN** either request times out
- **THEN** it logs `Agent request timed out. Please try again.`, clears loading and returns null

#### Scenario: No task id
- **WHEN** the task response has neither `taskId` nor `id`
- **THEN** it fails with `Agent task response missing taskId` and returns null

### Requirement: Save view
`saveView(camera, selectedNodeId, workspacePath)` SHALL POST a task titled `[VR View] <workspace folder> at <time>` to `/api/agent/task` with `metadata.vrViewState` holding the camera position and quaternion, the selected node, the workspace and a timestamp. On success it SHALL toast `View saved as task <first 8 characters>` and audit `vr_save_view`.

#### Scenario: No camera
- **WHEN** the camera lacks a position or quaternion
- **THEN** it toasts `Could not save view: camera not available` and returns null

### Requirement: Recent and restored views
`loadRecentViews` SHALL GET `/api/agent/tasks`, keep tasks whose title starts with `[VR View]` and that carry a camera position, sort them newest first and cache them for 30 seconds. `restoreView` SHALL apply the saved camera through `viewer.restoreCamera`.

#### Scenario: Incomplete view
- **WHEN** a saved view lacks a camera quaternion
- **THEN** `restoreView` toasts `Cannot restore: camera state is incomplete` and changes nothing

#### Scenario: Tasks request fails
- **WHEN** `/api/agent/tasks` fails
- **THEN** `loadRecentViews` returns an empty list

### Requirement: Open in VS Code
`openInVSCode(node)` SHALL turn backslashes in the node path into slashes, GET `/api/desktop/diagnostics` (5 s timeout) and stop with a warning when `vsCodeAvailable` is false. Otherwise it SHALL POST `{ path }` to `/api/desktop/open-file` (5 s timeout), audit `vr_open_file` and toast `Opened in VS Code: <file name>`.

#### Scenario: VS Code missing
- **WHEN** diagnostics report VS Code not found in PATH
- **THEN** the toast reads `VS Code not found in PATH. Install VS Code or add it to your PATH.`

#### Scenario: Shortcut
- **WHEN** Ctrl+O or Cmd+O is pressed with no node selected
- **THEN** the toast reads `Select a node first (Ctrl+O)`

### Requirement: Audit log
`auditLog(userAction, data)` SHALL POST `{ userAction, plugin: 'graphify-vr-explorer', timestamp, ...data }` to `/api/audit` without waiting and SHALL ignore failures. Helpers SHALL log `vr_explorer_open`, `vr_explorer_close` (with session duration), `vr_mode_enter`, `vr_node_select`, `vr_voice_command`, `vr_ask_agent`, `vr_save_view` and `vr_open_file`.

#### Scenario: Audit endpoint down
- **WHEN** the audit request fails
- **THEN** no error reaches the caller

#### Scenario: Voice command logged
- **WHEN** `logVoiceCommand('hideTests')` runs
- **THEN** only the command name is sent, never the spoken transcript

### Requirement: Local only
Every request in these modules and in `frontend/VRViewer.js` MUST go to a relative `/api/...` path or the viewer's `apiBaseUrl`. No module SHALL call a cloud service or send telemetry.

#### Scenario: Release privacy scan
- **WHEN** the release workflow finds a `fetch(` to a URL that is not `/api/`, `http://localhost` or `file://` in `frontend/`, `backend/` or `main.js`
- **THEN** the release job fails with `FAIL: External URL detected`
