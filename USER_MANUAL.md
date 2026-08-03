# Holocron VR — User Manual

**Version 0.5.1** · Explore your codebase as an immersive 3D VR constellation powered by Graphify knowledge graphs.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [System Requirements](#2-system-requirements)
3. [Installation Guide](#3-installation-guide)
4. [Desktop Mode Tutorial](#4-desktop-mode-tutorial)
5. [VR Mode Tutorial](#5-vr-mode-tutorial)
6. [Voice Command Reference](#6-voice-command-reference)
7. [Visual Legend](#7-visual-legend)
8. [Configuration Options](#8-configuration-options)
9. [Troubleshooting Guide](#9-troubleshooting-guide)
10. [Privacy FAQ](#10-privacy-faq)

---

## 1. Quick Start

Get from zero to exploring your codebase in under 5 minutes.

### 1.1 Before You Start

- Make sure **YodaMan** is running and your project workspace is open.
- The **Graphify** plugin must be installed and enabled (it usually is by default — YodaMan uses it to understand your code's structure).

### 1.2 Launch the Plugin

1. Open YodaMan and click the **Plugins** tab in the left sidebar.
   [screenshot: YodaMan sidebar with Plugins tab highlighted]

2. Find the **Holocron VR** card. It shows your codebase name and the number of files Graphify has indexed.
   [screenshot: Holocron VR plugin card showing "Ready" status and file count]

3. Click **Open VR Explorer**. A loading screen appears while the plugin computes the 3D layout of your code.
   [screenshot: Loading screen with progress indicator]

4. After a few seconds (usually less than 5), you'll see your codebase as a beautiful 3D constellation of glowing spheres.
   [screenshot: 3D constellation view with colourful spheres connected by lines]

### 1.3 Choose Your Mode

| Mode | How | Best for |
|---|---|---|
| **Desktop 3D** | Click "Enter Desktop 3D" | Quick exploration without a headset |
| **VR Mode** | Click "Enter VR" | Full immersive experience |

> **Tip:** Try Desktop 3D first even if you have a VR headset — it's faster to get oriented.

---

## 2. System Requirements

### 2.1 Hardware

| Component | Desktop 3D (Minimum) | Desktop 3D (Recommended) | VR Mode |
|---|---|---|---|
| **CPU** | Intel Core i5 / AMD Ryzen 5 | Apple M1 / Intel Core i7+ | Intel Core i7 / Apple M1 Pro |
| **RAM** | 8 GB | 16 GB | 16 GB |
| **GPU** | Integrated (Intel UHD) | Dedicated (GTX 1060+) | Dedicated (GTX 1070+) |
| **Storage** | 50 MB free | 50 MB free | 50 MB free |
| **VR Headset** | — | — | Meta Quest 2, Quest 3, or Quest Pro |

### 2.2 Software

| Requirement | Version | Notes |
|---|---|---|
| **YodaMan** | v0.3.8 or higher | Plugin host |
| **Graphify plugin** | Any | Knowledge graph engine (bundled with YodaMan) |
| **OS** | macOS 14+, Windows 10/11, Ubuntu 22.04 | ARM and x86 supported |
| **Browser (Desktop)** | Chrome 120+, Edge 120+, Firefox 120+ | For standalone use outside YodaMan |
| **Browser (VR)** | Quest Browser (Chromium) | Pre-installed on Meta headsets |
| **VR Connection** | — | Oculus Link, Air Link, or Virtual Desktop |

### 2.3 Performance Guidelines

| Codebase Size | Desktop FPS | VR FPS | Notes |
|---|---|---|---|
| < 500 files | 60 FPS | 72 FPS | Smooth on all hardware |
| 500–3,000 files | 60 FPS | 72 FPS | Recommended spec for VR |
| 3,000–5,000 files | 30+ FPS | 72 FPS (may need LOD tuning) | Reduce max nodes in Settings |
| > 5,000 files | Varies | Not recommended | Cap at 5,000 in Settings |

---

## 3. Installation Guide

### 3.1 Automatic Installation (Future)

In a future release, you'll be able to install Holocron VR directly from the **YodaMan Plugin Store**:

1. Open YodaMan → **Settings** → **Plugins**.
2. Click **Browse Plugin Store**.
3. Search for "Holocron VR".
4. Click **Install**.

### 3.2 Manual Installation (Current)

1. **Download the plugin** from the [releases page](https://github.com/Yoda-Man/Holocron/releases). Get the `holocron-vr.zip` file from the latest release.

2. **Extract the ZIP** to your YodaMan plugins directory:

   | OS | Path |
   |---|---|
   | **macOS/Linux** | `~/.yodaman/plugins/holocron-vr/` |
   | **Windows** | `%APPDATA%\YodaMan\plugins\holocron-vr\` |

   The final structure should look like:
   ```
   plugins/holocron-vr/
   ├── plugin.json
   ├── main.js
   ├── frontend/
   │   ├── VRViewer.js
   │   ├── UIPanel.jsx
   │   └── layoutWorker.js
   ├── backend/
   │   ├── graphProcessor.js
   │   └── layoutStore.js
   └── assets/
       └── icon.svg
   ```

3. **Reload plugins** in YodaMan:
   - Go to the **Plugins** tab.
   - Click **Reload Plugins** (or restart YodaMan).

4. **Verify installation**: The Holocron VR card should now appear in the Plugins tab.

### 3.3 Building from Source

For developers who want to build from the source code:

```bash
git clone https://github.com/Yoda-Man/Holocron.git
cd holocron-vr
npm install
npm run build
```

The built plugin will be in the `dist/` folder. Copy this folder to your YodaMan plugins directory as described above.

---

## 4. Desktop Mode Tutorial

You don't need a VR headset! Desktop mode gives you a powerful 3D viewport with mouse and keyboard controls.

### 4.1 Navigation Controls

| Action | Control | Description |
|---|---|---|
| **Orbit (rotate)** | Click + drag anywhere on the background | Rotate the view around the centre of the constellation |
| **Pan** | Right-click + drag | Move the view up, down, left, or right |
| **Zoom** | Scroll wheel | Zoom in to see details, zoom out for the big picture |
| **Return to centre** | Press `Spacebar` or "Go Home" voice command | Reset the view to the starting position |

### 4.2 Node Interaction

| Action | How | What Happens |
|---|---|---|
| **Hover** | Move mouse over a sphere | The sphere grows slightly and brightens — you can read its filename in a tooltip |
| **Click** | Left-click a sphere | The Info Panel opens showing file details and action buttons |
| **Double-click** | Double-click a sphere | Smoothly flies the camera to that node for close inspection |
| **Deselect** | Press `Escape` or click empty space | Closes the Info Panel |

### 4.3 Info Panel

When you click a node, the **Info Panel** appears:

[screenshot: Info Panel showing file path, LOC, deps, and action buttons]

The panel shows:

| Field | Description |
|---|---|
| **File path** | The full path to the file (truncated if very long) |
| **Lines of code** | How many lines the file contains |
| **Incoming deps** | How many other files depend on this file |
| **Outgoing deps** | How many files this file imports or calls |
| **Last changed** | When this file was last modified |
| **Test coverage** | Test coverage percentage (if available) |

**Action buttons:**

| Button | What it does |
|---|---|
| **🤖 Ask Agent** | Sends this file to YodaMan's AI agent for an architectural explanation |
| **🔗 Find Related** | Highlights files structurally related to this one |
| **📂 Open in VS Code** | Opens this file in VS Code (if installed) |
| **📌 Pin Panel** | Pins the Info Panel so it stays visible while you fly around |

### 4.4 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Spacebar` | Return to centre / Go home |
| `Escape` | Close Info Panel / Deselect |
| `Ctrl+Shift+V` | Open VR Explorer (from anywhere in YodaMan) |
| `Ctrl+O` | Open selected file in VS Code |
| `Ctrl+Shift+H` | Toggle test file visibility |
| `Ctrl+Shift+S` | Show all files (clear filters) |
| `Ctrl+Shift+R` | Return to origin |
| `Ctrl+Shift+D` | Toggle debug overlay (FPS + memory) |

### 4.5 LOD System (Level of Detail)

To keep performance smooth, Holocron VR uses a 4-tier LOD system:

| Tier | Distance from Camera | What you see |
|---|---|---|
| **FULL** | 0 → 5 units | Full-detail sphere, glow effects visible |
| **MID** | 5 → 15 units | Reduced detail sphere, glow still visible |
| **DOT** | 15 → 30 units | Tiny dot (point sprite), glow hidden |
| **CULLED** | > 30 units | Not rendered (invisible) |

- **Hysteresis** — A 0.5-unit buffer prevents flickering when you're at a boundary
- **Transition animation** — Nodes smoothly interpolate over 10 frames when changing tier
- **Auto-performance mode** — If your FPS drops below 45 for 3+ seconds, LOD thresholds are automatically reduced by 30%

You can adjust the LOD thresholds in **Settings → Level of Detail**.

### 4.6 Edge Visual Encoding

Lines between spheres represent relationships between files:

| Colour | Thickness | Meaning |
|---|---|---|
| **⚪ White** | 0.01 units | Import / `require` statement |
| **🟠 Orange** | 0.02 units | Function call |
| **🟣 Purple** | 0.015 units | Inheritance (`extends` / `implements`) |
| **🔵 Teal** | 0.01 units | UI Component composition |

Edges are automatically hidden when both endpoints are more than 15 units from the camera. When clusters are far away (> 20 units), individual edges are replaced by a single aggregated line between cluster centres.

### 4.7 Filtering

You can filter which files appear using the Settings panel:

- **Show test files** — Toggle visibility of test files
- **Show third-party code** — Toggle node_modules, vendor, etc.
- **Show generated files** — Toggle auto-generated files
- **Only changed in 30 days** — Show only recently modified files
- **Language** — Show only files in a specific language (Dart, TypeScript, etc.)

Filters apply instantly — no reload needed. Hidden nodes keep their position in the layout so they reappear exactly where they were.

---

## 5. VR Mode Tutorial

For the full immersive experience, you'll need a WebXR-compatible VR headset.

### 5.1 Setting Up Your Headset

**Meta Quest 2 / 3 / Pro:**

1. Install the **Oculus app** on your PC and set up **Air Link** or a **Link cable**.
2. Put on your headset and ensure it's connected to your PC.
3. Open the YodaMan desktop app on your PC.
4. Launch the Holocron VR plugin and click **Enter VR**.

> **Tip:** If "Enter VR" is greyed out, make sure your headset is connected and the Oculus app is running.

[screenshot: VR mode entrance with headset connected indicator]

### 5.2 VR Controller Mapping

| Action | Controller Input | How it Feels |
|---|---|---|
| **Fly forward** | Hold **right grip** (side button) + point controller forward | Like pointing a flashlight and gliding in that direction |
| **Orbit / rotate** | Move the **right thumbstick** left or right | The constellation spins around you |
| **Return to centre** | Squeeze **both grip buttons** at once | Snaps you back to the starting position |
| **Select a node** | Point the laser (ray) at a sphere + pull the **trigger** | A panel appears with file info |
| **Pin a panel** | Point at a sphere + **hold the trigger** for 1 second | The info panel stays floating in space, pinned to that location |
| **Open menu** | Press the **left menu button** | Shows the in-VR options menu |

The controller ray (laser pointer) uses the Quest controller's `targetRaySpace` to cast into the scene. When the trigger is pressed, a Three.js `Raycaster` intersection test identifies which node you're pointing at — the same system used for desktop mouse clicks.

[screenshot: VR controller diagram showing button mappings]

### 5.3 Performance in VR

VR requires sustained 72 FPS (Quest 2) or 90 FPS (Quest 3). The plugin includes several systems to maintain this:

- **Single InstancedMesh** — All nodes render in one draw call (not thousands of individual spheres)
- **SIMD WASM** — The layout engine uses WebAssembly SIMD instructions for 10× faster computation
- **LOD system** — Nodes far from you automatically switch to lower-detail versions
- **Edge culling** — Edges are hidden when both endpoints are more than 15 units away
- **Cluster aggregation** — Distant clusters show one line instead of hundreds

If you experience lag:
1. Open **Settings** and reduce **Max Nodes** to 1,000 or 500
2. Lower the **LOD Near/Mid/Far thresholds**
3. Enable **VR Comfort Mode**
4. Use a **Link cable** instead of Air Link for the best bandwidth

### 5.4 VR Comfort Tips

- If you feel motion sickness, enable **VR Comfort Mode** in Settings. This reduces rotation speed and smooths movement.
- Start with **Desktop 3D mode** to get familiar with the layout before jumping into VR.
- Take breaks every 15 minutes.
- Use **voice commands** instead of flying to reduce motion.

---

## 6. Voice Command Reference

Voice commands are the fastest way to navigate. Say these phrases clearly — the system strips out filler words like "um", "please", and "hey" automatically.

> **Tip:** Voice recognition only works while the VR Explorer modal is open. Grant microphone permission when prompted.

### 6.1 Navigation Commands

| Say this… | Example | What happens |
|---|---|---|
| **"Show me \_\_\_\_"** | "Show me payment" | Camera flies to the folder cluster containing payment-related code |
| **"Where is \_\_\_\_"** | "Where is AuthService" | Camera flies directly to that specific file |
| **"Find \_\_\_\_"** | "find LoginForm" | Same as "Where is" |
| **"Go home"** | "go home" | Returns to the starting overview position |
| **"Fly to origin"** | "fly to origin" | Same as "go home" |

### 6.2 Analysis Commands

| Say this… | Example | What happens |
|---|---|---|
| **"Dependencies of \_\_\_\_"** | "dependencies of UserModel" | All files EXCEPT those in the dependency chain are dimmed |
| **"Dependents of \_\_\_\_"** | "dependents of AuthService" | Shows which files depend on this one |
| **"What depends on \_\_\_\_"** | "what depends on User" | Reverse dependency lookup |
| **"What does \_\_\_\_ depend on"** | "what does AuthService depend on" | Forward dependency lookup |
| **"Ask agent about this"** | "ask agent about this" | Explains the selected file's role using YodaMan's AI |
| **"Find similar files"** | "find similar files" | Highlights structurally similar files |

### 6.3 Filter Commands

| Say this… | What happens |
|---|---|
| **"Hide tests"** | Test files disappear from the view |
| **"Show tests"** | Test files reappear |
| **"Show all"** | All hidden files reappear |
| **"Reset"** | Same as "show all" — clears all filters |

### 6.4 Utility Commands

| Say this… | What happens |
|---|---|
| **"Open in VS Code"** | Opens the currently selected file in VS Code |
| **"Save view"** | Saves your current camera position as a YodaMan task for later |
| **"Help"** | Shows a list of available voice commands |

### 6.5 What NOT to Worry About

- **Filler words don't matter.** "Um show me auth please" works the same as "show me auth".
- **Capitalisation doesn't matter.** "WHERE IS AUTHSERVICE" works fine.
- **Pacing doesn't matter.** Speak naturally — the system waits for you to finish.

---

## 7. Visual Legend

Everything you see in the 3D view carries meaning. Here's how to read the constellation.

### 7.1 Nodes (Spheres)

Each sphere represents a **file** in your codebase.

[screenshot: legend graphic showing different node sizes, colours, and effects]

| Property | What it tells you | Visual Cue |
|---|---|---|
| **Size** | Lines of code (LOC) | Small = < 50 LOC, Large = > 2,000 LOC |
| **🔵 Blue** | Core logic (Dart, TypeScript, JavaScript) | Solid fill |
| **🟢 Green** | Configuration / Data (JSON, YAML) | Solid fill |
| **🟡 Yellow** | Assets (images, fonts, static files) | Solid fill |
| **⬜ Grey** | Test files | Solid fill |
| **Brightness** | Importance (incoming dependencies) | Brighter = more files depend on this one |
| **🔴 Red glow** | Recently changed (< 7 days) | Subtle outer glow |
| **Pulsing** | Git change frequency | Faster pulse = more commits in last 30 days |
| **Green ring** | Test coverage | Full ring = 100% coverage |

### 7.2 Edges (Lines)

Lines show **relationships** between files.

[screenshot: edge legend showing all four types with labels]

| Colour | Thickness | Meaning |
|---|---|---|
| **⚪ White** | 0.01 units | Import / `require` statement — one file imports another |
| **🟠 Orange** | 0.02 units | Function call — one file calls a function in another |
| **🟣 Purple** | 0.015 units | Inheritance — a class extends or implements another |
| **🔵 Teal** | 0.01 units | Composition — a UI component renders another component |

### 7.3 Clusters

Files in the same folder are grouped into **clusters**. Each cluster floats in its own region of the constellation.

- **Large clusters** (many files) are placed closer to the centre.
- **Small clusters** (few files) are placed further out.
- **Root-level files** are grouped at the centre as a single "root" cluster.

---

## 8. Configuration Options

Click the **gear icon** (⚙) in the bottom-right corner of the VR Explorer to open Settings.

[screenshot: Settings panel showing all sections]

### 8.1 Level of Detail (LOD)

Controls how detailed the spheres appear at different distances. Reducing these numbers improves performance on older machines.

| Setting | Default | Range | Effect |
|---|---|---|---|
| **Near threshold** | 5 units | 1–100 | Distance at which spheres switch to full detail |
| **Mid threshold** | 15 units | 1–100 | Distance at which spheres simplify |
| **Far threshold** | 30 units | 1–100 | Distance beyond which spheres become dots, then disappear |

### 8.2 Rendering

| Setting | Default | Range | Effect |
|---|---|---|---|
| **Max nodes** | 3,000 | 500–10,000 | Caps the number of files rendered. Lower = better performance. If your codebase has more files than this, only the most important ones are shown. |

### 8.3 Preferences

| Setting | Default | Effect |
|---|---|---|
| **Voice commands** | On | Enables microphone for voice navigation |
| **VR comfort mode** | On | Reduces rotation speed and smooths movement to prevent motion sickness |

### 8.4 Theme

| Setting | Effect |
|---|---|
| **Auto** | Follows YodaMan's current theme (light/dark) |
| **Dark** | Always use the dark space background |
| **Light** | Lighter background (useful in bright environments) |

### 8.5 Filters

See section [4.5](#45-filtering) for a complete list of filter options.

### 8.6 Reset Defaults

Click **Reset Defaults** to restore all settings to their factory values.

---

## 9. Troubleshooting Guide

### 9.1 "Graphify not available" Error

**Message:** The plugin loads but shows "Graphify not available; plugin loaded but inactive".

**What's wrong:** The Graphify knowledge graph hasn't been built for your workspace yet.

**Fix:** 
1. Open YodaMan and ensure your workspace is open.
2. Wait for YodaMan to finish indexing (you'll see a progress indicator).
3. If it's stuck, try **Reload Workspace** or restart YodaMan.
4. Go to the Graphify plugin settings and manually trigger a re-index.

### 9.2 Empty 3D View

**Symptom:** The scene loads but you see only a black or dark background with no spheres.

**What's wrong:** Either the layout is still computing, or there are no files to display.

**Fix:**
1. Wait 5–10 seconds — large codebases take longer.
2. Check that your workspace actually contains code files.
3. Open the **Graphify** dashboard and verify it has indexed your files.
4. Try clicking **Reload Plugins** in YodaMan and launching again.

### 9.3 VR Mode Greyed Out

**Symptom:** The "Enter VR" button is disabled or shows "WebXR not available".

**What's wrong:** Your VR headset isn't connected or WebXR isn't available.

**Fix:**
1. Make sure your headset is **powered on** and **connected** to your PC.
2. For Quest headsets: open the **Oculus app** on your PC and verify the headset is connected via Link or Air Link.
3. Use the **Quest Browser** on the headset itself if you're running YodaMan from a browser.
4. Restart the Oculus app and try again.

### 9.4 Voice Commands Not Working

**Symptom:** You speak but nothing happens.

**Fix:**
1. Check that **microphone permission** was granted to YodaMan / your browser.
2. Open the **Settings** panel and toggle **Voice Commands** off and back on — this re-triggers the permission prompt.
3. Speak **clearly** and at a **normal pace**. The system works best with short phrases.
4. Try saying "help" to see the available commands.

### 9.5 Choppy Performance

**Symptom:** Low frame rate, stuttering, or laggy controls.

**Desktop mode fixes:**
1. Open Settings and reduce **Max Nodes** to 1,000 or 500.
2. Lower **LOD thresholds** (Near: 3, Mid: 8, Far: 15).
3. Close other applications to free up memory.

**VR mode fixes:**
1. All the above, plus:
2. Enable **VR Comfort Mode** in Settings.
3. Make sure you're connected via **Link cable** (not Air Link) for the best performance.
4. Lower the render resolution in the Oculus app.

### 9.6 "Agent" Button Does Nothing

**Symptom:** Clicking "Ask Agent" doesn't open a chat response.

**Fix:**
1. The YodaMan agent might be busy with another request. Wait and try again.
2. Check YodaMan's chat panel — it may be open in another tab.
3. Ensure your internet connection is working (the agent requires it).

### 9.7 "Open in VS Code" Not Working

**Symptom:** Clicking the button does nothing or shows an error.

**Fix:**
1. Make sure **VS Code** is installed.
2. Ensure VS Code is in your system PATH:
   - **macOS:** Open VS Code, press `Cmd+Shift+P`, type "shell command", and select "Install 'code' command in PATH".
   - **Windows:** VS Code usually adds itself to PATH during installation.
3. Try opening a file manually in VS Code to confirm it's working.

### 9.8 Debug Overlay (Ctrl+Shift+D)

**Symptom:** You want to see live FPS and memory usage.

**Fix:** Press `Ctrl+Shift+D` to toggle the debug overlay. It shows:
- **FPS** — Current frame rate
- **Frame time** — Milliseconds per frame
- **Heap** — Browser JS heap usage in MB

The overlay updates every 500ms and is styled in cyan to match the VR theme. This is a development tool — it's hidden by default.

### 9.9 Memory Leak / Performance Degradation Over Time

**Symptom:** The plugin gets slower the longer you use it, or memory usage keeps growing.

**Fix:**
1. Close the VR Explorer modal and re-open it — `dispose()` releases all Three.js resources (geometries, materials, textures, renderer).
2. If you see a `[VR] Memory leak warning` in the console, file a bug report.
3. The plugin uses **WeakRef** for event handlers — they should be GC'd automatically when the panel closes.
4. The `dispose()` method also terminates the layout Web Worker and frees WASM memory via `Module.free_memory()`.

### 9.10 Cached View is Stale

**Symptom:** The view shows old positions even after you've changed files.

**Fix:**
1. Holocron VR caches the 3D layout by default. When your code changes, Graphify computes a new graph hash, and the cache is automatically invalidated.
2. If the view seems outdated, try clicking **Reload Plugins** in YodaMan.
3. You can also clear the cache via the Settings panel.

---

## 10. Privacy FAQ

### 10.1 Does my code leave my machine?

**No.** Holocron VR is a **local-first plugin**. Everything runs on your own computer:

- Graph data is read from YodaMan's local Graphify database.
- 3D layout computation runs on your own CPU/GPU via WebAssembly.
- The Three.js scene renders in your local browser or Electron window.

**No code, no file contents, and no metadata are ever sent to any external server.**

### 10.2 Are my voice commands recorded?

**No.** Voice processing works like this:

1. The **Web Speech API** (built into your browser) captures audio and converts it to text **locally on your machine**.
2. The text is matched against the command grammar to determine the action.
3. The **raw text and audio are immediately discarded** — never saved, never logged, never transmitted.

Only the **command name** (e.g., "flyToNode") and the **matched parameter** (e.g., "authservice") may appear in the local audit log, so you can see what commands you've used.

### 10.3 What data is logged?

Holocron VR includes a dedicated audit logger (`backend/auditLogger.js`) that writes to YodaMan's local `audit-log.jsonl` file. Entries are structured and minimal:

```
{ "userAction": "vr_explorer_open",     "nodeCount": 847 }
{ "userAction": "vr_node_select",       "nodePath": "src/auth/AuthService.dart" }
{ "userAction": "vr_voice_command",     "commandName": "flyToNode" }
{ "userAction": "vr_ask_agent",         "nodeId": "src/auth/AuthService.dart", "taskId": "abc123" }
{ "userAction": "vr_save_view",         "taskId": "xyz789" }
{ "userAction": "vr_open_file",         "nodePath": "src/auth/AuthService.dart" }
{ "userAction": "vr_explorer_close",    "sessionDurationMs": 45230 }
```

**Privacy guarantees enforced in CI:**

- Audited actions are tested by 7 dedicated Playwright tests in `tests/privacy/`
- The `audit_log_contains_no_code` test verifies no entry contains file contents
- The `voice_transcript_not_logged` test verifies all 10 utterance types log the action name only
- The `no_external_fetch` test asserts zero non-localhost network requests during a full session

**This log never leaves your machine.** It is only accessible to you through YodaMan's interface. No telemetry, no analytics, no tracking.

### 10.4 What is NEVER logged?

| Item | Reason |
|---|---|
| File contents | Only file paths are logged (and only for navigation context) |
| Raw voice transcripts | Only the matched command name is logged |
| Audio recordings | Never captured or stored |
| WebXR frame data | No session recording |
| Code snippets | Never transmitted or logged |
| Git history | Only change frequency count (no commit messages or diffs) |

### 10.5 Network Access

Holocron VR only communicates with:
- **`localhost:3090`** — YodaMan's local backend API
- **Nothing else** — no external domains, no CDNs, no analytics services

You can verify this yourself: open your browser's Developer Tools → **Network tab**, and you'll see all requests go to `localhost`.

### 10.6 Can I delete the audit log?

Yes. The audit log is stored at `~/.yodaman/audit-log.jsonl` (or the equivalent path on your OS). You can delete this file at any time — YodaMan will create a new one when needed.

---

## Appendix A: File Overview

```
holocron-vr/
├── plugin.json              ← Plugin manifest (name, version, permissions)
├── main.js                  ← Entry point (lifecycle hooks for YodaMan)
├── frontend/                ← 3D scene, UI, Web Worker, voice
│   ├── VRViewer.js          ← Three.js scene manager (InstancedMesh, LOD, edges, filters, raycasting)
│   ├── VRController.js      ← WebXR session + 6-DoF Quest controller input
│   ├── InfoPanel.jsx        ← Node info panel (React) — deps, agent, VS Code, pin
│   ├── SettingsPanel.jsx    ← Settings drawer (React) — LOD, filters, voice, theme
│   ├── UIPanel.jsx          ← Plugin card component
│   ├── voiceCommands.js     ← Speech recognition + 19-command grammar
│   ├── layoutWorker.js      ← Web Worker (WASM engine + JS fallback)
│   └── layout_engine.mjs    ← Compiled WASM module (Emscripten)
├── backend/                 ← Data pipeline, cache, agent context, integrations
│   ├── graphProcessor.js    ← Normalizes Graphify API data (nodes, edges, clusters, hash)
│   ├── layoutStore.js       ← IndexedDB 3D position cache (LRU eviction)
│   ├── agentClient.js       ← "Ask Agent" API orchestration
│   ├── agentContextProvider.js← Multi-source context aggregator (VR, Git, files, Graphify)
│   ├── viewStore.js         ← Save/restore VR views as YodaMan tasks
│   ├── auditLogger.js       ← Privacy-safe audit logging (8 action types, zero-exfil)
│   ├── vscodeClient.js      ← "Open in VS Code" integration + keyboard shortcut
│   └── perfLogger.js        ← Performance profiling (__DEV__ stripped in production)
├── wasm-src/                ← C++ WASM layout engine (SIMD via wasm_simd128.h)
│   ├── layout_engine.cpp    ← SIMD-accelerated force-directed layout (52 SIMD intrinsics)
│   ├── force_directed.h     ← Micro-layout (O(n²) repulsion + attraction + damping)
│   ├── macro_layout.h       ← Macro-layout (golden-angle sphere cluster placement)
│   └── CMakeLists.txt       ← Emscripten build (Release/Debug)
├── assets/
│   ├── icon.svg             ← Plugin icon (constellation globe)
│   └── shaders/             ← GLSL shaders (node.vert, node.frag for glow + Fresnel)
├── scripts/                 ← Benchmarks, utilities
│   ├── bench-layout.js      ← Layout speed (5 graph sizes: 100–5,000 nodes)
│   ├── bench-fps.js         ← FPS stability (60s Playwright session, P10 metric)
│   ├── bench-memory.js      ← Memory leak detection (10 open/close cycles, < 20 MB)
│   └── test-wasm.mjs        ← WASM export verification (28-test suite)
├── tests/                   ← 237 automated tests (CI-gated)
│   ├── unit/                ← 173 Jest tests (layout, voice parser, LOD, graph processor)
│   ├── integration/         ← 57 Playwright tests (API, lifecycle, WASM loading)
│   └── privacy/             ← 7 Playwright tests (network isolation, audit log, transcripts)
├── .github/workflows/       ← CI/CD pipelines
│   ├── ci.yml               ← Validate on every push (build, test, audit, privacy scan)
│   └── release.yml          ← Package + GitHub Release on tag (changelog, zip, pre-release detection)
├── USER_MANUAL.md           ← Complete 600+ line user manual
├── store.json               ← YodaMan Plugin Registry metadata
└── README.md
```

---

## Appendix B: Version History

| Version | Date | Changes |
|---|---|---|
| 0.5.1 | 2026-07-14 | Automatic language inference, improved node path resolution, LOD transitions, memory optimization |
| 0.5.0 | 2026-07-12 | Edge rendering, agent context provider, privacy audit suite, CI/CD pipelines |

---

*Holocron VR is an open-source plugin for [YodaMan](https://yodaman.dev). Built by Yoda-Man.*
