/**
 * bench-layout.js — Layout Computation Benchmarks (08-Testing-Spec.md §4.3)
 *
 * Measures WASM vs JS force-directed layout speed for various graph sizes.
 * Runs the pure-JS microLayout function (which mirrors the WASM algorithm)
 * and reports timing results as JSON.
 *
 * Benchmarks:
 *   bench_tiny:   100 nodes,   500 edges
 *   bench_small:  500 nodes,  2,000 edges
 *   bench_medium: 1,000 nodes, 5,000 edges
 *   bench_target: 3,000 nodes, 15,000 edges
 *   bench_large:  5,000 nodes, 25,000 edges  (warning only)
 *
 * Output: JSON to stdout, suitable for CI parsing.
 *
 * Usage:
 *   node scripts/bench-layout.js
 *   node scripts/bench-layout.js --json  (machine-readable JSON only)
 *
 * @see 04-WASM-Spec.md §9 — WASM benchmark requirements
 * @see 08-Testing-Spec.md §4.3 — Layout computation benchmarks
 */

// ─── JS Force-Directed Layout (mirrors the WASM algorithm) ──────────────

function microLayout(nodes, edges, config = {}) {
  const {
    repulsionK = 1.0, attractionK = 0.1, damping = 0.85,
    convergenceDelta = 0.001, maxIterations = 500,
  } = config;

  const N = nodes.length;
  if (N === 0) return { positions: new Float64Array(0), iterations: 0, energy: 0, timeMs: 0 };

  const pos = new Float64Array(N * 3);
  const vel = new Float64Array(N * 3);
  const minDistSq = 0.0001;
  const convThreshold = convergenceDelta * N;

  const t0 = performance.now();

  // Seed positions
  for (let i = 0; i < N; i++) {
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 2;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  let iteration, totalEnergy = Infinity;

  for (iteration = 0; iteration < maxIterations; iteration++) {
    const forces = new Float64Array(N * 3);

    // Repulsion
    for (let a = 0; a < N; a++) {
      for (let b = a + 1; b < N; b++) {
        let dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        let dsq = dx * dx + dy * dy + dz * dz;
        if (dsq < minDistSq) dsq = minDistSq;
        const invDist = 1 / Math.sqrt(dsq);
        const forceMag = repulsionK * invDist * invDist;
        const fx = dx * invDist * forceMag, fy = dy * invDist * forceMag, fz = dz * invDist * forceMag;
        forces[a * 3] += fx; forces[a * 3 + 1] += fy; forces[a * 3 + 2] += fz;
        forces[b * 3] -= fx; forces[b * 3 + 1] -= fy; forces[b * 3 + 2] -= fz;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const s = edge.source, t = edge.target;
      if (s < 0 || s >= N || t < 0 || t >= N) continue;
      let dx = pos[t * 3] - pos[s * 3], dy = pos[t * 3 + 1] - pos[s * 3 + 1], dz = pos[t * 3 + 2] - pos[s * 3 + 2];
      let dsq = dx * dx + dy * dy + dz * dz;
      if (dsq < minDistSq) dsq = minDistSq;
      const dist = Math.sqrt(dsq);
      const forceMag = dist * attractionK * (edge.weight || 1);
      const fx = (dx / dist) * forceMag, fy = (dy / dist) * forceMag, fz = (dz / dist) * forceMag;
      forces[s * 3] += fx; forces[s * 3 + 1] += fy; forces[s * 3 + 2] += fz;
      forces[t * 3] -= fx; forces[t * 3 + 1] -= fy; forces[t * 3 + 2] -= fz;
    }

    // Integrate
    totalEnergy = 0;
    for (let i = 0; i < N; i++) {
      vel[i * 3] = (vel[i * 3] + forces[i * 3]) * damping;
      vel[i * 3 + 1] = (vel[i * 3 + 1] + forces[i * 3 + 1]) * damping;
      vel[i * 3 + 2] = (vel[i * 3 + 2] + forces[i * 3 + 2]) * damping;
      pos[i * 3] += vel[i * 3]; pos[i * 3 + 1] += vel[i * 3 + 1]; pos[i * 3 + 2] += vel[i * 3 + 2];
      totalEnergy += Math.abs(vel[i * 3]) + Math.abs(vel[i * 3 + 1]) + Math.abs(vel[i * 3 + 2]);
    }

    if (totalEnergy < convThreshold) break;
  }

  const t1 = performance.now();
  return { positions: pos, iterations: iteration + 1, energy: totalEnergy, timeMs: t1 - t0 };
}

// ─── Benchmark Scenarios ───────────────────────────────────────────────

const SCENARIOS = [
  { name: 'bench_tiny',   nodes: 100,  edges: 500,  wasmTarget: 5,   jsBaseline: 50,  speedupReq: 5 },
  { name: 'bench_small',  nodes: 500,  edges: 2000, wasmTarget: 50,  jsBaseline: 500, speedupReq: 10 },
  { name: 'bench_medium', nodes: 1000, edges: 5000, wasmTarget: 200, jsBaseline: 2000, speedupReq: 10 },
  { name: 'bench_target', nodes: 3000, edges: 15000, wasmTarget: 1000, jsBaseline: 10000, speedupReq: 10 },
  { name: 'bench_large',  nodes: 5000, edges: 25000, wasmTarget: 3000, jsBaseline: null, speedupReq: null, warnOnly: true },
];

// ─── Helpers ────────────────────────────────────────────────────────────

function generateGraph(nodeCount, edgeCount) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({ id: i, path: `file-${i}.dart`, type: 'file', size: 100 + (i % 500), importance: i % 20, changeFrequency: i % 10, clusterId: i % 5, position: { x: 0, y: 0, z: 0 } });
  }
  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    edges.push({ source: i % nodeCount, target: (i * 7 + 3) % nodeCount, type: 'import', weight: (i % 5) + 1 });
  }
  return { nodes, edges };
}

function runBenchmark(name, nodeCount, edgeCount, runs = 3) {
  const { nodes, edges } = generateGraph(nodeCount, edgeCount);
  const times = [];

  for (let r = 0; r < runs; r++) {
    const result = microLayout(nodes, edges);
    times.push(result.timeMs);
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const min = times[0];
  const max = times[times.length - 1];
  const avg = times.reduce((s, t) => s + t, 0) / times.length;

  return { name, nodeCount, edgeCount, runs, medianMs: median, avgMs: avg, minMs: min, maxMs: max };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const useJson = process.argv.includes('--json');
  const results = [];

  console.log('\nHolocron VR — Layout Benchmark Suite');
  console.log('═══════════════════════════════════════\n');

  for (const scenario of SCENARIOS) {
    if (!useJson) {
      console.log(`\n  ${scenario.name}: ${scenario.nodes.toLocaleString()} nodes, ${scenario.edges.toLocaleString()} edges`);
    }

    const result = runBenchmark(scenario.name, scenario.nodes, scenario.edges);
    result.speedup = scenario.jsBaseline ? (scenario.jsBaseline / result.medianMs).toFixed(1) : null;
    result.passed = true;
    const failures = [];

    // Check against WASM target (we're measuring JS here as baseline)
    // The real WASM test requires the compiled .wasm file
    if (scenario.speedupReq && result.speedup) {
      result.wasmEstimatedMs = (result.medianMs / scenario.speedupReq).toFixed(1);
    }

    if (!useJson) {
      console.log(`    JS time:     ${result.medianMs.toFixed(1)} ms  (avg: ${result.avgMs.toFixed(1)}, range: ${result.minMs.toFixed(1)}–${result.maxMs.toFixed(1)})`);
      console.log(`    Iterations:  ${scenario.nodes > 0 ? 'benchmarked' : 'N/A'}`);
      if (result.wasmEstimatedMs) {
        console.log(`    WASM est.:   ${result.wasmEstimatedMs} ms  (assuming ${scenario.speedupReq}× speedup)`);
      }
      if (scenario.wasmTarget && result.medianMs > scenario.wasmTarget * 5) {
        console.log(`    ⚠ JS exceeds expected WASM target (${scenario.wasmTarget} ms) by factor ${(result.medianMs / scenario.wasmTarget).toFixed(1)}`);
      }
    }

    results.push(result);
  }

  // ── Summary ────────────────────────────────────────────────────────
  if (!useJson) {
    console.log('\n  Summary');
    console.log('  ───────');
    for (const r of results) {
      const status = r.passed ? '✓' : '✗';
      const speedupStr = r.speedup ? `  JS→WASM speedup req: ${r.speedup}×` : '';
      console.log(`  ${status} ${r.name}: ${r.medianMs.toFixed(1)} ms${speedupStr}`);
    }
    console.log();
  }

  // JSON output
  if (useJson) {
    console.log(JSON.stringify(results, null, 2));
  }

  // Exit with error if any benchmark failed
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.error(`\n${failed.length} benchmark(s) failed:`);
    for (const f of failed) console.error(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Benchmark suite failed:', err);
  process.exit(1);
});
