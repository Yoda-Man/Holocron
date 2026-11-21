# Design

## Context
See proposal.md for the defects. The viewer, the layout worker and the voice, VR and React modules have no browser in the unit tests. Jest runs native ESM with no transform, and React is not installed: YodaMan supplies it at runtime. YodaMan core vendors `dist/main.js`, `dist/plugin.json` and the layout engine files. Core renders its own viewer, so this repository's `frontend/` code reaches users through the release zip, not through core.

## Goals / Non-Goals

**Goals:**
- Each defect gets a fix in shared code and a regression test that fails without it.
- Tests drive the shipped modules, never copies of their logic.
- Every module under `frontend/` and `backend/` is either reached by a build entry or listed as shipped as source.

**Non-Goals:**
- No new runtime dependency. No React or JSX transform added to the unit tests through `npm install`.
- No change to the C++ engine or `bindLayoutEngine.js`, so core needs no engine sync.
- No redesign of the WebXR render path onto `renderer.xr`.

## Decisions
- **One cluster index helper.** `frontend/clusterIndex.js` maps cluster ids (strings such as `src/auth`, or numbers) to dense integers from 0, with -1 for none. The viewer and both worker paths use it. Dense ids also suit the engine, which sizes its cluster arrays by the largest id. The worker also resolves edge `source` and `target` ids to indexes when `sourceIdx` and `targetIdx` are missing, the same string-into-integer defect.
- **Glow index table.** `render` records each node's glow instance in an `Int32Array` (-1 when it has none). Highlight, restore, LOD and filter visibility all read it. This replaces a linear scan.
- **Language filters by alias.** Filter keys `typescript`, `javascript`, `python` and `markdown` compare through the same alias table the colours use, so `ts`, `tsx`, `js`, `py` and `md` match.
- **Show checkboxes are inverted filters.** The filters hide when on. "Show test files", "Show third-party code" and "Show generated files" are checked when their filter is off, and checking one turns its filter off.
- **Keep engine memory after layout.** `init_graph` already frees old buffers, and abort frees them. The worker no longer frees after a good layout, so `refine` works.
- **JSX in tests.** A test helper compiles a `.jsx` file with Vite's `transformWithOxc`, points `react` at a small hook runtime under `tests/unit/helpers/`, and imports the result. The runtime throws when a component calls a different number of hooks between renders, as React does.
- **Task 3.4: build entries.** `VRController`, `voiceCommands`, `InfoPanel`, `SettingsPanel` and the backend modules the specs describe become Vite entries, compiled into `dist/`. Alternative: delete them. Rejected, because the README and the specs describe them as features. `layoutWorker.js` and `bindLayoutEngine.js` stay source files: the worker loads `./layout_engine.mjs` beside it.
- **Manifest.** `uiExtensions` is dropped, which removes the missing `AgenticChat.jsx` and `chat-icon.svg`. `main.js` starts no worker (`backend/graphCache.js` never existed) and the shortcut opens `./frontend/VRViewer.js`, as the card does. The `.jsx` rewrite of `plugin.json` in the build is then dead and is removed.

## Risks / Trade-offs
- [The hook runtime is not React] → It only counts hooks and runs effects. Component output is checked as plain element trees.
- [Core vendors `main.js` and `plugin.json`] → The report names the built files to copy; core's version test fails until they are synced.
- [VR still renders outside `renderer.xr`] → Out of scope; noted for a later change.

## Migration Plan
Build 0.6.7, copy `dist/main.js` and `dist/plugin.json` into core `plugins/`. Rollback is the 0.6.6 zip.
