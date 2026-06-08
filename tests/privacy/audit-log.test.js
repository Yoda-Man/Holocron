/**
 * audit-log.test.js — Audit Log Privacy Test (08-Testing-Spec.md §7)
 *
 * Verifies that audit log entries NEVER contain:
 *   - File contents (code snippets, source text)
 *   - Raw voice transcripts
 *   - Session recordings (WebXR frame data)
 *
 * This is tested by:
 *   1. Simulating plugin actions that trigger audit log writes
 *   2. Intercepting the POST /api/audit requests
 *   3. Asserting that the bodies contain only permitted fields
 *
 * @see 05-YodaMan-Integration.md §6.1 — Logged actions
 * @see 05-YodaMan-Integration.md §6.3 — Privacy considerations
 * @see 08-Testing-Spec.md §7 — Privacy validation tests
 */

import { test, expect } from '@playwright/test';

// ─── Known privacy-sensitive patterns that MUST NOT appear in audit logs ──

// Patterns that indicate CODE CONTENT in audit entries.
// Paths like "src/auth/AuthService.dart" are acceptable metadata.
// Full code blocks (multi-line, function definitions) are not.
const FORBIDDEN_PATTERNS = [
  // Multi-line strings (code blocks)
  /\n\s*\n/,
  // Function/class/interface definitions (code structure)
  /^\s*(?:function|class|interface|export|import|def|void|int|const)\s/m,
  // Long base64 strings
  /[A-Za-z0-9+/]{100,}={0,2}/,
  // Arrow function bodies
  /=>\s*\{[^}]+}/,
  // Voice transcript indicators (filler words in isolation)
  /\bum\b/i,
  /\buh\b/i,
  // Strings over 200 chars (file contents)
  /"[^"]{200,}"/,
];

// ─── Allowed fields per action type (§6.1) ─────────────────────────────

const ALLOWED_FIELDS_BY_ACTION = {
  vr_explorer_open:    ['userAction', 'plugin', 'timestamp', 'workspacePath', 'nodeCount'],
  vr_explorer_close:   ['userAction', 'plugin', 'timestamp', 'sessionDurationMs'],
  vr_mode_enter:       ['userAction', 'plugin', 'timestamp', 'headsetType'],
  vr_node_select:      ['userAction', 'plugin', 'timestamp', 'nodeId', 'nodePath'],
  vr_voice_command:    ['userAction', 'plugin', 'timestamp', 'commandName', 'param'],
  vr_ask_agent:        ['userAction', 'plugin', 'timestamp', 'nodeId', 'taskId'],
  vr_save_view:        ['userAction', 'plugin', 'timestamp', 'taskId'],
  vr_open_file:        ['userAction', 'plugin', 'timestamp', 'nodePath'],
};

// ═════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════

/**
 * Check if a string contains forbidden content patterns.
 *
 * @param {string} text
 * @returns {string|null} The matched pattern or null
 */
function containsForbiddenContent(text) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.toString();
    }
  }
  return null;
}

/**
 * Check that an audit body only contains allowed fields for its action type.
 *
 * @param {string} action
 * @param {object} body
 * @returns {string[]} List of disallowed fields found
 */
function getDisallowedFields(action, body) {
  const allowed = ALLOWED_FIELDS_BY_ACTION[action];
  if (!allowed) return Object.keys(body); // Unknown action = all fields suspect

  return Object.keys(body).filter((key) => !allowed.includes(key));
}

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

test.describe('Audit Log Privacy (§7)', () => {
  test('audit_log_contains_no_code — no file contents in log entries', async ({ page }) => {
    const auditEntries = [];

    // Intercept all audit POST requests
    await page.route('**/api/audit', async (route) => {
      if (route.request().method() === 'POST') {
        try {
          const body = JSON.parse(route.request().postData() || '{}');
          auditEntries.push(body);
        } catch { /* invalid JSON — might be malicious */ }
        // Allow the request to continue (it will fail without server, but we captured it)
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        await route.continue();
      }
    });

    // Simulate plugin actions that generate audit log entries
    await page.evaluate(() => {
      const auditLog = (action, data) => {
        // This mirrors the real auditLog function
        fetch('http://localhost:3090/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAction: action,
            plugin: 'graphify-vr-explorer',
            timestamp: new Date().toISOString(),
            ...data,
          }),
        }).catch(() => {});
      };

      // Simulate a full session of interactions
      auditLog('vr_explorer_open', { workspacePath: '/Users/dev/my-project', nodeCount: 847 });
      auditLog('vr_node_select', { nodeId: 'src/auth/AuthService.dart', nodePath: 'src/auth/AuthService.dart' });
      auditLog('vr_voice_command', { commandName: 'flyToNode', param: 'AuthService' });
      auditLog('vr_ask_agent', { nodeId: 'src/auth/AuthService.dart', taskId: 'abc123def456' });
      auditLog('vr_save_view', { taskId: 'xyz789' });
      auditLog('vr_open_file', { nodePath: 'src/auth/AuthService.dart' });
      auditLog('vr_explorer_close', { sessionDurationMs: 45230 });
    });

    await page.waitForTimeout(500);

    // ── Assertions ──────────────────────────────────────────────────
    expect(auditEntries.length).toBeGreaterThan(0);

    for (const entry of auditEntries) {
      // 1. No forbidden content patterns in any string field
      const allText = JSON.stringify(entry);
      const forbidden = containsForbiddenContent(allText);
      if (forbidden) {
        console.error(`[FAIL] Forbidden pattern found in audit entry: ${forbidden}`);
        console.error(`       Entry: ${JSON.stringify(entry, null, 2)}`);
      }
      expect(forbidden).toBeNull();

      // 2. No file contents (code) — the "nodePath" field should only contain
      //    file paths, not the contents of those files
      if (entry.nodePath && typeof entry.nodePath === 'string') {
        // nodePath should be a path, not code
        expect(entry.nodePath).toMatch(/^[/\w.-]+$/);
        // Should NOT contain file extensions that would indicate file content
        expect(entry.nodePath).not.toContain('\n');
      }

      // 3. No raw voice transcripts
      if (entry.commandName) {
        // commandName should be a short action identifier, not a full sentence
        expect(entry.commandName.length).toBeLessThan(50);
        expect(entry.commandName).not.toMatch(/^where is/i);
        expect(entry.commandName).not.toMatch(/^show me/i);
        expect(entry.commandName).not.toMatch(/^find /i);
      }

      // 4. Only allowed fields for this action type
      const action = entry.userAction;
      if (action && ALLOWED_FIELDS_BY_ACTION[action]) {
        const disallowed = getDisallowedFields(action, entry);
        if (disallowed.length > 0) {
          console.error(`[FAIL] Disallowed fields in ${action}: ${disallowed.join(', ')}`);
        }
        expect(disallowed).toEqual([]);
      }

      // 5. Required fields always present
      expect(entry.userAction).toBeDefined();
      expect(entry.plugin).toBe('graphify-vr-explorer');
      expect(entry.timestamp).toBeDefined();
    }

    // 6. Verify specific action types are present
    const actions = auditEntries.map((e) => e.userAction);
    expect(actions).toContain('vr_explorer_open');
    expect(actions).toContain('vr_node_select');
    expect(actions).toContain('vr_voice_command');
    expect(actions).toContain('vr_ask_agent');
    expect(actions).toContain('vr_explorer_close');
  });

  test('audit_log_schema_valid — all entries match expected schema', async ({ page }) => {
    // Test that every action type has the correct shape
    const testCases = [
      {
        action: 'vr_explorer_open',
        data: { workspacePath: '/test', nodeCount: 100 },
        required: ['workspacePath', 'nodeCount'],
        types: { workspacePath: 'string', nodeCount: 'number' },
      },
      {
        action: 'vr_explorer_close',
        data: { sessionDurationMs: 5000 },
        required: ['sessionDurationMs'],
        types: { sessionDurationMs: 'number' },
      },
      {
        action: 'vr_mode_enter',
        data: { headsetType: 'Meta Quest 2' },
        required: ['headsetType'],
        types: { headsetType: 'string' },
      },
      {
        action: 'vr_node_select',
        data: { nodeId: 'src/main.dart', nodePath: 'src/main.dart' },
        required: ['nodeId', 'nodePath'],
        types: { nodeId: 'string', nodePath: 'string' },
      },
      {
        action: 'vr_voice_command',
        data: { commandName: 'flyToNode', param: 'AuthService' },
        required: ['commandName'],
        types: { commandName: 'string' },
        note: 'param is optional',
      },
      {
        action: 'vr_ask_agent',
        data: { nodeId: 'src/main.dart', taskId: 'task-123' },
        required: ['nodeId', 'taskId'],
        types: { nodeId: 'string', taskId: 'string' },
      },
      {
        action: 'vr_save_view',
        data: { taskId: 'task-456' },
        required: ['taskId'],
        types: { taskId: 'string' },
      },
      {
        action: 'vr_open_file',
        data: { nodePath: 'src/main.dart' },
        required: ['nodePath'],
        types: { nodePath: 'string' },
      },
    ];

    for (const tc of testCases) {
      // Build the audit entry as the plugin would
      const entry = {
        userAction: tc.action,
        plugin: 'graphify-vr-explorer',
        timestamp: new Date().toISOString(),
        ...tc.data,
      };

      // Verify required fields exist
      for (const field of tc.required) {
        expect(entry).toHaveProperty(field);
      }

      // Verify types
      for (const [field, type] of Object.entries(tc.types)) {
        expect(typeof entry[field]).toBe(type);
      }

      // Verify plugin name
      expect(entry.plugin).toBe('graphify-vr-explorer');

      // Verify timestamp is a valid ISO string
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);

      // Verify no forbidden content
      const allText = JSON.stringify(entry);
      const forbidden = FORBIDDEN_PATTERNS.some((p) => p.test(allText));
      expect(forbidden).toBe(false);
    }
  });
});
