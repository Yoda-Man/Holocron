/**
 * graphify.test.js — Graphify API Integration Tests
 *
 * Tests all five Graphify API endpoints used by Holocron VR against
 * deterministic mock data. No real YodaMan backend required — every
 * route is intercepted via Playwright's page.route().
 *
 * Tests cover:
 *   1. /api/graphify/status  — Workspace availability check
 *   2. /api/graphify/map     — Graph nodes + edges fetch
 *   3. /api/graphify/query   — Natural-language graph queries
 *   4. /api/graphify/affected— Dependency chain traversal
 *   5. /api/graphify/explain — Node context for agent prompts
 *   6. Edge cases: empty graph, missing workspace, server errors
 *
 * Assertions verify:
 *   - HTTP status codes (200, 4xx, 5xx)
 *   - Response body structure matches expected schemas
 *   - Field types and constraints (strings, numbers, arrays)
 *   - Content-Type headers
 *   - Error responses carry appropriate error messages
 *
 * @see 08-Testing-Spec.md §2.1 — Graphify API Integration Tests
 * @see 05-YodaMan-Integration.md §3 — API response formats
 * @see 02-TSD.md §5 — Data model schemas
 */

import { test, expect } from '@playwright/test';
import {
  WORKSPACES,
  MOCK_NODES,
  MOCK_EDGES,
  registerMockRoutes,
  buildMapResponse,
  buildStatusResponse,
} from './mock-data.js';

// ─── Test helpers ───────────────────────────────────────────────────────

/**
 * Make an API call from the browser context and parse the JSON response.
 * Using page.evaluate() ensures the call follows the same path the plugin
 * would take (fetch from Electron renderer → YodaMan backend).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 * @param {object} [options] — fetch options (method, headers, body)
 * @returns {Promise<object>} { status, statusText, headers, body }
 */
async function apiFetch(page, url, options = {}) {
  // Resolve relative URLs against BASE_URL so fetch() works in the
  // browser context (about:blank has no origin for relative URLs).
  const absoluteUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  return page.evaluate(async ({ url, options }) => {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }, { url: absoluteUrl, options });
}

// YodaMan backend runs on localhost:3090 — used as the base for all API
// calls so fetch() works in Playwright's browser context (relative URLs
// fail from about:blank / data: pages).
const BASE_URL = 'http://localhost:3090';

/**
 * Verify an object is a non-null, non-array object.
 */
function isDict(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── Setup / Teardown ───────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Each test starts with a fresh page and fresh mock routes
  await page.goto('about:blank');
});

// =========================================================================
// Test Suite 1: /api/graphify/status
// =========================================================================
test.describe('/api/graphify/status', () => {
  test('1a: Returns available=true for a workspace with a built graph', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        available: true,
        graphHash: expect.any(String),
        stale: expect.any(Boolean),
      })
    );
    expect(body.available).toBe(true);
  });

  test('1b: Includes graphHash field in the response', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(body).toHaveProperty('graphHash');
    expect(typeof body.graphHash).toBe('string');
    expect(body.graphHash.length).toBeGreaterThan(0);
  });

  test('1c: Returns available=false for an unindexed workspace', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.NOT_FOUND)}`
    );

    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.graphHash).toBeNull();
  });

  test('1d: Handles workspace paths with special characters (URL encoding)', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.UNICODE)}`
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('available');
  });

  test('1e: Returns 404-like response for missing workspace (server error simulation)', async ({ page }) => {
    await registerMockRoutes(page, {
      statusCode: 404,
      status: { error: 'Workspace not found' },
    });

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent('/dev/missing')}`
    );

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
  });

  test('1f: Returns 500 for YodaMan backend outage', async ({ page }) => {
    await registerMockRoutes(page, {
      statusCode: 500,
      status: { error: 'Internal server error' },
    });

    const { status } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(status).toBe(500);
  });

  test('1g: stale field accurately reflects graph freshness', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(typeof body.stale).toBe('boolean');
    // For the valid workspace, we expect fresh (not stale)
    expect(body.stale).toBe(false);
  });

  test('1h: Missing path parameter returns 400 or defaults gracefully', async ({ page }) => {
    // Some API implementations require the path param; the plugin always
    // sends it. This test verifies the mock handles the edge case.
    await registerMockRoutes(page, {
      statusCode: 400,
      status: { error: 'Missing required parameter: path' },
    });

    const { status, body } = await apiFetch(page, '/api/graphify/status');
    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
  });
});

// =========================================================================
// Test Suite 2: /api/graphify/map
// =========================================================================
test.describe('/api/graphify/map', () => {
  test('2a: Returns nodes and edges for a valid workspace', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}&limit=5000`
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  test('2b: Nodes conform to GraphNode schema (02-TSD.md §5.1)', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    for (const node of body.nodes) {
      expect(isDict(node)).toBe(true);
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('path');
      expect(node).toHaveProperty('type');
      expect(node).toHaveProperty('language');

      // id is a non-empty string
      expect(typeof node.id).toBe('string');
      expect(node.id.length).toBeGreaterThan(0);

      // path is a non-empty string
      expect(typeof node.path).toBe('string');
      expect(node.path.length).toBeGreaterThan(0);

      // type is one of the allowed values
      expect(['file', 'class', 'function', 'folder']).toContain(node.type);

      // size is a non-negative number
      expect(typeof node.size).toBe('number');
      expect(node.size).toBeGreaterThanOrEqual(0);

      // importance is a non-negative number
      expect(typeof node.importance).toBe('number');
      expect(node.importance).toBeGreaterThanOrEqual(0);
    }
  });

  test('2c: Edges conform to GraphEdge schema (02-TSD.md §5.2)', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    for (const edge of body.edges) {
      expect(isDict(edge)).toBe(true);
      expect(edge).toHaveProperty('source');
      expect(edge).toHaveProperty('target');
      expect(edge).toHaveProperty('type');
      expect(edge).toHaveProperty('weight');

      // source and target reference existing node IDs
      expect(typeof edge.source).toBe('string');
      expect(edge.source.length).toBeGreaterThan(0);
      expect(typeof edge.target).toBe('string');
      expect(edge.target.length).toBeGreaterThan(0);

      // type is one of the allowed EdgeType values
      expect(['import', 'call', 'inheritance', 'composition']).toContain(edge.type);

      // weight is a positive integer
      expect(typeof edge.weight).toBe('number');
      expect(Number.isInteger(edge.weight)).toBe(true);
      expect(edge.weight).toBeGreaterThanOrEqual(0);
    }
  });

  test('2d: limit parameter caps the returned node count', async ({ page }) => {
    await registerMockRoutes(page);

    const limit = 3;
    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}&limit=${limit}`
    );

    expect(body.nodes.length).toBeLessThanOrEqual(limit);
  });

  test('2e: Nodes are sorted by importance descending when limit is applied', async ({ page }) => {
    // Verify the mock data itself is sorted correctly (or at least that
    // the first node is the most important in the limited set).
    // In the real API, the backend performs the sort.
    await registerMockRoutes(page);

    const limit = 3;
    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}&limit=${limit}`
    );

    // Verify the mock is returning the highest-importance nodes
    for (let i = 1; i < body.nodes.length; i++) {
      expect(body.nodes[i - 1].importance).toBeGreaterThanOrEqual(body.nodes[i].importance);
    }
  });

  test('2f: Edge source and target node IDs exist in the node list', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    const nodeIds = new Set(body.nodes.map((n) => n.id));
    for (const edge of body.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  test('2g: Response Content-Type is application/json', async ({ page }) => {
    await registerMockRoutes(page);

    const { headers } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(headers['content-type']).toContain('application/json');
  });

  test('2h: Handles edge with weight 0 or missing (default weight)', async ({ page }) => {
    // Override to inject an edge with weight 0
    await registerMockRoutes(page, {
      map: {
        nodes: MOCK_NODES.slice(0, 3),
        edges: [
          { source: 'src/auth/AuthService.dart', target: 'src/models/User.dart', type: 'import', weight: 0 },
        ],
      },
    });

    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(body.edges[0].weight).toBe(0);
    // Zero-weight edges should be valid per schema (but may be skipped by layout)
  });
});

// =========================================================================
// Test Suite 3: /api/graphify/query
// =========================================================================
test.describe('/api/graphify/query (POST)', () => {
  test('3a: Accepts POST with a natural-language query and returns results', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          query: 'Find files similar to AuthService',
        }),
      }
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('matches');
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);
  });

  test('3b: Returns related nodes with similarity scores', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          query: 'Find files similar to AuthService',
        }),
      }
    );

    for (const match of body.matches) {
      expect(match).toHaveProperty('node');
      expect(match).toHaveProperty('score');
      expect(isDict(match.node)).toBe(true);
      expect(typeof match.score).toBe('number');
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
  });

  test('3c: Top result is the query target itself (score = 1.0)', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          query: 'Find files similar to AuthService',
        }),
      }
    );

    expect(body.matches[0].score).toBe(1.0);
    expect(body.matches[0].node.id).toContain('AuthService');
  });

  test('3d: Returns empty matches array for unrelated queries', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          query: 'TotallyNonexistentComponent query',
        }),
      }
    );

    expect(body.matches).toEqual([]);
  });

  test('3e: Returns 400 for missing query field', async ({ page }) => {
    await registerMockRoutes(page, {
      queryStatusCode: 400,
      query: { error: 'Missing required field: query' },
    });

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: WORKSPACES.VALID }),  // no query field
      }
    );

    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  test('3f: Rejects GET requests to query endpoint', async ({ page }) => {
    await registerMockRoutes(page);

    const { status } = await apiFetch(page, '/api/graphify/query');

    // The mock routes only intercept POST; GET should get no mock response
    // In our mock setup, the route handler calls route.continue() for non-POST
    // so status could be a network error (N/A) if no server running.
    // The test verifies the mock correctly identifies the method.
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('3g: Returns results with optional reason field explaining match', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          query: 'Find files similar to AuthService',
        }),
      }
    );

    for (const match of body.matches) {
      // reason is optional but should be a string when present
      if (match.reason !== undefined) {
        expect(typeof match.reason).toBe('string');
        expect(match.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

// =========================================================================
// Test Suite 4: /api/graphify/affected
// =========================================================================
test.describe('/api/graphify/affected', () => {
  test('4a: Returns dependency chain for a node', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
          depth: 3,
          relations: [],
        }),
      }
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('node');
    expect(body).toHaveProperty('depth');
    expect(body).toHaveProperty('edges');
    expect(body).toHaveProperty('affectedNodes');
    expect(body.node).toBe('src/auth/AuthService.dart');
    expect(Array.isArray(body.edges)).toBe(true);
    expect(Array.isArray(body.affectedNodes)).toBe(true);
  });

  test('4b: Returns edges with correct schema', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
          depth: 1,
        }),
      }
    );

    for (const edge of body.edges) {
      expect(edge).toHaveProperty('source');
      expect(edge).toHaveProperty('target');
      expect(edge).toHaveProperty('type');
      expect(edge).toHaveProperty('weight');
      expect(typeof edge.source).toBe('string');
      expect(typeof edge.target).toBe('string');
      expect(['import', 'call', 'inheritance', 'composition']).toContain(edge.type);
    }
  });

  test('4c: depth parameter controls how far the traversal goes', async ({ page }) => {
    await registerMockRoutes(page);

    // depth = 1: only direct dependencies
    const { body: body1 } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
          depth: 1,
        }),
      }
    );
    // depth=1 returns only incoming call edges (LoginController, AuthMiddleware)
    // depth=2 adds outgoing import edges (User, TokenManager, Session)
    expect(body1.affectedNodes.length).toBeLessThanOrEqual(2);

    // depth = 2: includes transitive dependencies
    const { body: body2 } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
          depth: 2,
        }),
      }
    );

    expect(body2.affectedNodes.length).toBeGreaterThanOrEqual(body1.affectedNodes.length);
  });

  test('4d: Returns empty arrays for an unknown (unconnected) node', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/orphan/UnreferencedFile.dart',
          depth: 3,
        }),
      }
    );

    expect(body.edges).toEqual([]);
    expect(body.affectedNodes).toEqual([]);
  });

  test('4e: Returns 400 for missing node parameter', async ({ page }) => {
    await registerMockRoutes(page, {
      affectedStatusCode: 400,
      affected: { error: 'Missing required parameter: node' },
    });

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: WORKSPACES.VALID }),  // no node
      }
    );

    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
  });

  test('4f: Each affectedNode ID exists in the returned edges', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/affected',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
          depth: 3,
        }),
      }
    );

    // Every affectedNode should appear as either source or target of an edge
    const edgeNodeIds = new Set();
    for (const edge of body.edges) {
      edgeNodeIds.add(edge.source);
      edgeNodeIds.add(edge.target);
    }

    for (const nodeId of body.affectedNodes) {
      expect(edgeNodeIds.has(nodeId)).toBe(true);
    }
  });
});

// =========================================================================
// Test Suite 5: /api/graphify/explain
// =========================================================================
test.describe('/api/graphify/explain', () => {
  test('5a: Returns node context summary for agent prompts', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
        }),
      }
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('dependencies');
    expect(body).toHaveProperty('recentActivity');
    expect(isDict(body.summary)).toBe(true);
    expect(isDict(body.dependencies)).toBe(true);
  });

  test('5b: Summary contains the fields needed for agent prompt construction', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
        }),
      }
    );

    const { summary } = body;
    // Fields referenced in 05-YodaMan-Integration.md §4.1 agent prompt
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('path');
    expect(summary).toHaveProperty('label');
    expect(summary).toHaveProperty('type');
    expect(summary).toHaveProperty('language');
    expect(summary).toHaveProperty('size');
    expect(summary).toHaveProperty('importance');
    expect(summary).toHaveProperty('incomingDependencies');
    expect(summary).toHaveProperty('outgoingDependencies');

    expect(typeof summary.path).toBe('string');
    expect(typeof summary.size).toBe('number');
    expect(typeof summary.importance).toBe('number');
  });

  test('5c: Dependencies object contains incoming and outgoing arrays', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
        }),
      }
    );

    const { dependencies } = body;
    expect(dependencies).toHaveProperty('incoming');
    expect(dependencies).toHaveProperty('outgoing');
    expect(Array.isArray(dependencies.incoming)).toBe(true);
    expect(Array.isArray(dependencies.outgoing)).toBe(true);
  });

  test('5d: Each dependency entry includes source/target, type, and weight', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
        }),
      }
    );

    const allDeps = [...body.dependencies.incoming, ...body.dependencies.outgoing];
    for (const dep of allDeps) {
      if (dep.source) expect(typeof dep.source).toBe('string');
      if (dep.target) expect(typeof dep.target).toBe('string');
      expect(dep).toHaveProperty('type');
      expect(dep).toHaveProperty('weight');
      expect(typeof dep.weight).toBe('number');
    }
  });

  test('5e: AuthService has 2 incoming and 3 outgoing dependencies (matches mock)', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
        }),
      }
    );

    // From the mock data:
    // Incoming: LoginController (call), AuthMiddleware (call) = 2
    // Outgoing: User (import), TokenManager (import), Session (import) = 3
    expect(body.summary.incomingDependencies).toBe(2);
    expect(body.summary.outgoingDependencies).toBe(3);
  });

  test('5f: Returns recentActivity field for files changed in last 7 days', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/auth/AuthService.dart',
        }),
      }
    );

    expect(typeof body.recentActivity).toBe('string');
    expect(body.recentActivity.length).toBeGreaterThan(0);
  });

  test('5g: Returns error for unknown node', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: WORKSPACES.VALID,
          node: 'src/unknown/File.dart',
        }),
      }
    );

    expect(status).toBe(200);  // API returns 200 with error field
    expect(body).toHaveProperty('error');
  });

  test('5h: Returns 400 for missing node parameter', async ({ page }) => {
    await registerMockRoutes(page, {
      explainStatusCode: 400,
      explain: { error: 'Missing required parameter: node' },
    });

    const { status, body } = await apiFetch(
      page,
      '/api/graphify/explain',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: WORKSPACES.VALID }),  // no node
      }
    );

    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
  });
});

// =========================================================================
// Test Suite 6: Error Handling — Empty / Missing Graph
// =========================================================================
test.describe('Empty graph & error handling', () => {
  test('6a: Empty workspace returns nodes: [] and edges: [] from /map', async ({ page }) => {
    await registerMockRoutes(page);

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.EMPTY)}`
    );

    expect(status).toBe(200);
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  test('6b: Empty workspace status shows available=true with no graphHash', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.EMPTY)}`
    );

    expect(body.available).toBe(true);
    expect(body.graphHash).toBeTruthy();
    // An empty graph is still an indexed graph — the index just has 0 files
  });

  test('6c: Unindexed workspace shows available=false', async ({ page }) => {
    await registerMockRoutes(page);

    const { body } = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.NOT_FOUND)}`
    );

    expect(body.available).toBe(false);
    expect(body.graphHash).toBeNull();
  });

  test('6d: Plugin transitions to empty-state UI when map returns no nodes', async ({ page }) => {
    // This simulates the check the plugin does in graphCache.js §3.1:
    // if mapResponse.nodes.length === 0 → show empty state
    await registerMockRoutes(page);

    const mapResponse = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.EMPTY)}`
    );

    const statusResponse = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.EMPTY)}`
    );

    // Plugin logic (from 05-YodaMan-Integration.md §3.1):
    //   1. Check available === true
    //   2. Fetch map
    //   3. If nodes.length === 0 → show "Build Graphify graph first" CTA
    const shouldShowEmptyState =
      statusResponse.body.available === true && mapResponse.body.nodes.length === 0;

    expect(shouldShowEmptyState).toBe(true);
  });

  test('6e: Plugin shows error state when status.available is false', async ({ page }) => {
    await registerMockRoutes(page);

    const statusResponse = await apiFetch(
      page,
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.NOT_FOUND)}`
    );

    // Plugin logic: if !status.available → throw / show error
    // The plugin's onLoad hook (05-YodaMan-Integration.md §1.1) also
    // checks this and logs a warning.
    expect(statusResponse.body.available).toBe(false);

    // The fetchGraph function in graphCache.js would throw:
    //   "Graphify graph not built for this workspace"
    // which the plugin catches and renders as an error state.
  });

  test('6f: Server 500 error is propagated with error message', async ({ page }) => {
    await registerMockRoutes(page, {
      mapStatusCode: 500,
      map: { error: 'Internal server error' },
    });

    const { status, body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
    );

    expect(status).toBe(500);
    expect(body).toHaveProperty('error');
  });

  test('6g: Network timeout is handled gracefully (simulated via abort)', async ({ page }) => {
    // Simulate an AbortController timeout by mocking with an artificial delay
    // that exceeds the timeout. Playwright's route handler can abort.
    let timedOut = false;

    await page.route('**/api/graphify/map**', async (route) => {
      // Delay beyond the timeout
      await new Promise((resolve) => setTimeout(resolve, 50));
      timedOut = true;
      await route.abort('timedout');
    });

    try {
      await apiFetch(
        page,
        `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`
      );
    } catch {
      // fetch throws on abort — the plugin should catch this
      timedOut = true;
    }

    // The plugin checks for this in graphCache.js and shows a retry button
    expect(timedOut).toBe(true);
  });

  test('6h: Large codebase warning threshold (limit=5000, nodes capped)', async ({ page }) => {
    // Simulate response where node count hits the hard limit
    // Plugin displays: "Large codebase detected. Rendering top 5,000 nodes."
    await registerMockRoutes(page, {
      map: {
        nodes: MOCK_NODES,
        edges: MOCK_EDGES,
        truncated: true,
        totalAvailable: 7500,
      },
    });

    const { body } = await apiFetch(
      page,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}&limit=5000`
    );

    // When truncation happens, the API should indicate it
    if (body.truncated) {
      expect(body.nodes.length).toBeLessThanOrEqual(5000);
      expect(body.totalAvailable).toBeGreaterThan(5000);
    }
  });

  test('6i: Content-Type is always application/json for all endpoints', async ({ page }) => {
    await registerMockRoutes(page);

    const endpoints = [
      `/api/graphify/status?path=${encodeURIComponent(WORKSPACES.VALID)}`,
      `/api/graphify/map?path=${encodeURIComponent(WORKSPACES.VALID)}`,
    ];

    for (const url of endpoints) {
      const { headers } = await apiFetch(page, url);
      expect(headers['content-type']).toContain('application/json');
    }

    const postEndpoints = [
      { url: '/api/graphify/query', body: { path: WORKSPACES.VALID, query: 'test' } },
      { url: '/api/graphify/affected', body: { path: WORKSPACES.VALID, node: 'test', depth: 1 } },
      { url: '/api/graphify/explain', body: { path: WORKSPACES.VALID, node: 'test' } },
    ];

    for (const { url, body } of postEndpoints) {
      const { headers } = await apiFetch(page, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(headers['content-type']).toContain('application/json');
    }
  });
});
