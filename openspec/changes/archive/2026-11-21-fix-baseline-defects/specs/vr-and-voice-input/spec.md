## MODIFIED Requirements

### Requirement: XR frame loop
Each XR frame SHALL render the viewer's scene once per view, using that view's projection matrix and placing the viewer camera at that view's pose, and SHALL poll controller state every second frame.

#### Scenario: Two eyes
- **WHEN** the viewer pose has two views
- **THEN** the scene is rendered twice into the layer's framebuffer

#### Scenario: Camera follows the view
- **WHEN** a view's pose is at (1, 1.6, 2)
- **THEN** the viewer camera is at (1, 1.6, 2) when that view renders

### Requirement: Controller gestures
A trigger released under 1000 ms SHALL cast a ray from the controller's pose along its forward direction and emit `node-select` with `nodeId` and `instanceIdx` for a hit. A trigger held 1000 ms or longer SHALL emit `pin-node` with `handedness`. Squeezing both grips SHALL emit `return-to-centre` once per squeeze.

#### Scenario: Long press
- **WHEN** the trigger is held for 1.2 seconds
- **THEN** `pin-node` is emitted instead of a selection

#### Scenario: Short press on a node
- **WHEN** the controller points at a node and the trigger is released at once
- **THEN** `node-select` names that node

### Requirement: Command parsing
`parseCommand(transcript)` SHALL lower-case and trim the text, remove filler words such as `um`, `please`, `can` and `you`, and return `{ action, param }` for the first matching pattern in `COMMANDS`, or null. Actions SHALL include `showCluster`, `flyToNode`, `flyToOrigin`, `showDeps`, `showDependents`, `hideTests`, `showTests`, `showAll`, `askAgent`, `findSimilar`, `openInEditor`, `saveView`, `help` and three time travel actions. Every pattern SHALL be reachable.

#### Scenario: Fillers removed
- **WHEN** the transcript is `um show me auth please`
- **THEN** the result is `{ action: 'showCluster', param: 'auth' }`

#### Scenario: First match wins
- **WHEN** the transcript is `find tests`
- **THEN** the result is `flyToNode` with param `tests`

#### Scenario: Time travel phrase
- **WHEN** the transcript is `what changed on monday`
- **THEN** the result is `timeTravelDate` with param `monday`

#### Scenario: Find similar
- **WHEN** the transcript is `find similar files`
- **THEN** the result is `findSimilar`

#### Scenario: What can I say
- **WHEN** the transcript is `what can I say`
- **THEN** the result is `help`
