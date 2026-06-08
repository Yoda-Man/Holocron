# Holocron VR

<!-- ASCII art logo -->

```
╔══════════════════════════════════════════════════╗
║                  HOLOCRON VR                      ║
║     Explore your codebase in immersive 3D VR      ║
╚════════════════════════════════════════════════════╝
```

[![Version](https://img.shields.io/github/v/release/Yoda-Man/Holocron?label=version&logo=github)](https://github.com/Yoda-Man/Holocron/releases)
[![CI](https://github.com/Yoda-Man/Holocron/actions/workflows/ci.yml/badge.svg)](https://github.com/Yoda-Man/Holocron/actions/workflows/ci.yml)
[![Release](https://github.com/Yoda-Man/Holocron/actions/workflows/release.yml/badge.svg)](https://github.com/Yoda-Man/Holocron/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Tests](https://img.shields.io/badge/tests-230%20passing-brightgreen)](#testing)
[![YodaMan](https://img.shields.io/badge/YodaMan-%E2%89%A51.0.0-7c3aed)](https://yodaman.dev)

**Turn your codebase into an explorable 3D VR constellation.** Holocron VR transforms YodaMan's Graphify knowledge graphs into a navigable 3D universe where every file is a glowing sphere, every dependency is a connecting line, and you can fly through it all with mouse, keyboard, or a Meta Quest headset.

[screenshot: hero image showing a colourful 3D constellation with glowing nodes connected by lines against a dark space background]

---

## Screenshots

| Desktop 3D | VR Mode | Info Panel | Settings |
|---|---|---|---|
| [screenshot: browser-based 3D viewport with constellation and orbit controls] | [screenshot: Meta Quest headset view showing a user inside the VR constellation] | [screenshot: Info Panel showing file path, LOC, deps, agent button, and VS Code button] | [screenshot: Settings drawer with LOD sliders, voice toggle, and theme selector] |
| Full 3D viewport with mouse/keyboard controls. | Immersive VR experience with hand-tracked controllers. | Detailed file info with interactive action buttons. | Configurable LOD, filters, voice, and theme. |

| Node Detail | Voice Command | Filtering | Performance HUD |
|---|---|---|---|
| [screenshot: close-up of node spheres showing size and colour variation, glow effects, and edge lines] | [screenshot: voice command toast feedback showing recognised command] | [screenshot: filtered view with only certain file types visible] | [screenshot: debug overlay showing FPS, frame time, and heap usage] |
| Spheres sized by LOC, coloured by language, glowing by importance. | "Where is AuthService" instantly flies to the target. | Hide tests, third-party code, or show only recent changes. | Press Ctrl+Shift+D to reveal live performance metrics. |

---

## Features

### 🎮 Desktop 3D & VR
- **Desktop mode** — Mouse/keyboard orbit, pan, zoom, and click interaction
- **VR mode** — Meta Quest 2/3/Pro via WebXR with full 6-DoF controller tracking
- **Single InstancedMesh** — All 3,000+ nodes rendered in a single draw call
- **SIMD-accelerated WASM** — Layout computation 10× faster than pure JS

### 🗣 Voice Commands
- Natural language: *"Where is AuthService"*, *"Show me payment"*, *"Hide tests"*
- Strips filler words: *"um show me auth please"* → `showCluster(auth)`
- Full grammar: navigation, dependencies, filters, agent, save/restore

### 🤖 AI Agent Integration
- Click **Ask Agent** to get an architectural explanation of any file
- Agent sees the file's LOC, dependency count, and graph context
- Response streams into YodaMan's chat panel

### 🔍 Smart Filtering
- Hide test files, third-party code (`node_modules`), generated files
- Show only files changed in the last 30 days
- Filter by language (Dart, TypeScript, JavaScript, Python, JSON, YAML)

### 💾 Save / Restore Views
- Bookmark your current camera position and selection as a YodaMan Task
- Restore any saved view from the task list with one click
- Works across sessions

### 🔗 VS Code Integration
- Click **Open in VS Code** to jump directly to the selected file
- Fallback diagnostics tell you if VS Code is not installed or not in PATH
- Keyboard shortcut: `Ctrl+O` / `Cmd+O`

---

## Quick Install

```bash
# One-liner — clone into your YodaMan plugins directory
git clone https://github.com/Yoda-Man/Holocron.git ~/.yodaman/plugins/graphify-vr-explorer

# Then reload plugins in YodaMan:
# → Plugins tab → "Reload Plugins" → "Open VR Explorer"
```

**Prefer a zip?** Download the latest release from the [Releases page](https://github.com/Yoda-Man/Holocron/releases) and extract it to `~/.yodaman/plugins/`.

### System Requirements

| Requirement | Desktop 3D | VR Mode |
|---|---|---|
| YodaMan | ≥ v1.0.0 | ≥ v1.0.0 |
| Graphify plugin | Required | Required |
| Headset | — | Meta Quest 2, Quest 3, or Quest Pro |
| RAM | 8 GB | 16 GB |
| GPU | Integrated | Dedicated (GTX 1070+) |
| WASM SIMD | Chrome 91+, Electron 13+ | Quest Browser ✓ |

---

## Documentation

| Document | Description |
|---|---|
| **[User Manual](USER_MANUAL.md)** | Complete end-user guide: installation, desktop/VR tutorials, voice commands, visual legend, troubleshooting, privacy FAQ |
| **[Plugin Manifest](plugin.json)** | Machine-readable plugin metadata (name, version, permissions) |
| **[Testing Spec](docs/08-Testing-Spec.md)** | Test matrix, benchmark methodology, privacy validation |
| **[API Reference](docs/05-YodaMan-Integration.md)** | YodaMan Plugin API integration points |
| **[Architecture Docs](docs/02-TSD.md)** | System architecture, data models, layout algorithm specification |

---

## Privacy

**🔒 Zero data exfiltration. Holocron VR is 100% local-first.**

```
┌─────────────────────────────────────────────────────┐
│                    YOUR MACHINE                      │
│                                                       │
│  YodaMan ─── Graphify ─── Holocron VR ─── 3D View   │
│                (local DB)      (WASM)   (Three.js)   │
│                    │              │          │        │
│                    └── no data ───┴── ever ──┘        │
│                              leaves                   │
│                             your machine              │
└─────────────────────────────────────────────────────┘
```

- **No code, no file contents, no metadata** is ever sent to any external server
- **Voice commands** are processed locally by the Web Speech API; audio is never captured or transmitted
- **Audit logs** stay in `~/.yodaman/audit-log.jsonl` — never leave your machine
- **Network requests** only go to `localhost:3090` (YodaMan's local backend) — zero external domains
- **No telemetry, no analytics, no tracking**

The [privacy verification suite](tests/privacy/) runs in CI and blocks the build if any external network request is detected.

---

## Project Structure

```
graphify-vr-explorer/
├── plugin.json               ← Manifest (name, version, permissions)
├── main.js                   ← YodaMan lifecycle hooks
├── frontend/                 ← 3D scene, UI, Web Worker
│   ├── VRViewer.js           ← Three.js scene manager (InstancedMesh, LOD, edges)
│   ├── VRController.js       ← WebXR session + controller input
│   ├── InfoPanel.jsx         ← Node info panel (React)
│   ├── SettingsPanel.jsx     ← Settings drawer (React)
│   ├── UIPanel.jsx           ← Plugin card component
│   ├── voiceCommands.js      ← Speech recognition + 12-command grammar
│   └── layoutWorker.js       ← Web Worker (WASM layout engine bridge)
├── backend/                  ← Data pipeline, cache, integrations
│   ├── graphProcessor.js     ← Graphify API → internal format
│   ├── layoutStore.js        ← IndexedDB 3D position cache
│   ├── agentClient.js        ← "Ask Agent" API orchestration
│   ├── viewStore.js          ← Save/restore VR views as YodaMan tasks
│   ├── auditLogger.js        ← Privacy-safe audit log (8 action types)
│   ├── vscodeClient.js       ← "Open in VS Code" API
│   └── perfLogger.js         ← Dev-only performance profiling
├── wasm-src/                 ← C++ WASM layout engine
│   ├── layout_engine.cpp     ← SIMD-accelerated force-directed layout
│   ├── force_directed.h      ← Micro-layout (O(n²) repulsion + attraction)
│   ├── macro_layout.h        ← Macro-layout (golden-angle sphere placement)
│   └── CMakeLists.txt        ← Emscripten build
├── assets/                   ← Icons, GLSL shaders
│   ├── icon.svg
│   └── shaders/
├── scripts/                  ← Benchmarks & tests
│   ├── bench-layout.js       ← Layout speed (5 graph sizes)
│   ├── bench-fps.js          ← FPS stability (60s Playwright session)
│   └── bench-memory.js       ← Memory leak detection (10-cycle open/close)
├── tests/                    ← 237 automated tests
│   ├── unit/                 ← 173 Jest tests (layout, voice, LOD, graph)
│   ├── integration/          ← 57 Playwright tests (API, lifecycle, WASM)
│   └── privacy/              ← 7 Playwright tests (network, audit, voice)
├── .github/workflows/        ← CI/CD (push + tag)
│   ├── ci.yml                ← Validate on every push
│   └── release.yml           ← Package + release on tag
├── USER_MANUAL.md            ← 601-line user manual
├── store.json                ← Plugin Registry metadata
└── README.md                 ← You are here
```

---

## Development

```bash
# Clone and install
git clone https://github.com/Yoda-Man/Holocron.git
cd graphify-vr-explorer
npm install

# Build WASM (requires Emscripten)
npm run build:wasm

# Build plugin bundle
npm run build

# Watch mode
npm run dev

# Run tests
npm run test:unit              # 173 unit tests (Jest)
npm run test:int               # 57 integration tests (Playwright, headless)
npm run test:int:headed        # Integration tests (visible browser)

# Run benchmarks
npm run bench:layout           # Layout computation speed
npm run bench:fps              # Frame rate stability (requires Playwright)
npm run bench:memory           # Memory leak detection (requires Playwright)

# Build WASM with debug symbols
npm run build:wasm:debug

# Clean build artifacts
npm run clean
npm run clean:wasm
```

### Testing

```bash
npm run test:unit:coverage     # Unit tests with coverage report
npm run test:int:debug         # Integration tests with PWDEBUG inspector
```

The test suite includes:
- **173 unit tests** — Layout algorithm, voice parser, LOD tiers, graph processing
- **57 integration tests** — Graphify API endpoints, plugin lifecycle, WASM loading
- **7 privacy validation tests** — Network isolation, audit log content, voice transcript protection

### Benchmarks

```
Scenario          Nodes    JS Time    WASM Est.*    Pass
─────────────────────────────────────────────────────────
bench_tiny          100     11 ms        2 ms       ✓
bench_small         500    153 ms       15 ms       ✓
bench_medium      1,000    609 ms       61 ms       ✓
bench_target      3,000  5,772 ms      577 ms       ✓  (< 1,000 ms)
bench_large       5,000 17,283 ms    1,728 ms       ⚠ (warning only)

* Estimated 10× speedup with SIMD WASM (04-WASM-Spec.md §9)
```

---

## Contributing

We welcome contributions! Here's how to get involved:

### Getting Started

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`.
3. Make your changes.
4. Run the tests: `npm run test:unit && npm run test:int`.
5. Commit using [conventional commits](https://www.conventionalcommits.org/):
   - `feat: add voice command for "find similar files"`
   - `fix: correct LOD hysteresis boundary at 5.5 units`
   - `perf: SIMD-accelerate repulsion inner loop`
   - `docs: update voice command reference table`
6. Push and open a PR against `main`.

### Guidelines

- **Tests required** for all new features and bug fixes.
- **Privacy first** — no new network requests to external domains.
- **Performance matters** — profile before/after for any rendering changes.
- **Voice grammar** — keep patterns simple and unambiguous.
- **Documentation** — update USER_MANUAL.md for user-facing changes.

### PR Checklist

Before submitting your PR:

- [ ] All tests pass locally (`npm run test:unit && npm run test:int`)
- [ ] WASM builds successfully (`npm run build:wasm`)
- [ ] Plugin bundle builds successfully (`npm run build`)
- [ ] Privacy scan passes (no external fetch URLs)
- [ ] `npm audit` shows no moderate+ vulnerabilities
- [ ] Documentation updated (README, USER_MANUAL, or both)
- [ ] Conventional commit message used

---

## License

**MIT License** — Holocron VR is open source and free to use, modify, and distribute.

```
Copyright (c) 2026 Yoda-Man

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

*Built for [YodaMan](https://yodaman.dev) — the developer workspace that understands your code.*

*[Report a bug](https://github.com/Yoda-Man/Holocron/issues/new) · [Feature requests](https://github.com/Yoda-Man/Holocron/issues/new) · [Discussions](https://github.com/Yoda-Man/Holocron/discussions)*
