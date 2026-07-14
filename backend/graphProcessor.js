/**
 * graphProcessor.js — Graphify API Response → Layout Engine Pipeline
 *
 * Transforms the raw Graphify API response format into the internal data
 * structures consumed by the layout engine (WASM + Web Worker).
 *
 * Pipeline:
 *   API response → normalizeNodes() + normalizeEdges()
 *                → extractClusters()
 *                → computeGraphHash()
 *                → layoutWorker.js (WASM init_graph / populate / compute_layout)
 *
 * @see 02-TSD.md §5   — Data model schemas (GraphNode, GraphEdge, ClusterNode)
 * @see 05-YodaMan-Integration.md §3 — API response formats
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum folder depth used to derive clusterId (02-TSD.md §5.1). */
const MAX_CLUSTER_DEPTH = 3;

/** Ordered cluster depth labels (02-TSD.md §5.3). */
const CLUSTER_DEPTH_LABELS = {
  0: 'root',
  1: 'feature',
  2: 'module',
  3: 'submodule',
};

/** Allowed node types from the Graphify API (02-TSD.md §5.1). */
const VALID_NODE_TYPES = new Set(['file', 'class', 'function', 'folder']);

/** Allowed edge types (02-TSD.md §5.2). */
const VALID_EDGE_TYPES = new Set(['import', 'call', 'inheritance', 'composition']);

/**
 * Default edge type map — passes through known types unchanged.
 * In future versions this could remap API-specific type names to the
 * four canonical types.
 */
const EDGE_TYPE_MAP = {
  import: 'import',
  call: 'call',
  inheritance: 'inheritance',
  composition: 'composition',
};

const LANGUAGE_BY_EXTENSION = {
  dart: 'dart', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  ts: 'ts', tsx: 'tsx', json: 'json', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', md: 'md', css: 'css', scss: 'scss', html: 'html',
  py: 'py', rs: 'rs', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
};

// ─── Internal Helpers ───────────────────────────────────────────────────

/**
 * Extract a cluster ID from a file path by taking the first N path
 * segments (max depth 3). Root-level files get cluster "root".
 *
 * Examples:
 *   "src/auth/AuthService.dart"  →  "src/auth"
 *   "src/auth/LoginController.dart" → "src/auth"
 *   "README.md"                   →  "root"
 *   "src/utils/TokenManager.dart" → "src/utils"
 *
 * @param {string} path — Workspace-relative file path
 * @returns {string} Cluster identifier
 */
function pathToClusterId(path) {
  if (!path || path.trim() === '') return 'root';

  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  // Single segment (root-level file like "README.md")
  if (segments.length <= 1) return 'root';

  // Exclude the last segment (filename), take up to MAX_CLUSTER_DEPTH
  // directory segments as the cluster ID.
  //   "src/auth/AuthService.dart"     → dirs: [src, auth]       → "src/auth"
  //   "src/auth/sub/deep/AuthService.dart" → dirs: [src, auth, sub, deep]
  //                                        capped at 3 → "src/auth/sub"
  //   "README.md"                     → root (single segment)
  const dirSegments = segments.slice(0, -1);
  const clusterSegments = dirSegments.slice(0, MAX_CLUSTER_DEPTH);
  return clusterSegments.join('/');
}

/**
 * Determine the depth of a cluster from its ID (number of path segments).
 * Depth 0 = root, 1 = feature, 2 = module, 3+ = submodule.
 *
 * @param {string} clusterId
 * @returns {number} 0–3
 */
function clusterDepth(clusterId) {
  if (!clusterId || clusterId === 'root') return 0;
  const segments = clusterId.split('/').filter(Boolean);
  return Math.min(segments.length, MAX_CLUSTER_DEPTH);
}

/**
 * Extract the display label from a cluster ID (last path segment).
 *
 * @param {string} clusterId
 * @returns {string}
 */
function clusterLabel(clusterId) {
  if (!clusterId || clusterId === 'root') return 'root';
  const segments = clusterId.split('/').filter(Boolean);
  return segments[segments.length - 1];
}

/**
 * Generate an edge ID from source and target node IDs.
 *
 * @param {string} source — Source node ID
 * @param {string} target — Target node ID
 * @returns {string}
 */
function makeEdgeId(source, target) {
  return `${source}→${target}`;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Normalize an array of API node objects to the internal GraphNode format.
 *
 * API input shape (05-YodaMan-Integration.md §3.2):
 *   { id: string, path: string, label: string, type: string,
 *     language: string, size: number, importance: number }
 *
 * Internal output shape (02-TSD.md §5.1):
 *   { id, path, type, language, size, importance, changeFrequency,
 *     recentlyChanged, clusterId, position: { x, y, z } }
 *
 * @param {Array<object>} apiNodes — Raw node list from /api/graphify/map
 * @returns {Array<object>} Normalized GraphNode array
 */
function normalizeNodes(apiNodes) {
  if (!Array.isArray(apiNodes)) return [];

  return apiNodes.map((node, index) => {
    // Guard against null/undefined entries in the array — generate a
    // placeholder node instead of crashing (graceful degradation).
    if (!node || typeof node !== 'object') {
      return {
        id: `generated-id-${index}`,
        path: `generated-id-${index}`,
        type: 'file',
        language: '',
        size: 0,
        importance: 0,
        changeFrequency: 0,
        recentlyChanged: false,
        clusterId: 'root',
        position: { x: 0, y: 0, z: 0 },
      };
    }

    const id = typeof node.id === 'string' && node.id.trim() !== ''
      ? node.id.trim()
      : `generated-id-${index}`;

    const sourcePath = node.path || node.sourceFile || node.source_file;
    const path = typeof sourcePath === 'string' && sourcePath.trim() !== ''
      ? sourcePath.trim()
      : id;

    const rawType = node.type || node.fileType || node.file_type || node.metadata?.kind;
    const type = VALID_NODE_TYPES.has(rawType) ? rawType : 'file';

    const explicitLanguage = node.language || node.metadata?.language;
    const extension = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
    const language = typeof explicitLanguage === 'string' && explicitLanguage
      ? explicitLanguage.toLowerCase()
      : (LANGUAGE_BY_EXTENSION[extension] || '');

    const size = typeof node.size === 'number' && !Number.isNaN(node.size)
      ? Math.max(0, Math.floor(node.size))
      : 0;

    const importance = typeof node.importance === 'number' && !Number.isNaN(node.importance)
      ? Math.max(0, node.importance)
      : 0;

    // Simulate changeFrequency using a simple hash of the path for
    // deterministic behaviour in the absence of YodaMan's file watcher.
    // In production, this comes from YodaMan's file-watcher service.
    const changeFrequency = simulateChangeFrequency(path);

    const recentlyChanged = changeFrequency > 3;

    const clusterId = pathToClusterId(path);

    return {
      id,
      path,
      type,
      language,
      size,
      importance,
      changeFrequency,
      recentlyChanged,
      clusterId,
      // Placeholder — layout engine computes actual positions
      position: { x: 0, y: 0, z: 0 },
    };
  });
}

/**
 * Deterministic change frequency simulation.
 *
 * Uses a lightweight hash of the path to produce a value 0–10.
 * Hot files (frequently changed) get higher values.
 * This is a stand-in until YodaMan's file-watcher data is available.
 *
 * @param {string} path
 * @returns {number} 0–10
 */
function simulateChangeFrequency(path) {
  if (!path) return 0;

  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Map to 0–10 range
  return Math.abs(hash) % 11;
}

/**
 * Normalize an array of API edge objects to the internal GraphEdge format.
 *
 * API input shape (05-YodaMan-Integration.md §3.2):
 *   { source: string, target: string, type: string, weight: number }
 *
 * Internal output shape (02-TSD.md §5.2):
 *   { id, source, target, type, weight }
 *
 * Type mapping:
 *   "import"       → "import"
 *   "call"         → "call"
 *   "inheritance"  → "inheritance"
 *   "composition"  → "composition"
 *   Unknown types  → "import" (default)
 *
 * @param {Array<object>} apiEdges — Raw edge list from /api/graphify/map
 * @returns {Array<object>} Normalized GraphEdge array
 */
function normalizeEdges(apiEdges) {
  if (!Array.isArray(apiEdges)) return [];

  // Deduplicate by (source, target, type) — API may return duplicates
  const seen = new Set();

  return apiEdges
    .filter((edge) => {
      const source = typeof edge.source === 'string' ? edge.source.trim() : '';
      const target = typeof edge.target === 'string' ? edge.target.trim() : '';
      return source !== '' && target !== '' && source !== target;
    })
    .map((edge) => {
      const source = edge.source.trim();
      const target = edge.target.trim();
      const rawType = typeof edge.type === 'string' ? edge.type.trim().toLowerCase() : '';
      const type = EDGE_TYPE_MAP[rawType] || 'import';
      const weight = typeof edge.weight === 'number' && !Number.isNaN(edge.weight)
        ? Math.max(1, Math.floor(edge.weight))
        : 1;

      return { source, target, type, weight };
    })
    .filter((edge) => {
      // Deduplicate: keep first occurrence of each (source, target, type)
      const key = `${edge.source}|${edge.target}|${edge.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((edge) => ({
      ...edge,
      id: makeEdgeId(edge.source, edge.target),
    }));
}

/**
 * Extract ClusterNode objects from a list of normalized GraphNodes.
 *
 * Groups nodes by clusterId and creates ClusterNode entries per
 * 02-TSD.md §5.3 with centroid placeholder (computed by WASM layout).
 *
 * @param {Array<object>} nodes — Normalized GraphNode array
 * @returns {Array<object>} ClusterNode array sorted by nodeCount DESC
 */
function extractClusters(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  // Group node IDs by clusterId
  const clusterMap = new Map();

  for (const node of nodes) {
    const cid = node.clusterId || 'root';
    if (!clusterMap.has(cid)) {
      clusterMap.set(cid, { nodeIds: [] });
    }
    clusterMap.get(cid).nodeIds.push(node.id);
  }

  // Build ClusterNode objects
  const clusters = [];
  for (const [clusterId, { nodeIds }] of clusterMap) {
    clusters.push({
      id: clusterId,
      label: clusterLabel(clusterId),
      depth: clusterDepth(clusterId),
      // Placeholder centroids — the WASM macro_layout computes these
      centroid: { x: 0, y: 0, z: 0 },
      radius: 3 + Math.sqrt(nodeIds.length) * 0.4, // per §6.2
      nodeIds,
    });
  }

  // Sort by nodeCount descending — densest clusters first (§6.2)
  clusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length);

  return clusters;
}

/**
 * Compute a deterministic SHA-256 hex digest of a sorted node+edge list.
 *
 * Used as the layout cache key (02-TSD.md §5.4, LayoutCacheEntry.graphHash).
 * The hash changes when nodes or edges change, triggering a re-layout.
 * Same data always produces the same hash (deterministic).
 *
 * Sorting ensures that API response order doesn't affect the hash.
 *
 * @param {Array<object>} nodes — Normalized GraphNode array
 * @param {Array<object>} edges — Normalized GraphEdge array
 * @returns {Promise<string>} Hex-encoded SHA-256 digest
 */
async function computeGraphHash(nodes, edges) {
  if (!Array.isArray(nodes)) nodes = [];
  if (!Array.isArray(edges)) edges = [];

  // Build a canonical representation: sort by stable key, then stringify
  const canonicalNodes = [...nodes]
    .map((n) => ({
      id: n.id,
      path: n.path,
      type: n.type,
      size: n.size ?? 0,
      importance: n.importance ?? 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const canonicalEdges = [...edges]
    .map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight ?? 1,
    }))
    .sort((a, b) => {
      const srcCmp = a.source.localeCompare(b.source);
      if (srcCmp !== 0) return srcCmp;
      const tgtCmp = a.target.localeCompare(b.target);
      if (tgtCmp !== 0) return tgtCmp;
      return a.type.localeCompare(b.type);
    });

  // Build a single JSON payload and hash it
  const payload = JSON.stringify({
    nodes: canonicalNodes,
    edges: canonicalEdges,
    version: 1, // Bump to invalidate all cached layouts
  });

  // Use the Web Crypto API (available in modern browsers and Node 18+)
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert ArrayBuffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Exports ────────────────────────────────────────────────────────────

export {
  normalizeNodes,
  normalizeEdges,
  extractClusters,
  computeGraphHash,
  // Exposed for testing
  pathToClusterId,
  clusterDepth,
  clusterLabel,
  simulateChangeFrequency,
};
