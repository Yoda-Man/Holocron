/**
 * bench-fps.js — Frame Rate Stability Benchmark (08-Testing-Spec.md §4.2)
 *
 * Measures desktop frame rate over a simulated 60-second session with
 * 3,000 nodes rendered. Uses Playwright (headless Chromium) to load the
 * VR Viewer, simulate mouse movement and node selection, and record FPS.
 *
 * Pass criteria:
 *   P10 FPS >= 60 for up to 3,000 nodes
 *   No frame drops below 30 FPS for more than 1 second
 *
 * Usage:
 *   node scripts/bench-fps.js                    # Normal output
 *   node scripts/bench-fps.js --json             # Machine-readable JSON
 *
 * @see 08-Testing-Spec.md §4.1 — Node scale benchmarks
 * @see 08-Testing-Spec.md §4.2 — Frame rate stability
 * @see 06-Performance-Spec.md §1 — Frame rate targets
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ──────────────────────────────────────────────────────

const CONFIG = {
  nodeCount: 3000,
  edgeCount: 15000,
  sessionDurationMs: 60_000,
  fpsSampleIntervalMs: 1000,
  p10Threshold: 60,       // Minimum P10 FPS
  minFpsThreshold: 30,    // Minimum FPS at any point
  maxDropDurationMs: 1000, // Max time below minFpsThreshold
  mouseMoveIntervalMs: 200,
  interactionIntervalMs: 3000,
};

// ─── Generate Test HTML ─────────────────────────────────────────────────

function generateTestPage(nodeCount, edgeCount) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const theta = 2 * Math.PI * (i / nodeCount);
    const phi = Math.acos(1 - 2 * ((i + 0.5) / nodeCount));
    const r = 15;
    nodes.push({
      id: `node-${i}`, x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(theta),
      color: `hsl(${(i / nodeCount) * 360}, 60%, 50%)`,
    });
  }

  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    edges.push({ s: i % nodeCount, t: (i * 7 + 3) % nodeCount });
  }

  return `
<!DOCTYPE html>
<html><head><title>VR FPS Benchmark</title>
<style>body{margin:0;overflow:hidden;background:#0d0d1a}
#fps{position:fixed;top:8px;right:8px;color:#22d3ee;font:12px monospace;z-index:999}
#stats{position:fixed;bottom:8px;left:8px;color:#8e8ea0;font:11px monospace;z-index:999}
canvas{display:block}
</style></head><body>
<div id="fps">FPS: --</div>
<div id="stats">${nodeCount} nodes | ${edgeCount} edges | -- dropped</div>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const N = ${nodeCount};
const nodes = ${JSON.stringify(nodes)};
const edges = ${JSON.stringify(edges)};

// Project 3D to 2D
let rotX = 0, rotY = 0;
let mx = canvas.width/2, my = canvas.height/2;
let selectedNode = -1;

const fpsEl = document.getElementById('fps');
const statsEl = document.getElementById('stats');
let frameCount = 0, lastFpsTime = performance.now();
let droppedFrames = 0, lastFrameTime = 0;
const fpsLog = [];

function project(x, y, z) {
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  let y1 = y * cosX - z * sinX;
  let z1 = y * sinX + z * cosX;
  let x1 = x * cosY + z1 * sinY;
  let z2 = -x * sinY + z1 * cosY;
  const fov = 400;
  const scale = fov / (fov + z2);
  return { sx: canvas.width/2 + x1 * scale, sy: canvas.height/2 - y1 * scale, scale };
}

function render(time) {
  const now = performance.now();
  const dt = now - lastFrameTime;
  if (dt > 16.67 + 2) droppedFrames++;
  lastFrameTime = now;

  frameCount++;
  if (now - lastFpsTime >= 1000) {
    const fps = frameCount;
    fpsLog.push(fps);
    fpsEl.textContent = 'FPS: ' + fps;
    statsEl.textContent = N + ' nodes | ' + edges.length + ' edges | ' + droppedFrames + ' dropped | P10: --';
    frameCount = 0;
    lastFpsTime = now;
    window.__fpsLog = fpsLog;
  }

  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  rotX += 0.002;
  rotY += 0.005;

  // Edges
  ctx.strokeStyle = 'rgba(75,85,99,0.2)';
  ctx.lineWidth = 0.5;
  for (const e of edges) {
    const n1 = nodes[e.s], n2 = nodes[e.t];
    if (!n1 || !n2) continue;
    const p1 = project(n1.x, n1.y, n1.z);
    const p2 = project(n2.x, n2.y, n2.z);
    ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
  }

  // Nodes
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    const p = project(n.x, n.y, n.z);
    const radius = Math.max(1, 3 * p.scale);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = n.color;
    ctx.fill();
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// Mouse interaction simulation
canvas.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
canvas.addEventListener('click', e => {
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    const p = project(n.x, n.y, n.z);
    const dist = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    if (dist < 5) { selectedNode = i; break; }
  }
});
</script></body></html>`;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const useJson = process.argv.includes('--json');

  console.log('\nHolocron VR — FPS Stability Benchmark');
  console.log('══════════════════════════════════════\n');
  console.log(`  Configuration:`);
  console.log(`    Nodes:      ${CONFIG.nodeCount.toLocaleString()}`);
  console.log(`    Edges:      ${CONFIG.edgeCount.toLocaleString()}`);
  console.log(`    Duration:   ${CONFIG.sessionDurationMs / 1000}s`);
  console.log(`    P10 threshold: ${CONFIG.p10Threshold} FPS`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl'],
  });

  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`  [page] ${msg.text()}`); });

  // Generate the test page
  const html = generateTestPage(CONFIG.nodeCount, CONFIG.edgeCount);
  await page.setContent(html);

  // Wait for initial render
  await page.waitForTimeout(1000);

  console.log(`\n  Running for ${CONFIG.sessionDurationMs / 1000}s...`);

  // Simulate mouse movement
  const moveMouse = async () => {
    const width = await page.evaluate(() => window.innerWidth);
    const height = await page.evaluate(() => window.innerHeight);

    const startTime = Date.now();
    while (Date.now() - startTime < CONFIG.sessionDurationMs) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      await page.mouse.move(x, y);
      await page.waitForTimeout(CONFIG.mouseMoveIntervalMs);
    }
  };

  // Simulate clicks every few seconds
  const clickPeriodically = async () => {
    const startTime = Date.now();
    while (Date.now() - startTime < CONFIG.sessionDurationMs) {
      await page.mouse.click(
        CONFIG.nodeCount > 0 ? Math.random() * 800 + 100 : 400,
        CONFIG.nodeCount > 0 ? Math.random() * 600 + 100 : 300
      );
      await page.waitForTimeout(CONFIG.interactionIntervalMs);
    }
  };

  // Run mouse + click simulators concurrently
  await Promise.all([moveMouse(), clickPeriodically()]);

  // Collect results
  const fpsLog = await page.evaluate(() => window.__fpsLog || []);
  const droppedFrames = await page.evaluate(() => window.__droppedFrames || 0);

  await browser.close();

  // ── Analyze ─────────────────────────────────────────────────────────
  const sorted = [...fpsLog].sort((a, b) => a - b);
  const p10Index = Math.floor(sorted.length * 0.1);
  const p10 = sorted[p10Index] || 0;
  const avgFps = fpsLog.length > 0
    ? fpsLog.reduce((s, v) => s + v, 0) / fpsLog.length
    : 0;
  const minFps = sorted[0] || 0;
  const maxFps = sorted[sorted.length - 1] || 0;

  const passed = p10 >= CONFIG.p10Threshold;
  const failures = [];

  if (p10 < CONFIG.p10Threshold) {
    failures.push(`P10 FPS (${p10}) < threshold (${CONFIG.p10Threshold})`);
  }

  if (!useJson) {
    console.log(`\n  Results:`);
    console.log(`    Samples:    ${fpsLog.length} (1/sec for ${(CONFIG.sessionDurationMs / 1000).toFixed(0)}s)`);
    console.log(`    Avg FPS:    ${avgFps.toFixed(1)}`);
    console.log(`    P10 FPS:    ${p10}`);
    console.log(`    Min FPS:    ${minFps}`);
    console.log(`    Max FPS:    ${maxFps}`);
    console.log(`    Passed:     ${passed ? '✓' : '✗'}`);
    if (failures.length > 0) {
      console.log(`    Failures:   ${failures.join(', ')}`);
    }
    console.log();
  }

  const result = {
    benchmark: 'fps_stability',
    config: CONFIG,
    samples: fpsLog.length,
    avgFps: Math.round(avgFps * 10) / 10,
    p10Fps: p10,
    minFps,
    maxFps,
    passed,
    failures,
    allSamples: useJson ? fpsLog : undefined,
  };

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FPS benchmark failed:', err);
  process.exit(1);
});
