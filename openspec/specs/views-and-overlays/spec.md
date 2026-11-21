# Views and Overlays Specification

## Purpose
Views and overlays change what the constellation shows without changing the graph: node filters, real git change counts, and four overlays reached from buttons in the viewer header (Time, Heatmap, Coverage, Impact). They live in `frontend/VRViewer.js` and call YodaMan's local `/api/git/*`, `/api/stardust/drift` and `/api/graphify/affected` routes, prefixed by the `apiBaseUrl` option.

## Requirements

### Requirement: Filters
`setFilter(type, enabled)` SHALL accept only the keys `tests`, `thirdParty`, `generated`, `recent`, `dart`, `json`, `yaml`, `markdown`, `typescript`, `javascript` and `python`, warn `[VR] Unknown filter type: <type>` for any other key, and emit `filter-change`. A node SHALL be shown only when it passes every active filter. Hidden nodes and their glow SHALL be scaled to zero, and shown again when the filter turns off. `render` SHALL reset all filters to off.

#### Scenario: Unknown key
- **WHEN** `setFilter('rust', true)` is called
- **THEN** a warning is logged and nothing changes

#### Scenario: No filters
- **WHEN** every filter is off
- **THEN** every rendered node is visible

#### Scenario: Glow follows its node
- **WHEN** a filter hides a node without glow
- **THEN** the glow of every visible node is untouched

### Requirement: Hide filters
With `tests` on, nodes whose path matches `/test/`, `/tests/`, `/spec/`, `_test.` or `.spec.` SHALL be hidden. With `thirdParty` on, nodes for which `isIgnoredPath` is true or whose path has `/.pub-cache/` SHALL be hidden. With `generated` on, `.g.dart`, `.freezed.dart` and `/generated/` paths SHALL be hidden.

#### Scenario: Hide third-party code
- **WHEN** `thirdParty` is on
- **THEN** a node at `app/node_modules/react/index.js` is hidden

### Requirement: Language filters
A language filter SHALL show only nodes of that language. Languages SHALL be compared through the colour alias table, so `typescript` matches `ts` and `tsx`, `javascript` matches `js`, `python` matches `py` and `markdown` matches `md`. Two language filters on at once SHALL therefore show nothing.

#### Scenario: Dart only
- **WHEN** `dart` is on
- **THEN** only nodes with language `dart` stay visible

#### Scenario: Short language names
- **WHEN** `markdown` is on
- **THEN** a node with language `md` stays visible

### Requirement: Recent filter
With `recent` on, a node SHALL be shown when its change frequency is at least the threshold, 3 by default and set by `setRecentThreshold`. A node whose change frequency is unknown SHALL be shown, so missing git data never hides the graph.

#### Scenario: No git data
- **WHEN** `recent` is on and no change counts are known
- **THEN** every node stays visible

### Requirement: Real change counts
After each `render`, the viewer SHALL fetch `/api/git/heatmap?path=<workspace>` without blocking and set each matched node's change frequency from `changeCount` or `commits`. When at least one node matched, the rest SHALL become 0. It SHALL emit `change-frequency-loaded` with `applied` and `available`, and `hasRealChangeData()` SHALL report the result.

#### Scenario: Not a repository
- **WHEN** the heatmap request fails or returns an error status
- **THEN** change counts stay unknown and the view still renders

### Requirement: Path matching
Overlays SHALL match a file to a node by exact id first, then by the node id as a lower-cased, slash-normalised path with a leading `./` removed that is equal to, or ends with `/` plus, the other path.

#### Scenario: Relative and absolute paths
- **WHEN** git reports `src/app.js` and the node id is `/repo/src/app.js`
- **THEN** the file matches that node

### Requirement: Header controls
`init()` SHALL add a header in the top right with the buttons Time, Heatmap, Coverage and Impact, labelled `Time Travel`, `Git Heatmap`, `Spec Coverage` and `Blast radius of selection`, which call `enableTimeTravelMode`, `toggleGitHeatmap`, `toggleSpecCoverage` and `showImpactForSelection`.

#### Scenario: Viewer opens
- **WHEN** `init()` completes
- **THEN** the four buttons are children of the container

### Requirement: Git heatmap
`toggleGitHeatmap` SHALL fetch `/api/git/heatmap` and colour nodes with 10 or more changes red `0xff3b30` and 3 to 9 orange `0xff9500`, remembering original colours, and emit `git-heatmap-change`. A second toggle SHALL restore the remembered colours. A failed request SHALL throw `Failed to fetch Git heatmap: <status>`.

#### Scenario: Toggle off
- **WHEN** the heatmap is on and the button is pressed
- **THEN** every recoloured node returns to its original colour

### Requirement: Spec coverage
`toggleSpecCoverage` SHALL fetch `/api/stardust/drift?projectRoot=<workspace>` and colour each `undocumented` file by `dependents`: 5 or more red, 3 or 4 orange, otherwise yellow `0xffd60a`. It SHALL emit `spec-coverage-change` with `marked`, `covered`, `undocumentedCount` and `staleCount`, and keep its own colour memory.

#### Scenario: Drift unavailable
- **WHEN** the report has `available: false`
- **THEN** no node changes and `spec-coverage-change` carries `enabled: false` and the report's reason

#### Scenario: Request fails
- **WHEN** the drift request throws or returns an error status
- **THEN** the overlay stays off and the view keeps rendering

### Requirement: Impact
`showImpactForSelection` SHALL POST `{ path, node, depth: 2 }` to `/api/graphify/affected` with the workspace and the selected node's id, colour reached nodes orange and the origin red `0xff3b30`, and emit `impact-change` with `reached`. A second press SHALL restore colours. Without a selection it SHALL emit `impact-change` with reason `select a node first`.

#### Scenario: Nothing reachable
- **WHEN** the response lists no affected files
- **THEN** no colour changes and the event has reason `nothing reachable`

#### Scenario: Response shapes
- **WHEN** the response uses `affected`, `nodes` or `results`, with strings or objects holding `file`, `id` or `node`
- **THEN** each entry is read as a file

### Requirement: Time travel
`enableTimeTravelMode` SHALL fetch `/api/git/history?path=<workspace>` once per workspace (cached on the class), show a bottom overlay with Play, a commit slider and commit details, and select the newest commit. Moving to a commit SHALL load its files from `/api/git/commit` when missing and pulse each matched node white and 1.7 times larger for 2 seconds.

#### Scenario: Play
- **WHEN** Play is pressed
- **THEN** the viewer steps one commit per second to the end and the button reads `Pause` while playing

#### Scenario: No history
- **WHEN** the history is empty
- **THEN** the slider and Play are disabled and the label reads `No Git history available`

### Requirement: Viewer voice actions
`handleVoiceCommand(action, param)` SHALL route `timeTravelLastWeek` (commits from the last 7 days), `timeTravelDate` (first commit whose weekday or ISO date matches), `timeTravelEvolution` (commits touching a file containing the text, then play), `flyToNode`, `showAll`, `hideTests` and `showTests`. Other actions SHALL be emitted as `voice-command`.

#### Scenario: Show all
- **WHEN** `showAll` is handled
- **THEN** every filter is set to off
