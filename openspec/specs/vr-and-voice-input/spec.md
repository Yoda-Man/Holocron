# VR and Voice Input Specification

## Purpose
VR and voice input covers the WebXR headset session with controller gestures in `frontend/VRController.js`, and spoken commands with keyboard fallbacks in `frontend/voiceCommands.js`. Both are event emitters that a host wires to a `VRViewer`. Both are Vite build entries, compiled into `dist/frontend/`.

## Requirements

### Requirement: WebXR availability
`checkAvailability()` SHALL return true only when `navigator.xr.isSessionSupported('immersive-vr')` resolves true. When WebXR is absent it SHALL return false; when the check is unsupported or throws it SHALL also emit `fallback` with a reason. `checkARAvailability()` SHALL report `immersive-ar` support and never throw.

#### Scenario: No headset
- **WHEN** `immersive-vr` is not supported
- **THEN** `fallback` is emitted with reason `immersive-vr not supported`

### Requirement: VR session
`requestVRSession(gl)` MUST throw `WebXR immersive-vr is not available on this device` when VR is unsupported. It SHALL end any active session first, request `immersive-vr` with required feature `local-floor` and optional `hand-tracking`, attach an `XRWebGLLayer`, start its own XR frame loop and emit `vr-ready`.

#### Scenario: Session ends
- **WHEN** the XR session fires `end`
- **THEN** controller state is cleared and `vr-end` is emitted

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

### Requirement: Thumbstick movement
When polled, the right thumbstick's horizontal axis beyond a 0.15 dead zone SHALL emit `orbit` with `angle` equal to the axis times 0.03. While the right grip is squeezed it SHALL emit `fly` with the controller's forward direction and speed 4.

#### Scenario: Dead zone
- **WHEN** the right stick reads 0.1 horizontally
- **THEN** no `orbit` event is emitted

### Requirement: Voice recognition
`VoiceCommands.init()` SHALL create a `SpeechRecognition` (or `webkitSpeechRecognition`) for `en-US` with one result per utterance, and return false when `enabled` is false. It SHALL restart listening after results, `no-speech` and `end` while enabled, and SHALL stop on `aborted` or `not-allowed`, passing the error to `onError`.

#### Scenario: No speech API
- **WHEN** the browser has no speech recognition
- **THEN** `init()` returns false and the toast `Voice unavailable. Using keyboard shortcuts (Ctrl+Shift+H/S/R).` is shown

#### Scenario: Microphone denied
- **WHEN** `requestMicrophonePermission()` is refused
- **THEN** the toast `Microphone access denied. Using keyboard shortcuts.` is shown

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

### Requirement: Command execution
`executeCommand(command, confidence)` SHALL reject a result below `confidenceThreshold` (0.7 by default) with a warning toast asking the user to try again. Otherwise it SHALL show a toast naming the action and call `onCommand(action, param)`. An unmatched transcript SHALL show a warning toast that suggests saying `help`.

#### Scenario: Low confidence
- **WHEN** a command arrives with confidence 0.5
- **THEN** `onCommand` is not called

### Requirement: Keyboard shortcuts
After initialisation or fallback, `Ctrl+Shift+H` SHALL run `hideTests`, `Ctrl+Shift+S` SHALL run `showAll` and `Ctrl+Shift+R` SHALL run `flyToOrigin`, each with confidence 1.0. Keys without both Ctrl and Shift SHALL be ignored.

#### Scenario: Shortcut without speech
- **WHEN** speech is unavailable and the user presses Ctrl+Shift+H
- **THEN** `onCommand('hideTests', undefined)` is called

### Requirement: Toasts
Toasts SHALL go to `onToast(message, level)` when given. Otherwise a fixed toast SHALL appear at the bottom centre for 2000 ms, replacing any toast on screen. `dispose()` SHALL stop listening, remove the toast and the key listener.

#### Scenario: Host toasts
- **WHEN** `onToast` is provided
- **THEN** no toast element is added to the page
