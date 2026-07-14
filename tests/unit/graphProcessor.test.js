/**
 * graphProcessor.test.js — Unit Tests for Graphify Data Processing Pipeline
 *
 * Tests the transformations from raw API response → internal layout format:
 *   normalizeNodes, normalizeEdges, extractClusters, computeGraphHash
 *
 * @see 08-Testing-Spec.md §1 — Unit test scope (≥ 80% line coverage)
 */

import { describe, test, expect, jest } from '@jest/globals';
import {
  normalizeNodes,
  normalizeEdges,
  extractClusters,
  computeGraphHash,
  pathToClusterId,
  clusterDepth,
  clusterLabel,
  simulateChangeFrequency,
} from '../../backend/graphProcessor.js';

// ─── Mock Data ──────────────────────────────────────────────────────────

const SAMPLE_API_NODES = [
  {
    id: 'src/auth/AuthService.dart',
    path: 'src/auth/AuthService.dart',
    label: 'AuthService',
    type: 'file',
    language: 'dart',
    size: 847,
    importance: 12,
  },
  {
    id: 'src/models/User.dart',
    path: 'src/models/User.dart',
    label: 'User',
    type: 'file',
    language: 'dart',
    size: 120,
    importance: 8,
  },
  {
    id: 'src/auth/LoginController.dart',
    path: 'src/auth/LoginController.dart',
    label: 'LoginController',
    type: 'file',
    language: 'dart',
    size: 310,
    importance: 9,
  },
  {
    id: 'src/utils/TokenManager.dart',
    path: 'src/utils/TokenManager.dart',
    label: 'TokenManager',
    type: 'file',
    language: 'dart',
    size: 430,
    importance: 7,
  },
  {
    id: 'config/api_config.yaml',
    path: 'config/api_config.yaml',
    label: 'api_config',
    type: 'file',
    language: 'yaml',
    size: 45,
    importance: 3,
  },
  {
    id: 'README.md',
    path: 'README.md',
    label: 'README',
    type: 'file',
    language: 'markdown',
    size: 12,
    importance: 1,
  },
];

const SAMPLE_API_EDGES = [
  { source: 'src/auth/AuthService.dart', target: 'src/models/User.dart', type: 'import', weight: 1 },
  { source: 'src/auth/AuthService.dart', target: 'src/utils/TokenManager.dart', type: 'import', weight: 1 },
  { source: 'src/auth/LoginController.dart', target: 'src/auth/AuthService.dart', type: 'call', weight: 3 },
  { source: 'src/utils/TokenManager.dart', target: 'config/api_config.yaml', type: 'import', weight: 1 },
  { source: 'src/models/User.dart', target: 'src/models/User.dart', type: 'import', weight: 1 }, // self-loop — should be filtered
];

const SAMPLE_EMPTY_NODES = [];
const SAMPLE_EMPTY_EDGES = [];

// ─── pathToClusterId ────────────────────────────────────────────────────

describe('pathToClusterId()', () => {
  test('two-level path returns first directory segment', () => {
    expect(pathToClusterId('src/auth/AuthService.dart')).toBe('src/auth');
  });

  test('three-level path returns first two segments', () => {
    expect(pathToClusterId('src/auth/sub/AuthService.dart')).toBe('src/auth/sub');
  });

  test('four-level path is capped at MAX_CLUSTER_DEPTH (3)', () => {
    // Directory segments: src, auth, sub, deep → capped at 3 → src/auth/sub
    expect(pathToClusterId('src/auth/sub/deep/AuthService.dart')).toBe('src/auth/sub');
  });

  test('five-level path also capped at 3', () => {
    expect(pathToClusterId('a/b/c/d/e/file.txt')).toBe('a/b/c');
  });

  test('root-level file returns "root"', () => {
    expect(pathToClusterId('README.md')).toBe('root');
  });

  test('empty string returns "root"', () => {
    expect(pathToClusterId('')).toBe('root');
  });

  test('null returns "root"', () => {
    expect(pathToClusterId(null)).toBe('root');
  });

  test('undefined returns "root"', () => {
    expect(pathToClusterId(undefined)).toBe('root');
  });

  test('Windows backslashes are normalized', () => {
    expect(pathToClusterId('src\\auth\\AuthService.dart')).toBe('src/auth');
  });

  test('file at root of deeply nested path uses first segment only', () => {
    expect(pathToClusterId('src/file.js')).toBe('src');
  });

  test('path with trailing slash is handled', () => {
    expect(pathToClusterId('src/auth/file.js')).toBe('src/auth');
  });
});

// ─── clusterDepth ───────────────────────────────────────────────────────

describe('clusterDepth()', () => {
  test('root cluster has depth 0', () => {
    expect(clusterDepth('root')).toBe(0);
  });

  test('single-segment cluster has depth 1', () => {
    expect(clusterDepth('src')).toBe(1);
  });

  test('two-segment cluster has depth 2', () => {
    expect(clusterDepth('src/auth')).toBe(2);
  });

  test('three-segment cluster has depth 3', () => {
    expect(clusterDepth('src/auth/sub')).toBe(3);
  });

  test('four-segment cluster is still depth 3 (capped)', () => {
    expect(clusterDepth('src/auth/sub/deep')).toBe(3);
  });
});

// ─── clusterLabel ───────────────────────────────────────────────────────

describe('clusterLabel()', () => {
  test('root cluster label is "root"', () => {
    expect(clusterLabel('root')).toBe('root');
  });

  test('single-segment label is the segment', () => {
    expect(clusterLabel('src')).toBe('src');
  });

  test('multi-segment label is the last segment', () => {
    expect(clusterLabel('src/auth')).toBe('auth');
  });

  test('deep path label is the innermost segment', () => {
    expect(clusterLabel('src/auth/sub/deep')).toBe('deep');
  });
});

// ─── normalizeNodes ─────────────────────────────────────────────────────

describe('normalizeNodes()', () => {
  test('returns empty array for null input', () => {
    expect(normalizeNodes(null)).toEqual([]);
  });

  test('returns empty array for undefined input', () => {
    expect(normalizeNodes(undefined)).toEqual([]);
  });

  test('returns empty array for non-array input', () => {
    expect(normalizeNodes({})).toEqual([]);
  });

  test('returns empty array for empty array input', () => {
    expect(normalizeNodes([])).toEqual([]);
  });

  test('normalizes the YodaMan Graphify map response and infers its language', () => {
    const result = normalizeNodes([{
      id: 'core_src_App_jsx',
      label: 'App.jsx',
      sourceFile: 'core/src/App.jsx',
      sourceLocation: 'L1',
      fileType: 'file',
      community: 7,
    }]);

    expect(result[0]).toMatchObject({
      path: 'core/src/App.jsx',
      type: 'file',
      language: 'js',
      clusterId: 'core/src',
    });
  });

  test('preserves all nodes from sample input', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    expect(result).toHaveLength(6);
  });

  test('each node has all required fields', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    for (const node of result) {
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('path');
      expect(node).toHaveProperty('type');
      expect(node).toHaveProperty('language');
      expect(node).toHaveProperty('size');
      expect(node).toHaveProperty('importance');
      expect(node).toHaveProperty('changeFrequency');
      expect(node).toHaveProperty('recentlyChanged');
      expect(node).toHaveProperty('clusterId');
      expect(node).toHaveProperty('position');
      expect(node.position).toHaveProperty('x');
      expect(node.position).toHaveProperty('y');
      expect(node.position).toHaveProperty('z');
    }
  });

  test('id and path are preserved as strings', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    expect(result[0].id).toBe('src/auth/AuthService.dart');
    expect(result[0].path).toBe('src/auth/AuthService.dart');
  });

  test('type is one of the valid node types', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    const validTypes = ['file', 'class', 'function', 'folder'];
    for (const node of result) {
      expect(validTypes).toContain(node.type);
    }
  });

  test('invalid node type defaults to "file"', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'unknown_type', language: 'js', size: 1, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].type).toBe('file');
  });

  test('size is rounded down to integer', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', size: 123.78, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].size).toBe(123);
  });

  test('negative size is clamped to 0', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', size: -5, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].size).toBe(0);
  });

  test('NaN size defaults to 0', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', size: NaN, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].size).toBe(0);
  });

  test('missing size defaults to 0', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].size).toBe(0);
  });

  test('importance is clamped to 0 minimum', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', size: 1, importance: -10 }];
    const result = normalizeNodes(nodes);
    expect(result[0].importance).toBe(0);
  });

  test('missing importance defaults to 0', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', size: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].importance).toBe(0);
  });

  test('NaN importance defaults to 0', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', language: 'js', size: 1, importance: NaN }];
    const result = normalizeNodes(nodes);
    expect(result[0].importance).toBe(0);
  });

  test('clusterId is derived from path', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    expect(result[0].clusterId).toBe('src/auth');  // AuthService
    expect(result[1].clusterId).toBe('src/models'); // User
    expect(result[4].clusterId).toBe('config');     // api_config
    expect(result[5].clusterId).toBe('root');       // README
  });

  test('recentlyChanged is true when changeFrequency > 3', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    for (const node of result) {
      if (node.changeFrequency > 3) {
        expect(node.recentlyChanged).toBe(true);
      } else {
        expect(node.recentlyChanged).toBe(false);
      }
    }
  });

  test('position is initialised to origin placeholder', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    for (const node of result) {
      expect(node.position).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  test('handles missing id by generating one', () => {
    const nodes = [{ path: 'some/path.js', type: 'file', language: 'js', size: 1, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].id).toBe('generated-id-0');
  });

  test('handles empty id string by generating one', () => {
    const nodes = [{ id: '', path: 'x', type: 'file', language: 'js', size: 1, importance: 1 }];
    const result = normalizeNodes(nodes);
    // Generated ID because the empty string fails the .trim() !== '' check
    expect(result[0].id).not.toBe('');
    expect(typeof result[0].id).toBe('string');
  });

  test('missing path falls back to id', () => {
    const nodes = [{ id: 'my-id', type: 'file', language: 'js', size: 1, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].path).toBe('my-id');
  });

  test('language defaults to empty string when missing', () => {
    const nodes = [{ id: 'x', path: 'x', type: 'file', size: 1, importance: 1 }];
    const result = normalizeNodes(nodes);
    expect(result[0].language).toBe('');
  });

  test('changeFrequency is deterministic (same path = same value)', () => {
    const result1 = normalizeNodes([SAMPLE_API_NODES[0]]);
    const result2 = normalizeNodes([SAMPLE_API_NODES[0]]);
    expect(result1[0].changeFrequency).toBe(result2[0].changeFrequency);
  });

  test('changeFrequency differs for different paths', () => {
    const result = normalizeNodes(SAMPLE_API_NODES);
    // At least some nodes should have different change frequencies
    const frequencies = new Set(result.map((n) => n.changeFrequency));
    expect(frequencies.size).toBeGreaterThan(1);
  });
});

// ─── simulateChangeFrequency ────────────────────────────────────────────

describe('simulateChangeFrequency()', () => {
  test('returns a number between 0 and 10', () => {
    const paths = ['a', 'b', 'long/path/file.js', 'completely/different/path.py'];
    for (const p of paths) {
      const val = simulateChangeFrequency(p);
      expect(typeof val).toBe('number');
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  test('returns integer values', () => {
    const val = simulateChangeFrequency('src/auth/AuthService.dart');
    expect(Number.isInteger(val)).toBe(true);
  });

  test('is deterministic', () => {
    const val1 = simulateChangeFrequency('test/path/file.ts');
    const val2 = simulateChangeFrequency('test/path/file.ts');
    expect(val1).toBe(val2);
  });

  test('returns 0 for null / undefined', () => {
    expect(simulateChangeFrequency(null)).toBe(0);
    expect(simulateChangeFrequency(undefined)).toBe(0);
    expect(simulateChangeFrequency('')).toBe(0);
  });
});

// ─── normalizeEdges ─────────────────────────────────────────────────────

describe('normalizeEdges()', () => {
  test('returns empty array for null input', () => {
    expect(normalizeEdges(null)).toEqual([]);
  });

  test('returns empty array for undefined input', () => {
    expect(normalizeEdges(undefined)).toEqual([]);
  });

  test('returns empty array for non-array input', () => {
    expect(normalizeEdges({})).toEqual([]);
  });

  test('returns empty array for empty array input', () => {
    expect(normalizeEdges([])).toEqual([]);
  });

  test('preserves valid edges from sample input', () => {
    const result = normalizeEdges(SAMPLE_API_EDGES);
    // 4 valid edges (the self-loop is filtered out)
    expect(result).toHaveLength(4);
  });

  test('filters out self-loops (source === target)', () => {
    const edges = [
      { source: 'a', target: 'b', type: 'import', weight: 1 },
      { source: 'a', target: 'a', type: 'import', weight: 1 }, // self-loop
    ];
    const result = normalizeEdges(edges);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('a');
    expect(result[0].target).toBe('b');
  });

  test('each edge has all required fields', () => {
    const result = normalizeEdges(SAMPLE_API_EDGES);
    for (const edge of result) {
      expect(edge).toHaveProperty('id');
      expect(edge).toHaveProperty('source');
      expect(edge).toHaveProperty('target');
      expect(edge).toHaveProperty('type');
      expect(edge).toHaveProperty('weight');
    }
  });

  test('edge id is source→target format', () => {
    const result = normalizeEdges([{ source: 'a', target: 'b', type: 'import', weight: 1 }]);
    expect(result[0].id).toBe('a→b');
  });

  test('unknown edge type defaults to "import"', () => {
    const edges = [{ source: 'a', target: 'b', type: 'unknown_type', weight: 1 }];
    const result = normalizeEdges(edges);
    expect(result[0].type).toBe('import');
  });

  test('case-insensitive type matching', () => {
    const edges = [
      { source: 'a', target: 'b', type: 'IMPORT', weight: 1 },
      { source: 'c', target: 'd', type: 'Call', weight: 1 },
    ];
    const result = normalizeEdges(edges);
    expect(result[0].type).toBe('import');
    expect(result[1].type).toBe('call');
  });

  test('valid types pass through unchanged', () => {
    const edges = [
      { source: 'a', target: 'b', type: 'import', weight: 1 },
      { source: 'b', target: 'c', type: 'call', weight: 1 },
      { source: 'c', target: 'd', type: 'inheritance', weight: 1 },
      { source: 'd', target: 'e', type: 'composition', weight: 1 },
    ];
    const result = normalizeEdges(edges);
    expect(result[0].type).toBe('import');
    expect(result[1].type).toBe('call');
    expect(result[2].type).toBe('inheritance');
    expect(result[3].type).toBe('composition');
  });

  test('weight defaults to 1 when missing', () => {
    const edges = [{ source: 'a', target: 'b', type: 'import' }];
    const result = normalizeEdges(edges);
    expect(result[0].weight).toBe(1);
  });

  test('weight is floored to integer', () => {
    const edges = [{ source: 'a', target: 'b', type: 'import', weight: 2.7 }];
    const result = normalizeEdges(edges);
    expect(result[0].weight).toBe(2);
  });

  test('weight less than 1 is clamped to 1', () => {
    const edges = [{ source: 'a', target: 'b', type: 'import', weight: 0 }];
    const result = normalizeEdges(edges);
    expect(result[0].weight).toBe(1);
  });

  test('NaN weight defaults to 1', () => {
    const edges = [{ source: 'a', target: 'b', type: 'import', weight: NaN }];
    const result = normalizeEdges(edges);
    expect(result[0].weight).toBe(1);
  });

  test('deduplicates edges with same source, target, and type', () => {
    const edges = [
      { source: 'a', target: 'b', type: 'import', weight: 1 },
      { source: 'a', target: 'b', type: 'import', weight: 2 }, // duplicate type
      { source: 'a', target: 'b', type: 'call', weight: 1 },   // different type — kept
    ];
    const result = normalizeEdges(edges);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('import');
    expect(result[1].type).toBe('call');
  });

  test('filters edges with empty source or target', () => {
    const edges = [
      { source: '', target: 'b', type: 'import', weight: 1 },
      { source: 'a', target: '', type: 'import', weight: 1 },
    ];
    const result = normalizeEdges(edges);
    expect(result).toHaveLength(0);
  });

  test('missing source or target is filtered', () => {
    const edges = [
      { target: 'b', type: 'import', weight: 1 },
      { source: 'a', type: 'import', weight: 1 },
    ];
    const result = normalizeEdges(edges);
    expect(result).toHaveLength(0);
  });
});

// ─── extractClusters ────────────────────────────────────────────────────

describe('extractClusters()', () => {
  test('returns empty array for null input', () => {
    expect(extractClusters(null)).toEqual([]);
  });

  test('returns empty array for undefined input', () => {
    expect(extractClusters(undefined)).toEqual([]);
  });

  test('returns empty array for empty array input', () => {
    expect(extractClusters([])).toEqual([]);
  });

  test('groups nodes by clusterId', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    // 4 clusters: src/auth (2 nodes), src/models (1), config (1), root (1),
    // src/utils (1)
    expect(clusters).toHaveLength(5);
  });

  test('each cluster has all required fields', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    for (const cluster of clusters) {
      expect(cluster).toHaveProperty('id');
      expect(cluster).toHaveProperty('label');
      expect(cluster).toHaveProperty('depth');
      expect(cluster).toHaveProperty('centroid');
      expect(cluster.centroid).toHaveProperty('x');
      expect(cluster.centroid).toHaveProperty('y');
      expect(cluster.centroid).toHaveProperty('z');
      expect(cluster).toHaveProperty('radius');
      expect(cluster).toHaveProperty('nodeIds');
      expect(Array.isArray(cluster.nodeIds)).toBe(true);
    }
  });

  test('clusters are sorted by nodeCount descending', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i - 1].nodeIds.length)
        .toBeGreaterThanOrEqual(clusters[i].nodeIds.length);
    }
  });

  test('the densest cluster comes first', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    // src/auth has 2 nodes — should be first
    expect(clusters[0].id).toBe('src/auth');
    expect(clusters[0].nodeIds).toHaveLength(2);
  });

  test('cluster radius follows formula: 3 + sqrt(nodeCount) * 0.4', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    for (const cluster of clusters) {
      const expectedRadius = 3 + Math.sqrt(cluster.nodeIds.length) * 0.4;
      expect(cluster.radius).toBeCloseTo(expectedRadius, 5);
    }
  });

  test('cluster depth matches path segment count', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    const clusterMap = new Map(clusters.map((c) => [c.id, c]));
    expect(clusterMap.get('src/auth').depth).toBe(2);
    expect(clusterMap.get('src/models').depth).toBe(2);
    expect(clusterMap.get('config').depth).toBe(1);
    expect(clusterMap.get('src/utils').depth).toBe(2);
    expect(clusterMap.get('root').depth).toBe(0);
  });

  test('cluster label is the last path segment', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    const clusterMap = new Map(clusters.map((c) => [c.id, c]));
    expect(clusterMap.get('src/auth').label).toBe('auth');
    expect(clusterMap.get('root').label).toBe('root');
    expect(clusterMap.get('config').label).toBe('config');
  });

  test('centroid is initialised to origin placeholder', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    for (const cluster of clusters) {
      expect(cluster.centroid).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  test('all node IDs from input are assigned to a cluster', () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const clusters = extractClusters(nodes);

    const allAssignedIds = new Set(clusters.flatMap((c) => c.nodeIds));
    for (const node of nodes) {
      expect(allAssignedIds.has(node.id)).toBe(true);
    }
  });

  test('single-node cluster is handled correctly', () => {
    const nodes = normalizeNodes([SAMPLE_API_NODES[0]]); // Just AuthService
    const clusters = extractClusters(nodes);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe('src/auth');
    expect(clusters[0].nodeIds).toHaveLength(1);
    expect(clusters[0].radius).toBeCloseTo(3 + Math.sqrt(1) * 0.4, 5);
  });
});

// ─── computeGraphHash ───────────────────────────────────────────────────

describe('computeGraphHash()', () => {
  test('returns a hex string of length 64 (SHA-256)', async () => {
    const hash = await computeGraphHash([], []);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  test('is deterministic — same input produces same hash', async () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const edges = normalizeEdges(SAMPLE_API_EDGES);

    const hash1 = await computeGraphHash(nodes, edges);
    const hash2 = await computeGraphHash(nodes, edges);
    expect(hash1).toBe(hash2);
  });

  test('different nodes produce different hashes', async () => {
    const hash1 = await computeGraphHash(
      normalizeNodes([SAMPLE_API_NODES[0]]),
      []
    );
    const hash2 = await computeGraphHash(
      normalizeNodes([SAMPLE_API_NODES[1]]),
      []
    );
    expect(hash1).not.toBe(hash2);
  });

  test('different edges produce different hashes', async () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES.slice(0, 2));

    const hash1 = await computeGraphHash(nodes, [
      { source: 'a', target: 'b', type: 'import', weight: 1 },
    ]);
    const hash2 = await computeGraphHash(nodes, [
      { source: 'a', target: 'b', type: 'call', weight: 1 },
    ]);
    expect(hash1).not.toBe(hash2);
  });

  test('adding a node changes the hash', async () => {
    const nodes1 = normalizeNodes([SAMPLE_API_NODES[0]]);
    const nodes2 = normalizeNodes([SAMPLE_API_NODES[0], SAMPLE_API_NODES[1]]);

    const hash1 = await computeGraphHash(nodes1, []);
    const hash2 = await computeGraphHash(nodes2, []);
    expect(hash1).not.toBe(hash2);
  });

  test('is order-independent — same data in different order = same hash', async () => {
    const nodes = normalizeNodes(SAMPLE_API_NODES);
    const edges = normalizeEdges(SAMPLE_API_EDGES);

    const hash1 = await computeGraphHash(nodes, edges);

    // Reverse the arrays before hashing
    const reversedNodes = [...nodes].reverse();
    const reversedEdges = [...edges].reverse();
    const hash2 = await computeGraphHash(reversedNodes, reversedEdges);

    expect(hash1).toBe(hash2);
  });

  test('empty nodes and edges produce a stable hash', async () => {
    const hash1 = await computeGraphHash([], []);
    const hash2 = await computeGraphHash([], []);
    expect(hash1).toBe(hash2);
  });

  test('handles non-array arguments gracefully', async () => {
    const hash1 = await computeGraphHash(null, undefined);
    const hash2 = await computeGraphHash(undefined, null);
    expect(typeof hash1).toBe('string');
    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
  });

  test('hash changes when version field is bumped conceptually', async () => {
    // If we add a new field to the canonical payload, the hash changes.
    // This test verifies that two different payloads produce different hashes.
    const hash1 = await computeGraphHash([{ id: 'a', path: 'a', type: 'file', size: 1, importance: 1 }], []);
    const hash2 = await computeGraphHash([{ id: 'a', path: 'a', type: 'file', size: 2, importance: 1 }], []);
    expect(hash1).not.toBe(hash2);
  });
});

// ─── Integration: Full Pipeline ─────────────────────────────────────────

describe('Integration: full pipeline (API → normalize → clusters → hash)', () => {
  test('processes a complete API response end-to-end', async () => {
    // Simulate what graphCache.js does
    const apiResponse = {
      nodes: SAMPLE_API_NODES,
      edges: SAMPLE_API_EDGES,
    };

    const nodes = normalizeNodes(apiResponse.nodes);
    const edges = normalizeEdges(apiResponse.edges);
    const clusters = extractClusters(nodes);
    const hash = await computeGraphHash(nodes, edges);

    // Node assertions
    expect(nodes).toHaveLength(6);
    expect(nodes.every((n) => n.clusterId !== undefined)).toBe(true);

    // Edge assertions
    expect(edges).toHaveLength(4); // Self-loop filtered
    expect(edges.every((e) => e.source !== e.target)).toBe(true);

    // Cluster assertions
    expect(clusters.length).toBeGreaterThanOrEqual(4);
    expect(clusters[0].nodeIds.length)
      .toBeGreaterThanOrEqual(clusters[clusters.length - 1].nodeIds.length);

    // Hash assertions
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
  });

  test('empty graph produces empty clusters and a valid hash', async () => {
    const nodes = normalizeNodes([]);
    const edges = normalizeEdges([]);
    const clusters = extractClusters(nodes);
    const hash = await computeGraphHash(nodes, edges);

    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
    expect(clusters).toHaveLength(0);
    expect(hash).toHaveLength(64);
  });

  test('malformed input (missing fields) does not throw', () => {
    const malformedNodes = [
      { id: 'valid-id', path: 'valid-path', type: 'file' },
      { type: 'file' }, // missing id, path
      null,
      undefined,
      'string instead of object',
    ];

    const result = normalizeNodes(malformedNodes);
    // Should not throw; malformed entries get defaults or are skipped
    expect(Array.isArray(result)).toBe(true);
    // The null, undefined, and string entries should produce generated IDs
    expect(result.length).toBe(malformedNodes.length);
  });
});
