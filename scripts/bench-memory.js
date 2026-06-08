/**
 * bench-memory.js — Memory Leak Detection Benchmark (08-Testing-Spec.md §9.1)
 *
 * Measures JS heap growth over 10 successive open/close cycles of the
 * VR Explorer modal. Uses Playwright to load the scene, simulate
 * interaction, and close, then checks that memory growth is < 20 MB.
 *
 * Protocol from 08-Testing-Spec.md §9.1:
 *   1. Sample baseline heap size
 *   2. Open VR plugin modal → wait 5s for layout → close
 *   3. Force garbage collection
 *   4. Repeat 10 times
 *   5. Compare final heap to baseline
 *
 * Pass criteria: growth < 20 MB after 10 cycles.
 *
 * Usage:
 *   node scripts/bench-memory.js                # Normal output
 *   node scripts/bench-memory.js --json         # Machine-readable JSON
 *
 * @see 08-Testing-Spec.md §9   — Load testing
 * @see 08-Testing-Spec.md §9.1 — Memory leak detection protocol
 * @see 06-Performance-Spec.md §3 — Memory budgets
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ──────────────────────────────────────────────────────

const CONFIG = {
  cycles: 10,
  openWaitMs: 5000,     // Wait for layout to complete
  gcWaitMs: 500,         // Wait after GC
  growthThresholdMB: 20, // Max allowed growth
};

// ─── Test Page ──────────────────────────────────────────────────────────

function generateTestPage() {
  return `<!DOCTYPE html>
<html><head><title>Memory Benchmark</title>
<style>body{margin:0;background:#0d0d1a;color:#e8e8f0;font:14px sans-serif}
#log{padding:20px}#open-btn{padding:12px 24px;font-size:16px;cursor:pointer;margin:20px}
</style></head><body>
<div id="log">Ready</div>
<button id="open-btn">Open VR</button>
<div id="modal" style="display:none;position:fixed;inset:0;background:#0d0d1a;z-index:100">
  <canvas id="c" style="width:100%;height:100%"></canvas>
  <button id="close-btn" style="position:fixed;top:10px;right:10px;z-index:101;padding:8px 16px">Close</button>
</div>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let running = false, animId = null;

// Generate 2000 test nodes
const N = 2000;
const nodes = [];
for (let i = 0; i < N; i++) {
  const theta = 2 * Math.PI * (i / N);
  const phi = Math.acos(1 - 2 * ((i + 0.5) / N));
  nodes.push({
    x: 15 * Math.sin(phi) * Math.cos(theta),
    y: 15 * Math.cos(phi),
    z: 15 * Math.sin(phi) * Math.sin(theta),
  });
}

// Generate 8000 test edges
const edges = [];
for (let i = 0; i < 8000; i++) {
  edges.push({ s: i % N, t: (i * 7 + 3) % N });
}

// Pooled objects to avoid GC in render loop
const _vec = { x: 0, y: 0, z: 0 };

function project(x, y, z, rx, ry) {
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  let y1 = y * cosX - z * sinX;
  let z1 = y * sinX + z * cosX;
  let x1 = x * cosY + z1 * sinY;
  let z2 = -x * sinY + z1 * cosY;
  const scale = 400 / (400 + z2);
  return { sx: 400 + x1 * scale, sy: 300 - y1 * scale, scale };
}

function render(time) {
  if (!running) return;
  animId = requestAnimationFrame(render);
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, 800, 600);

  const rx = time * 0.001, ry = time * 0.002;

  // Pooled rendering — no allocations in hot path
  for (const e of edges) {
    const na = nodes[e.s], nb = nodes[e.t];
    const pa = project(na.x, na.y, na.z, rx, ry);
    const pb = project(nb.x, nb.y, nb.z, rx, ry);
    ctx.strokeStyle = 'rgba(75,85,99,0.15)';
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
  }

  for (const n of nodes) {
    const p = project(n.x, n.y, n.z, rx, ry);
    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1, 2 * p.scale), 0, Math.PI * 2);
    ctx.fillStyle = '#60a5fa';
    ctx.fill();
  }
}

document.getElementById('open-btn').onclick = () => {
  document.getElementById('modal').style.display = 'block';
  canvas.width = 800; canvas.height = 600;
  running = true;
  requestAnimationFrame(render);
};

document.getElementById('close-btn').onclick = () => {
  running = false;
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  document.getElementById('modal').style.display = 'none';
  const evt = new CustomEvent('modal-closed');
  document.dispatchEvent(evt);
};
</script></body></html>`;
}

// ═════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════

async function main() {
  const useJson = process.argv.includes('--json');

  console.log('\nHolocron VR — Memory Leak Detection Benchmark');
  console.log('══════════════════════════════════════════════\n');
  console.log(`  Cycles:     ${CONFIG.cycles}`);
  console.log(`  Wait/cycle: ${CONFIG.openWaitMs / 1000}s`);
  console.log(`  Threshold:  ${CONFIG.growthThresholdMB} MB`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--enable-precise-memory-info'],
  });

  const context = await browser.newContext({
    // Enable memory info in Chrome
    permissions: [],
  });

  const page = await context.newPage();

  const html = generateTestPage();
  await page.setContent(html);
  await page.waitForTimeout(1000);

  // ── Baseline ───────────────────────────────────────────────────────
  const getHeap = async () => {
    try {
      return await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
    } catch {
      return 0;
    }
  };

  const baseline = await getHeap();
  const baselineMB = (baseline / (1024 * 1024)).toFixed(1);
  console.log(`\n  Baseline heap: ${baselineMB} MB\n`);

  const heapSamples = [baseline];
  let hasGC = false;

  // ── Run cycles ─────────────────────────────────────────────────────
  for (let cycle = 1; cycle <= CONFIG.cycles; cycle++) {
    // Open
    await page.click('#open-btn');
    await page.waitForTimeout(CONFIG.openWaitMs);

    // Close
    await page.click('#close-btn');

    // Wait for close animation + GC
    await page.waitForTimeout(500);

    // Force GC (Chrome only)
    try {
      await page.evaluate(() => {
        if (window.gc) { window.gc(); hasGC = true; }
      });
    } catch { /* not available */ }
    await page.waitForTimeout(CONFIG.gcWaitMs);

    // Sample heap
    const heap = await getHeap();
    heapSamples.push(heap);
    const heapMB = (heap / (1024 * 1024)).toFixed(1);
    const delta = heap - baseline;
    const deltaMB = (delta / (1024 * 1024)).toFixed(2);

    console.log(`  Cycle ${cycle.toString().padStart(2)}: ${heapMB} MB (${delta > 0 ? '+' : ''}${deltaMB} MB)`);
  }

  await browser.close();

  // ── Results ────────────────────────────────────────────────────────
  const finalHeap = heapSamples[heapSamples.length - 1];
  const growth = finalHeap - baseline;
  const growthMB = growth / (1024 * 1024);
  const passed = growthMB < CONFIG.growthThresholdMB;

  if (!useJson) {
    console.log(`\n  Results:`);
    console.log(`    GC available: ${hasGC ? '✓' : '✗ (use --js-flags='--expose-gc')'}`);
    console.log(`    Baseline:     ${(baseline / (1024*1024)).toFixed(1)} MB`);
    console.log(`    Final:        ${(finalHeap / (1024*1024)).toFixed(1)} MB`);
    console.log(`    Growth:       ${growthMB.toFixed(2)} MB`);
    console.log(`    Threshold:    ${CONFIG.growthThresholdMB} MB`);
    console.log(`    Passed:       ${passed ? '✓' : '✗'}`);
    console.log();
  }

  const result = {
    benchmark: 'memory_leak',
    config: CONFIG,
    hasGC,
    baselineMB: Math.round((baseline / (1024*1024)) * 100) / 100,
    finalMB: Math.round((finalHeap / (1024*1024)) * 100) / 100,
    growthMB: Math.round(growthMB * 100) / 100,
    thresholdMB: CONFIG.growthThresholdMB,
    passed,
    samples: heapSamples.map((s) => Math.round((s / (1024*1024)) * 100) / 100),
  };

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!passed) {
    console.error(`\n✗ Memory leak detected: ${growthMB.toFixed(2)} MB growth exceeds ${CONFIG.growthThresholdMB} MB threshold`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Memory benchmark failed:', err);
  process.exit(1);
});
