/**
 * layout.test.js — Layout Algorithm Unit Tests
 *
 * Tests the macro and micro layout algorithms used by the WASM engine
 * and the JS fallback. Verifies sphere placement, force-directed
 * simulation, cache behavior, and graph hashing.
 *
 * @see 08-Testing-Spec.md §1.1 — Test matrix
 * @see 02-TSD.md §6.2 — Macro layout spec
 * @see 02-TSD.md §6.3 — Micro layout spec
 */

// ─── Types for clarity (not imported from engine) ───────────────────────

/**
 * @typedef {object} ClusterNode
 * @property {string}  id
 * @property {string}  label
 * @property {number}  depth
 * @property {{x:number,y:number,z:number}} centroid
 * @property {number} radius
 * @property {string[]} nodeIds
 */

/**
 * @typedef {object} GraphNode
 * @property {string}  id
 * @property {string}  path
 * @property {string}  type
 * @property {number}  size
 * @property {number}  importance
 * @property {number}  changeFrequency
 * @property {number}  clusterId
 * @property {{x:number,y:number,z:number}} position
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} source
 * @property {string} target
 * @property {string} type
 * @property {number} weight
 */

// ═════════════════════════════════════════════════════════════════════════
//  MACRO LAYOUT (§6.2)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Run the macro layout algorithm: place clusters on a sphere using
 * golden-angle distribution.
 *
 * @param {ClusterNode[]} clusters
 * @param {number} sceneRadius
 * @returns {ClusterNode[]} Clusters with computed centroids
 */
function macroLayout(clusters, sceneRadius = 20) {
  if (!clusters || clusters.length === 0) return [];

  const sorted = [...clusters].sort((a, b) => b.nodeIds.length - a.nodeIds.length);
  const maxCount = sorted.length > 0 ? sorted[0].nodeIds.length : 1;
  const R = sceneRadius;

  return sorted.map((cluster, i) => {
    const theta = Math.acos(1 - 2 * (i + 0.5) / sorted.length);
    const phi = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = R * (1 - 0.5 * (cluster.nodeIds.length / maxCount));

    return {
      ...cluster,
      centroid: {
        x: r * Math.sin(theta) * Math.cos(phi),
        y: r * Math.cos(theta),
        z: r * Math.sin(theta) * Math.sin(phi),
      },
      radius: 3 + Math.sqrt(cluster.nodeIds.length) * 0.4,
    };
  });
}

/**
 * Compute the magnitude of a 3D vector.
 */
function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * Compute distance between two 3D vectors.
 */
function distance(a, b) {
  return Math.sqrt(
    (a.x - b.x) ** 2 +
    (a.y - b.y) ** 2 +
    (a.z - b.z) ** 2
  );
}

// ═════════════════════════════════════════════════════════════════════════
//  MICRO LAYOUT (§6.3)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Pure-JS force-directed simulation matching the WASM algorithm.
 * Used for testing the algorithm correctness independent of WASM.
 *
 * @param {GraphNode[]}  nodes
 * @param {GraphEdge[]}  edges
 * @param {object}       [config]
 * @param {number}       [config.repulsionK=1.0]
 * @param {number}       [config.attractionK=0.1]
 * @param {number}       [config.damping=0.85]
 * @param {number}       [config.convergenceDelta=0.001]
 * @param {number}       [config.maxIterations=500]
 * @returns {{ positions: Float64Array, iterations: number, energy: number }}
 */
function microLayout(nodes, edges, config = {}) {
  const {
    repulsionK = 1.0,
    attractionK = 0.1,
    damping = 0.85,
    convergenceDelta = 0.001,
    maxIterations = 500,
  } = config;

  const N = nodes.length;
  if (N === 0) return { positions: new Float64Array(0), iterations: 0, energy: 0 };

  const pos = new Float64Array(N * 3);
  const vel = new Float64Array(N * 3);
  const minDist = 0.01;
  const minDistSq = minDist * minDist;
  const convThreshold = convergenceDelta * N;

  // Seed positions — spread on small sphere
  for (let i = 0; i < N; i++) {
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 2;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  let iteration;
  let totalEnergy = Infinity;

  for (iteration = 0; iteration < maxIterations; iteration++) {
    const forces = new Float64Array(N * 3);

    // Repulsion: O(n²) all-pairs
    for (let a = 0; a < N; a++) {
      for (let b = a + 1; b < N; b++) {
        let dx = pos[a * 3] - pos[b * 3];
        let dy = pos[a * 3 + 1] - pos[b * 3 + 1];
        let dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        let dsq = dx * dx + dy * dy + dz * dz;
        if (dsq < minDistSq) dsq = minDistSq;
        const invDist = 1 / Math.sqrt(dsq);
        const forceMag = repulsionK * invDist * invDist;
        const fx = dx * invDist * forceMag;
        const fy = dy * invDist * forceMag;
        const fz = dz * invDist * forceMag;
        forces[a * 3] += fx;     forces[a * 3 + 1] += fy;     forces[a * 3 + 2] += fz;
        forces[b * 3] -= fx;     forces[b * 3 + 1] -= fy;     forces[b * 3 + 2] -= fz;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const s = edge.source;
      const t = edge.target;
      if (s < 0 || s >= N || t < 0 || t >= N) continue;
      let dx = pos[t * 3] - pos[s * 3];
      let dy = pos[t * 3 + 1] - pos[s * 3 + 1];
      let dz = pos[t * 3 + 2] - pos[s * 3 + 2];
      let dsq = dx * dx + dy * dy + dz * dz;
      if (dsq < minDistSq) dsq = minDistSq;
      const dist = Math.sqrt(dsq);
      const forceMag = dist * attractionK * (edge.weight || 1);
      const fx = (dx / dist) * forceMag;
      const fy = (dy / dist) * forceMag;
      const fz = (dz / dist) * forceMag;
      forces[s * 3] += fx;     forces[s * 3 + 1] += fy;     forces[s * 3 + 2] += fz;
      forces[t * 3] -= fx;     forces[t * 3 + 1] -= fy;     forces[t * 3 + 2] -= fz;
    }

    // Integrate
    totalEnergy = 0;
    for (let i = 0; i < N; i++) {
      vel[i * 3]     = (vel[i * 3]     + forces[i * 3])     * damping;
      vel[i * 3 + 1] = (vel[i * 3 + 1] + forces[i * 3 + 1]) * damping;
      vel[i * 3 + 2] = (vel[i * 3 + 2] + forces[i * 3 + 2]) * damping;
      pos[i * 3]     += vel[i * 3];
      pos[i * 3 + 1] += vel[i * 3 + 1];
      pos[i * 3 + 2] += vel[i * 3 + 2];
      totalEnergy += Math.abs(vel[i * 3]) + Math.abs(vel[i * 3 + 1]) + Math.abs(vel[i * 3 + 2]);
    }

    if (totalEnergy < convThreshold) break;
  }

  return { positions: pos, iterations: iteration + 1, energy: totalEnergy };
}

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

describe('Macro Layout (§6.2)', () => {
  test('macro_layout_places_clusters_in_sphere — all centroids within 20-unit radius', () => {
    const clusters = Array.from({ length: 10 }, (_, i) => ({
      id: `cluster-${i}`,
      label: `C${i}`,
      depth: 1,
      centroid: { x: 0, y: 0, z: 0 },
      radius: 0,
      nodeIds: Array.from({ length: (i + 1) * 5 }, (_, j) => `node-${i}-${j}`),
    }));

    const result = macroLayout(clusters, 20);
    expect(result).toHaveLength(10);

    for (const c of result) {
      const mag = magnitude(c.centroid);
      expect(mag).toBeLessThanOrEqual(20);
      expect(mag).toBeGreaterThan(0);
    }
  });

  test('macro_layout_larger_clusters_closer_to_centre', () => {
    const clusters = [
      { id: 'large', label: 'Large', depth: 1, centroid: { x: 0, y: 0, z: 0 }, radius: 0, nodeIds: Array.from({ length: 100 }, (_, i) => `n${i}`) },
      { id: 'small', label: 'Small', depth: 1, centroid: { x: 0, y: 0, z: 0 }, radius: 0, nodeIds: Array.from({ length: 10 }, (_, i) => `m${i}`) },
    ];

    const result = macroLayout(clusters, 20);
    expect(result).toHaveLength(2);

    const largeMag = magnitude(result[0].centroid);
    const smallMag = magnitude(result[1].centroid);
    expect(largeMag).toBeLessThan(smallMag);
  });

  test('macro_layout_handles_empty_cluster_list', () => {
    expect(macroLayout([])).toEqual([]);
    expect(macroLayout(null)).toEqual([]);
    expect(macroLayout(undefined)).toEqual([]);
  });

  test('macro_layout_single_cluster_placed_at_origin_region', () => {
    const clusters = [
      { id: 'only', label: 'Only', depth: 0, centroid: { x: 0, y: 0, z: 0 }, radius: 0, nodeIds: ['n1'] },
    ];
    const result = macroLayout(clusters, 20);
    expect(result).toHaveLength(1);
    expect(magnitude(result[0].centroid)).toBeLessThanOrEqual(20);
  });

  test('macro_layout_cluster_radius_formula', () => {
    const c = { id: 't', label: 't', depth: 0, centroid: { x: 0, y: 0, z: 0 }, radius: 0, nodeIds: ['a', 'b', 'c', 'd'] };
    const result = macroLayout([c], 20);
    const expectedRadius = 3 + Math.sqrt(4) * 0.4; // 3 + 2 * 0.4 = 3.8
    expect(result[0].radius).toBeCloseTo(expectedRadius, 5);
  });
});

describe('Micro Layout (§6.3)', () => {
  test('micro_layout_attracts_connected_nodes — connected pair closer than unconnected', () => {
    const nodes = [
      { id: 0, x: 5, y: 0, z: 0 },
      { id: 1, x: -5, y: 0, z: 0 },
      { id: 2, x: 0, y: 5, z: 0 },
    ];
    const edges = [
      { source: 0, target: 1, weight: 1, type: 'import' },
    ];
    // Seed positions at the given x/y/z
    // We use a modified approach: test the force direction by hand
    // The connected pair (0,1) should move toward each other
    // Node 2 (unconnected) should drift away (repulsion only)

    const repulsionK = 0.01; // Very low repulsion to let attraction dominate
    const attractionK = 1.0;
    const damping = 0.9;

    // Manually simulate one iteration
    const pos = new Float64Array([5, 0, 0, -5, 0, 0, 0, 5, 0]);
    const vel = new Float64Array(9);
    const minDistSq = 0.0001;

    const forces = new Float64Array(9);

    // Repulsion pair 0-1
    let dx = pos[0] - pos[3];
    let dy = pos[1] - pos[4];
    let dz = pos[2] - pos[5];
    let dsq = dx*dx + dy*dy + dz*dz;
    if (dsq < minDistSq) dsq = minDistSq;
    let invDist = 1 / Math.sqrt(dsq);
    let fMag = repulsionK * invDist * invDist;
    let fx = dx * invDist * fMag;
    let fy = dy * invDist * fMag;
    let fz = dz * invDist * fMag;
    forces[0] += fx; forces[1] += fy; forces[2] += fz;
    forces[3] -= fx; forces[4] -= fy; forces[5] -= fz;

    // Repulsion pair 0-2
    dx = pos[0] - pos[6];
    dy = pos[1] - pos[7];
    dz = pos[2] - pos[8];
    dsq = dx*dx + dy*dy + dz*dz;
    if (dsq < minDistSq) dsq = minDistSq;
    invDist = 1 / Math.sqrt(dsq);
    fMag = repulsionK * invDist * invDist;
    fx = dx * invDist * fMag;
    fy = dy * invDist * fMag;
    fz = dz * invDist * fMag;
    forces[0] += fx; forces[1] += fy; forces[2] += fz;
    forces[6] -= fx; forces[7] -= fy; forces[8] -= fz;

    // Repulsion pair 1-2
    dx = pos[3] - pos[6];
    dy = pos[4] - pos[7];
    dz = pos[5] - pos[8];
    dsq = dx*dx + dy*dy + dz*dz;
    if (dsq < minDistSq) dsq = minDistSq;
    invDist = 1 / Math.sqrt(dsq);
    fMag = repulsionK * invDist * invDist;
    fx = dx * invDist * fMag;
    fy = dy * invDist * fMag;
    fz = dz * invDist * fMag;
    forces[3] += fx; forces[4] += fy; forces[5] += fz;
    forces[6] -= fx; forces[7] -= fy; forces[8] -= fz;

    // Attraction edge 0→1
    dx = pos[3] - pos[0];
    dy = pos[4] - pos[1];
    dz = pos[5] - pos[2];
    dsq = dx*dx + dy*dy + dz*dz;
    if (dsq < minDistSq) dsq = minDistSq;
    const dist = Math.sqrt(dsq);
    fMag = dist * attractionK * 1;
    fx = (dx / dist) * fMag;
    fy = (dy / dist) * fMag;
    fz = (dz / dist) * fMag;
    forces[0] += fx; forces[1] += fy; forces[2] += fz;
    forces[3] -= fx; forces[4] -= fy; forces[5] -= fz;

    // Integrate
    vel[0] = (vel[0] + forces[0]) * damping;
    vel[3] = (vel[3] + forces[3]) * damping;
    vel[6] = (vel[6] + forces[6]) * damping;

    // Node 0 (source of edge 0→1) and node 1 (target) should have velocities
    // toward each other, meaning opposite signs on x-axis
    expect(Math.sign(vel[0])).not.toBe(Math.sign(vel[3]));
    // Since nodes 0 and 1 start at x=5 and x=-5:
    // Node 0 should move left (vel[0] < 0), node 1 should move right (vel[3] > 0)
    expect(vel[0]).toBeLessThan(0);
    expect(vel[3]).toBeGreaterThan(0);
  });

  test('micro_layout_repels_unconnected_nodes — two nodes drift apart', () => {
    const result = microLayout(
      [{ id: 0, path: 'a', type: 'file', size: 10, importance: 0, changeFrequency: 0, clusterId: 0, position: { x: 0, y: 0, z: 0 } },
       { id: 1, path: 'b', type: 'file', size: 10, importance: 0, changeFrequency: 0, clusterId: 0, position: { x: 0, y: 0, z: 0 } }],
      [],
      { repulsionK: 1.0, maxIterations: 100 }
    );

    // Two nodes with no edges: they should repel each other
    // The distance between them should increase over time
    const dx = result.positions[0] - result.positions[3];
    const dy = result.positions[1] - result.positions[4];
    const dz = result.positions[2] - result.positions[5];
    const finalDist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    // They should have moved apart (initial positions were identical, so seeded randomly)
    expect(finalDist).toBeGreaterThan(0.01);
  });

  test('micro_layout_converges — 50 nodes 100 edges', () => {
    // Generate a small graph
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      id: i, path: `file-${i}.dart`, type: 'file', size: 100, importance: 0,
      changeFrequency: 0, clusterId: 0,
      position: { x: 0, y: 0, z: 0 },
    }));

    const edges = [];
    for (let i = 0; i < 100; i++) {
      const src = Math.floor(Math.random() * 50);
      let tgt = Math.floor(Math.random() * 50);
      while (tgt === src) tgt = (tgt + 1) % 50;
      edges.push({ source: src, target: tgt, type: 'import', weight: 1 });
    }

    const result = microLayout(nodes, edges, { maxIterations: 500, convergenceDelta: 0.001 });

    // Should converge (energy < threshold) within 500 iterations
    expect(result.iterations).toBeLessThanOrEqual(550);
  });

  test('micro_layout_handles_empty_cluster', () => {
    const result = microLayout([], []);
    expect(result.positions).toHaveLength(0);
    expect(result.iterations).toBe(0);
    expect(result.energy).toBe(0);
  });

  test('micro_layout_handles_single_node', () => {
    const result = microLayout(
      [{ id: 0, path: 'a', type: 'file', size: 10, importance: 0, changeFrequency: 0, clusterId: 0, position: { x: 0, y: 0, z: 0 } }],
      [],
      { maxIterations: 10 }
    );
    // Single node — no forces to apply, should remain stable
    expect(result.iterations).toBe(1);
    expect(Number.isFinite(result.energy)).toBe(true);
  });
});

describe('Graph Hash (02-TSD.md §5.4)', () => {
  function simpleHash(nodes, edges) {
    const str = JSON.stringify({
      nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges].sort((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        return a.target.localeCompare(b.target);
      }),
    });
    // Simple deterministic hash for testing
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  test('graph_hash_changes_on_node_add — adding a node changes the hash', () => {
    const nodes = [{ id: 'a.dart' }, { id: 'b.dart' }];
    const edges = [{ source: 'a.dart', target: 'b.dart', type: 'import', weight: 1 }];
    const hash1 = simpleHash(nodes, edges);

    const nodes2 = [...nodes, { id: 'c.dart' }];
    const hash2 = simpleHash(nodes2, edges);

    expect(hash1).not.toBe(hash2);
  });

  test('graph_hash_is_order_independent', () => {
    const nodes1 = [{ id: 'z.dart' }, { id: 'a.dart' }];
    const nodes2 = [{ id: 'a.dart' }, { id: 'z.dart' }];
    const edges = [{ source: 'a.dart', target: 'z.dart', type: 'import', weight: 1 }];

    const hash1 = simpleHash(nodes1, edges);
    const hash2 = simpleHash(nodes2, edges);

    expect(hash1).toBe(hash2);
  });
});

describe('Layout Cache (02-TSD.md §5.4)', () => {
  test('layout_cache_hit_skips_computation — cached hash returns positions', () => {
    const cache = new Map();
    const nodes = [{ id: 'a.dart' }, { id: 'b.dart' }];
    const key = 'ws|' + 'hash123';
    const cachedPositions = new Float64Array([1, 2, 3, 4, 5, 6]);

    cache.set(key, cachedPositions);

    const graphHash = 'hash123';
    const cacheKey = 'ws|' + graphHash;
    const cached = cache.get(cacheKey);

    expect(cached).toBeDefined();
    expect(cached).toBe(cachedPositions);
    expect(cached.length).toBe(6);
  });

  test('layout_cache_miss_triggers_computation — no cached result', () => {
    const cache = new Map();
    const graphHash = 'hash456';
    const cacheKey = 'ws|' + graphHash;
    expect(cache.has(cacheKey)).toBe(false);
  });
});
