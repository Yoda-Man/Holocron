/**
 * perfLogger.js — Performance Profiling (06-Performance-Spec.md §9)
 *
 * Logs timing and memory metrics to the browser console with a `[VR PERF]`
 * prefix. In production builds (__DEV__ = false), all logs are stripped
 * by the Vite bundler via `define: { __DEV__: false }`.
 *
 * Also provides an on-screen debug overlay (Ctrl+Shift+D) showing live
 * FPS, memory, and node count.
 *
 * ── Budget Warnings ─────────────────────────────────────────────────────
 *   Frame time > 16 ms  (desktop 60 FPS)     → warn
 *   Frame time > 13.9 ms (VR 72 FPS)         → warn
 *   Total memory > 200 MB                    → warn
 *   Node count > 3,000                       → warn
 *
 * @see 06-Performance-Spec.md §9 — Profiling checkpoints
 * @see 06-Performance-Spec.md §9 — Stripping in production
 */

// ─── Module State ───────────────────────────────────────────────────────

/** Checkpoints: name → { start, end, elapsed } */
const _checkpoints = new Map();

/** FPS rolling window. */
const _frameTimes = [];
const FPS_WINDOW = 30;
let _fpsInterval = null;

/** Debug overlay DOM element. */
let _debugOverlay = null;
let _debugVisible = false;
let _debugAnimId = null;

/** Budget thresholds from 06-Performance-Spec.md §9 and §3. */
const BUDGETS = {
  frameDesktop: 16.0,   // ms  (60 FPS)
  frameVR:      13.9,   // ms  (72 FPS)
  memoryTotal:  200,    // MB
  nodeWarning:  3000,   // count
};

// ═════════════════════════════════════════════════════════════════════════
//  CONDITIONAL COMPILATION
// ═════════════════════════════════════════════════════════════════════════

/**
 * Whether performance logging is enabled.
 * In production (__DEV__ = false), this is replaced at build time with `false`
 * and all call sites are tree-shaken by Vite/Rollup.
 *
 * @type {boolean}
 */
const ENABLED = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

// ═════════════════════════════════════════════════════════════════════════
//  TIMING CHECKPOINTS (§9 checkpoint table)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Mark the start of a named checkpoint.
 *
 * @param {string} name — Checkpoint name (e.g. 'graph_fetch')
 */
function mark(name) {
  if (!ENABLED) return;
  _checkpoints.set(name, { start: performance.now(), end: 0, elapsed: 0 });
}

/**
 * Mark the end of a named checkpoint and log the elapsed time.
 *
 * @param {string} name  — Checkpoint name
 * @param {object} [extra]  — Additional data to log
 */
function measure(name, extra = {}) {
  if (!ENABLED) return;
  const cp = _checkpoints.get(name);
  if (!cp) return;

  cp.end = performance.now();
  cp.elapsed = cp.end - cp.start;

  const extras = Object.keys(extra).length
    ? ` ${JSON.stringify(extra)}`
    : '';

  console.log(`[VR PERF] ${name}_ms: ${cp.elapsed.toFixed(2)}${extras}`);
}

/**
 * Log an ad-hoc performance value without start/end tracking.
 *
 * @param {string} key   — Metric key (e.g. 'wasm_heap_mb')
 * @param {*}      value — Metric value
 */
function logPerf(key, value) {
  if (!ENABLED) return;
  console.log(`[VR PERF] ${key}: ${value}`);
}

/**
 * Log a budget warning when a threshold is exceeded.
 *
 * @param {string} metric   — Budget name
 * @param {number} value    — Current value
 * @param {number} budget   — Threshold
 * @param {string} [units]  — Unit label
 */
function warnBudget(metric, value, budget, units = '') {
  if (!ENABLED) return;
  console.warn(
    `[VR PERF] Budget exceeded: ${metric} = ${value}${units} (budget: ${budget}${units})`
  );
}

// ═════════════════════════════════════════════════════════════════════════
//  FPS TRACKING
// ═════════════════════════════════════════════════════════════════════════

/**
 * Feed a frame timestamp to the rolling FPS calculator.
 * Call once per frame from the animation loop.
 *
 * Automatically logs rolling average every 60 frames.
 *
 * @param {number} [now]  — performance.now() timestamp
 * @returns {number} Current FPS (0 if insufficient data)
 */
function trackFPS(now) {
  if (!ENABLED) return 0;

  _frameTimes.push(now || performance.now());
  while (_frameTimes.length > FPS_WINDOW) _frameTimes.shift();

  if (_frameTimes.length < 2) return 0;

  // Log every 60 frames
  if (!_fpsInterval) _fpsInterval = 0;
  _fpsInterval++;

  if (_fpsInterval % 60 === 0) {
    const elapsed = _frameTimes[_frameTimes.length - 1] - _frameTimes[0];
    const fps = ((_frameTimes.length - 1) / (elapsed / 1000));
    console.log(`[VR PERF] fps_rolling: ${fps.toFixed(1)}`);

    // Budget check
    const frameTime = elapsed / (_frameTimes.length - 1);
    if (frameTime > BUDGETS.frameDesktop) {
      warnBudget('frame_time', frameTime, BUDGETS.frameDesktop, 'ms');
    }
    return fps;
  }

  return 0;
}

// ═════════════════════════════════════════════════════════════════════════
//  MEMORY & STATS LOGGING
// ═════════════════════════════════════════════════════════════════════════

/**
 * Log Three.js renderer memory stats.
 *
 * @param {object} rendererInfo — `renderer.info` object
 */
function logThreeJsMem(rendererInfo) {
  if (!ENABLED || !rendererInfo) return;

  const { geometries, textures } = rendererInfo.memory;
  const { calls, triangles } = rendererInfo.render;

  console.log(
    `[VR PERF] threejs_mem: geometries=${geometries} textures=${textures} ` +
    `draws=${calls} tris=${triangles}`
  );

  // Rough memory estimate: ~1 KB per geometry, ~0.5 KB per texture
  const estMB = (geometries * 0.001 + textures * 0.0005);
  if (estMB > BUDGETS.memoryTotal) {
    warnBudget('threejs_memory', estMB, BUDGETS.memoryTotal, ' MB');
  }
}

/**
 * Log WASM heap size.
 *
 * @param {object} wasmModule — Emscripten Module instance
 */
function logWasmHeap(wasmModule) {
  if (!ENABLED || !wasmModule) return;

  try {
    const bytes = wasmModule.HEAP8?.buffer?.byteLength;
    if (bytes) {
      const mb = bytes / (1024 * 1024);
      logPerf('wasm_heap_mb', mb.toFixed(1));
      if (mb > BUDGETS.memoryTotal) {
        warnBudget('wasm_heap', mb, BUDGETS.memoryTotal, ' MB');
      }
    }
  } catch { /* ignore */ }
}

/**
 * Log node count and warn if above threshold.
 *
 * @param {number} count — Number of rendered nodes
 */
function logNodeCount(count) {
  if (!ENABLED) return;
  logPerf('node_count', count);
  if (count > BUDGETS.nodeWarning) {
    warnBudget('node_count', count, BUDGETS.nodeWarning);
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  DEBUG OVERLAY (Ctrl+Shift+D)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Toggle the on-screen debug overlay (Ctrl+Shift+D).
 *
 * Shows live FPS, frame time, memory usage, and node count.
 */
function toggleDebugOverlay() {
  if (!ENABLED) return;

  if (_debugVisible) {
    _hideDebugOverlay();
  } else {
    _showDebugOverlay();
  }
}

function _showDebugOverlay() {
  if (_debugOverlay) return;

  const overlay = document.createElement('div');
  overlay.id = 'vr-debug-overlay';
  overlay.style.cssText = `
    position: fixed; top: 8px; left: 8px; z-index: 99999;
    background: rgba(0,0,0,0.75); color: #22d3ee;
    font: 11px/1.5 ui-monospace, monospace;
    padding: 8px 12px; border-radius: 6px;
    border: 1px solid rgba(34,211,238,0.3);
    pointer-events: none;
    min-width: 180px;
  `;

  document.body.appendChild(overlay);
  _debugOverlay = overlay;
  _debugVisible = true;

  // Start update loop
  let frames = 0;
  let lastTime = performance.now();

  function update() {
    if (!_debugVisible) return;
    _debugAnimId = requestAnimationFrame(update);

    frames++;
    const now = performance.now();
    const elapsed = now - lastTime;

    if (elapsed >= 500) {
      const fps = (frames / (elapsed / 1000));
      const frameTime = elapsed / frames;
      let mem = '';
      try {
        if (performance.memory) {
          mem = `${(performance.memory.usedJSHeapSize / (1024*1024)).toFixed(1)} MB`;
        }
      } catch {}

      overlay.textContent = [
        `FPS: ${fps.toFixed(1)}`,
        `Frame: ${frameTime.toFixed(2)} ms`,
        mem ? `Heap: ${mem}` : '',
      ].filter(Boolean).join('\n');

      frames = 0;
      lastTime = now;
    }
  }

  update();
}

function _hideDebugOverlay() {
  _debugVisible = false;
  if (_debugAnimId) { cancelAnimationFrame(_debugAnimId); _debugAnimId = null; }
  if (_debugOverlay) {
    _debugOverlay.remove();
    _debugOverlay = null;
  }
}

/**
 * Register the Ctrl+Shift+D keyboard shortcut for debug overlay.
 */
function registerDebugShortcut() {
  if (!ENABLED) return;

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
      event.preventDefault();
      toggleDebugOverlay();
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════
//  RESET
// ═════════════════════════════════════════════════════════════════════════

/**
 * Reset all checkpoints and FPS data.
 * Call between layout runs to avoid stale measurements.
 */
function reset() {
  _checkpoints.clear();
  _frameTimes.length = 0;
  _fpsInterval = 0;
}

// ═════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export {
  ENABLED,
  mark,
  measure,
  logPerf,
  warnBudget,
  trackFPS,
  logThreeJsMem,
  logWasmHeap,
  logNodeCount,
  toggleDebugOverlay,
  registerDebugShortcut,
  reset,
};
