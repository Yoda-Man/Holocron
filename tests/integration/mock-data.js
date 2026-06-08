/**
 * mock-data.js — Shared Graphify API Mock Fixtures
 *
 * Provides deterministic mock responses for all Graphify API endpoints.
 * Used by graphify.test.js to simulate both happy-path and error scenarios.
 *
 * Response shapes match 05-YodaMan-Integration.md §3 and 02-TSD.md §5.
 *
 * @see 05-YodaMan-Integration.md §3.1 — Status response
 * @see 05-YodaMan-Integration.md §3.2 — Map response format
 * @see 05-YodaMan-Integration.md §3.3 — Query / Affected bodies
 * @see 02-TSD.md §5.1 — GraphNode schema
 * @see 02-TSD.md §5.2 — GraphEdge schema
 */

// ─── Sample Workspaces ──────────────────────────────────────────────────
const WORKSPACES = {
  VALID: '/Users/dev/my-project',
  EMPTY: '/Users/dev/empty-project',
  NOT_FOUND: '/Users/dev/nonexistent',
  UNICODE: '/Users/dev/컴포넌트-project',
};

// ─── Mock Graph: 8 nodes, 7 edges — a small auth module ─────────────────
const MOCK_NODES = [
  {
    id: 'src/auth/AuthService.dart',
    path: 'src/auth/AuthService.dart',
    label: 'AuthService',
    type: 'file',
    language: 'dart',
    size: 847,
    importance: 12,
    changeFrequency: 5,
    recentlyChanged: true,
  },
  {
    id: 'src/models/User.dart',
    path: 'src/models/User.dart',
    label: 'User',
    type: 'file',
    language: 'dart',
    size: 120,
    importance: 8,
    changeFrequency: 3,
    recentlyChanged: false,
  },
  {
    id: 'src/auth/LoginController.dart',
    path: 'src/auth/LoginController.dart',
    label: 'LoginController',
    type: 'file',
    language: 'dart',
    size: 310,
    importance: 9,
    changeFrequency: 7,
    recentlyChanged: true,
  },
  {
    id: 'src/auth/AuthMiddleware.dart',
    path: 'src/auth/AuthMiddleware.dart',
    label: 'AuthMiddleware',
    type: 'file',
    language: 'dart',
    size: 215,
    importance: 6,
    changeFrequency: 2,
    recentlyChanged: false,
  },
  {
    id: 'src/models/Session.dart',
    path: 'src/models/Session.dart',
    label: 'Session',
    type: 'file',
    language: 'dart',
    size: 89,
    importance: 5,
    changeFrequency: 4,
    recentlyChanged: true,
  },
  {
    id: 'src/utils/TokenManager.dart',
    path: 'src/utils/TokenManager.dart',
    label: 'TokenManager',
    type: 'file',
    language: 'dart',
    size: 430,
    importance: 7,
    changeFrequency: 6,
    recentlyChanged: true,
  },
  {
    id: 'src/config/api_config.yaml',
    path: 'src/config/api_config.yaml',
    label: 'api_config',
    type: 'file',
    language: 'yaml',
    size: 45,
    importance: 3,
    changeFrequency: 1,
    recentlyChanged: false,
  },
  {
    id: 'src/auth',
    path: 'src/auth',
    label: 'auth',
    type: 'folder',
    language: '',
    size: 0,
    importance: 15,
    changeFrequency: 0,
    recentlyChanged: false,
  },
];

const MOCK_EDGES = [
  { source: 'src/auth/AuthService.dart', target: 'src/models/User.dart', type: 'import', weight: 1 },
  { source: 'src/auth/AuthService.dart', target: 'src/utils/TokenManager.dart', type: 'import', weight: 1 },
  { source: 'src/auth/AuthService.dart', target: 'src/models/Session.dart', type: 'import', weight: 1 },
  { source: 'src/auth/LoginController.dart', target: 'src/auth/AuthService.dart', type: 'call', weight: 3 },
  { source: 'src/auth/LoginController.dart', target: 'src/models/User.dart', type: 'import', weight: 1 },
  { source: 'src/auth/AuthMiddleware.dart', target: 'src/auth/AuthService.dart', type: 'call', weight: 2 },
  { source: 'src/utils/TokenManager.dart', target: 'src/config/api_config.yaml', type: 'import', weight: 1 },
];

const GRAPH_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// ─── Mock Response Builders ─────────────────────────────────────────────

function buildStatusResponse(workspacePath) {
  if (workspacePath === WORKSPACES.VALID) {
    return {
      available: true,
      graphHash: GRAPH_HASH,
      stale: false,
    };
  }
  if (workspacePath === WORKSPACES.EMPTY) {
    return {
      available: true,
      graphHash: 'e5f6a1b2c3d4e5f6a1b2c3d4',
      stale: false,
    };
  }
  // Not found / unindexed
  return {
    available: false,
    graphHash: null,
    stale: false,
  };
}

function buildMapResponse(workspacePath, limit) {
  if (workspacePath === WORKSPACES.VALID) {
    // Nodes must be returned sorted by importance descending —
    // the plugin relies on this for the "top N by importance" cap.
    const sorted = [...MOCK_NODES].sort((a, b) => b.importance - a.importance);
    return {
      nodes: sorted.slice(0, limit ?? sorted.length),
      edges: MOCK_EDGES,
    };
  }
  if (workspacePath === WORKSPACES.EMPTY) {
    return { nodes: [], edges: [] };
  }
  // Not found — the endpoint still returns 200 with empty data
  return { nodes: [], edges: [] };
}

function buildQueryResponse(workspacePath, query) {
  // Natural-language query: find files similar to the given node
  if (query.includes('AuthService') || query.includes('similar to')) {
    return {
      matches: [
        {
          node: MOCK_NODES[0], // AuthService
          score: 1.0,
        },
        {
          node: MOCK_NODES[2], // LoginController
          score: 0.85,
          reason: 'Shares module prefix src/auth/ and has call dependency',
        },
        {
          node: MOCK_NODES[3], // AuthMiddleware
          score: 0.72,
          reason: 'Shares module prefix src/auth/ and has call dependency',
        },
      ],
    };
  }
  if (query.includes('Login')) {
    return {
      matches: [
        { node: MOCK_NODES[2], score: 1.0 },
        { node: MOCK_NODES[0], score: 0.65, reason: 'AuthService is called by LoginController' },
      ],
    };
  }
  // No matches
  return { matches: [] };
}

function buildAffectedResponse(workspacePath, nodeId, depth) {
  // Dependency chain for AuthService (incoming + outgoing, up to depth)
  if (nodeId === 'src/auth/AuthService.dart') {
    const chain = depth >= 1
      ? [
          { source: 'src/auth/LoginController.dart', target: 'src/auth/AuthService.dart', type: 'call', weight: 3 },
          { source: 'src/auth/AuthMiddleware.dart', target: 'src/auth/AuthService.dart', type: 'call', weight: 2 },
        ]
      : [];

    const deeper = depth >= 2
      ? [
          { source: 'src/auth/AuthService.dart', target: 'src/models/User.dart', type: 'import', weight: 1 },
          { source: 'src/auth/AuthService.dart', target: 'src/utils/TokenManager.dart', type: 'import', weight: 1 },
          { source: 'src/auth/AuthService.dart', target: 'src/models/Session.dart', type: 'import', weight: 1 },
        ]
      : [];

    const allEdges = [...chain, ...deeper];
    // Collect unique affected node IDs from the edge list, up to depth
    const nodeSet = new Set(
      allEdges.map((e) => (e.target === nodeId ? e.source : e.target))
    );

    return {
      node: nodeId,
      depth,
      edges: allEdges,
      affectedNodes: [...nodeSet].slice(0, depth === 1 ? 2 : 5),
    };
  }

  if (nodeId === 'src/auth/LoginController.dart') {
    return {
      node: nodeId,
      depth,
      edges: [
        { source: nodeId, target: 'src/auth/AuthService.dart', type: 'call', weight: 3 },
        { source: nodeId, target: 'src/models/User.dart', type: 'import', weight: 1 },
      ],
      affectedNodes: ['src/auth/AuthService.dart', 'src/models/User.dart'],
    };
  }

  // Unknown node
  return {
    node: nodeId,
    depth,
    edges: [],
    affectedNodes: [],
  };
}

function buildExplainResponse(workspacePath, nodeId) {
  // Find the matching node
  const node = MOCK_NODES.find((n) => n.id === nodeId);
  if (!node) {
    return {
      error: `Node not found: ${nodeId}`,
    };
  }

  const incoming = MOCK_EDGES.filter((e) => e.target === nodeId);
  const outgoing = MOCK_EDGES.filter((e) => e.source === nodeId);

  return {
    summary: {
      id: node.id,
      path: node.path,
      label: node.label,
      type: node.type,
      language: node.language,
      size: node.size,
      importance: node.importance,
      changeFrequency: node.changeFrequency,
      incomingDependencies: incoming.length,
      outgoingDependencies: outgoing.length,
    },
    dependencies: {
      incoming: incoming.map((e) => ({ source: e.source, type: e.type, weight: e.weight })),
      outgoing: outgoing.map((e) => ({ target: e.target, type: e.type, weight: e.weight })),
    },
    recentActivity: node.recentlyChanged ? 'Modified in last 7 days' : 'No recent changes',
  };
}

// ─── Route Registration Helper ──────────────────────────────────────────

/**
 * Register Playwright route handlers that intercept all graphify API calls
 * and return deterministic mock responses.
 *
 * Each `page.route()` handler matches a specific URL pattern and delegates
 * to the builder functions above, so tests get predictable data without
 * a running YodaMan backend.
 *
 * Usage in tests:
 *   import { registerMockRoutes } from './mock-data.js';
 *   await registerMockRoutes(page);
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [overrides] — Optional response overrides per endpoint
 */
async function registerMockRoutes(page, overrides = {}) {
  // ── /api/graphify/status ───────────────────────────────────────────
  await page.route('**/api/graphify/status**', async (route) => {
    const url = new URL(route.request().url());
    const workspacePath = url.searchParams.get('path') || '';
    const response = overrides.status ?? buildStatusResponse(workspacePath);

    await route.fulfill({
      status: overrides.statusCode ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // ── /api/graphify/map ──────────────────────────────────────────────
  await page.route('**/api/graphify/map**', async (route) => {
    const url = new URL(route.request().url());
    const workspacePath = url.searchParams.get('path') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5000', 10);
    const response = overrides.map ?? buildMapResponse(workspacePath, limit);

    await route.fulfill({
      status: overrides.mapStatusCode ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // ── /api/graphify/query (POST only) ────────────────────────────────
  await page.route('**/api/graphify/query', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Method not allowed', allowedMethods: ['POST'] }),
      });
      return;
    }
    const body = JSON.parse(route.request().postData() || '{}');
    const response = overrides.query ?? buildQueryResponse(body.path, body.query || '');

    await route.fulfill({
      status: overrides.queryStatusCode ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // ── /api/graphify/affected (POST) ──────────────────────────────────
  await page.route('**/api/graphify/affected', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() || '{}');
    const response = overrides.affected ??
      buildAffectedResponse(body.path, body.node, body.depth ?? 3);

    await route.fulfill({
      status: overrides.affectedStatusCode ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // ── /api/graphify/explain (POST) ───────────────────────────────────
  await page.route('**/api/graphify/explain', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() || '{}');
    const response = overrides.explain ?? buildExplainResponse(body.path, body.node || '');

    await route.fulfill({
      status: overrides.explainStatusCode ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

export {
  WORKSPACES,
  MOCK_NODES,
  MOCK_EDGES,
  GRAPH_HASH,
  buildStatusResponse,
  buildMapResponse,
  buildQueryResponse,
  buildAffectedResponse,
  buildExplainResponse,
  registerMockRoutes,
};
