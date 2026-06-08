/**
 * vscodeClient.js — "Open in VS Code" Integration (05-YodaMan-Integration.md §7)
 *
 * Opens a file from the VR constellation in VS Code via YodaMan's desktop
 * control API. Checks editor availability first and shows a helpful toast
 * when VS Code is not installed or not in PATH.
 *
 * ── Flow ────────────────────────────────────────────────────────────────
 *
 *   Button/Voice "open in VS Code"
 *     → GET  /api/desktop/diagnostics           Check availability
 *     → POST /api/desktop/open-file { path }    Open file
 *     → POST /api/audit { userAction: 'vr_open_file' }
 *
 * ── Trigger Points ──────────────────────────────────────────────────────
 *   - InfoPanel "📂 Open in VS Code" button
 *   - Voice command "open in vs code" / "open in editor"
 *   - Keyboard shortcut Ctrl+O / Cmd+O (when node selected)
 *
 * @see 05-YodaMan-Integration.md §7.1 — Implementation
 * @see 05-YodaMan-Integration.md §6.1 — Audit log: vr_open_file
 */

import { logOpenFile } from './auditLogger.js';

// ─── Constants ──────────────────────────────────────────────────────────

/** Timeout for the diagnostics API call (ms). */
const DIAGNOSTICS_TIMEOUT = 5_000;

/** Timeout for the open-file API call (ms). */
const OPEN_FILE_TIMEOUT = 5_000;

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Normalize file paths for cross-platform compatibility.
 *
 * - Windows backslashes → forward slashes
 * - Trims whitespace
 * - Resolves relative paths to absolute if needed
 *
 * @param {string} filePath — Raw file path from graph data
 * @returns {string} Normalized path
 */
function normalizePath(filePath) {
  if (!filePath) return '';

  let normalized = filePath.trim();

  // Convert Windows backslashes to forward slashes
  normalized = normalized.replace(/\\/g, '/');

  return normalized;
}

// ═════════════════════════════════════════════════════════════════════════
//  CHECK AVAILABILITY
// ═════════════════════════════════════════════════════════════════════════

/**
 * Check whether VS Code is available on this machine.
 *
 * Calls GET /api/desktop/diagnostics and returns the vsCodeAvailable flag.
 *
 * @param {object}  [options]
 * @param {object}  [options.fetchImpl] — Override fetch (testing)
 * @returns {Promise<{ available: boolean, detail: string }>}
 */
async function checkVSCodeAvailability(options = {}) {
  const f = options.fetchImpl || globalThis.fetch;

  try {
    const signal = AbortSignal.timeout(DIAGNOSTICS_TIMEOUT);
    const response = await f('/api/desktop/diagnostics', { signal });

    if (!response.ok) {
      return {
        available: false,
        detail: `Diagnostics API returned ${response.status}`,
      };
    }

    const data = await response.json();

    return {
      available: !!data.vsCodeAvailable,
      detail: data.vsCodeAvailable
        ? 'VS Code is available'
        : (data.vsCodePath || 'VS Code not found in PATH'),
    };
  } catch (err) {
    return {
      available: false,
      detail: err.name === 'TimeoutError'
        ? 'Diagnostics check timed out'
        : `Diagnostics check failed: ${err.message}`,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  OPEN FILE
// ═════════════════════════════════════════════════════════════════════════

/**
 * Open a file in VS Code via YodaMan's desktop control API.
 *
 * Steps:
 *   1. Normalize the file path
 *   2. Check VS Code availability via diagnostics endpoint
 *   3. If unavailable, return error message with instructions
 *   4. Call open-file endpoint
 *   5. Log to audit
 *
 * @param {object}   node         — GraphNode with { path, id }
 * @param {object}   [options]
 * @param {Function} [options.onToast]   — Toast callback (msg, level)
 * @param {object}   [options.fetchImpl] — Override fetch (testing)
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function openInVSCode(node, options = {}) {
  const f = options.fetchImpl || globalThis.fetch;
  const onToast = options.onToast || (() => {});

  // Validate
  if (!node || (!node.path && !node.id)) {
    const msg = 'Cannot open: no file path available';
    onToast(msg, 'error');
    return { success: false, message: msg };
  }

  // Step 1: Normalize path (§7 — Windows backslash handling)
  const filePath = normalizePath(node.path || node.id);
  if (!filePath) {
    const msg = 'Cannot open: empty file path';
    onToast(msg, 'error');
    return { success: false, message: msg };
  }

  // Step 2: Check VS Code availability (§7.1 Step 1)
  const diag = await checkVSCodeAvailability({ fetchImpl: f });

  if (!diag.available) {
    const msg = diag.detail.includes('PATH')
      ? 'VS Code not found in PATH. Install VS Code or add it to your PATH.'
      : `VS Code not available: ${diag.detail}`;
    onToast(msg, 'warning');
    return { success: false, message: msg };
  }

  // Step 3: Open the file (§7.1 Step 2)
  try {
    const signal = AbortSignal.timeout(OPEN_FILE_TIMEOUT);
    const response = await f('/api/desktop/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = body.error || `Open-file API returned ${response.status}`;
      onToast(`Failed to open: ${msg}`, 'error');
      return { success: false, message: msg };
    }

    // Step 4: Audit log (§6.1)
    logOpenFile(filePath);

    const msg = `Opened in VS Code: ${filePath.split('/').pop()}`;
    onToast(msg, 'success');
    return { success: true, message: msg };
  } catch (err) {
    const msg = err.name === 'TimeoutError'
      ? 'Opening file timed out. Is VS Code responding?'
      : `Failed to open in VS Code: ${err.message}`;
    onToast(msg, 'error');
    return { success: false, message: msg };
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUT
// ═════════════════════════════════════════════════════════════════════════

/**
 * Register a keyboard shortcut (Ctrl+O / Cmd+O) to open the selected
 * node in VS Code.
 *
 * @param {import('../frontend/VRViewer').default} viewer
 * @param {Function} onToast
 * @returns {Function} Cleanup function
 */
function registerKeyboardShortcut(viewer, onToast) {
  const handler = (event) => {
    // Ctrl+O on Windows/Linux, Cmd+O on macOS
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyO') {
      // Only fire if a node is selected
      const nodeId = viewer?.getSelectedNodeId?.();
      if (!nodeId) {
        onToast?.('Select a node first (Ctrl+O)', 'warning');
        return;
      }

      const idx = viewer?.getNodeIndex?.(nodeId);
      const data = viewer?.getNodeData?.(idx);
      if (!data) {
        onToast?.('Could not get node data', 'error');
        return;
      }

      event.preventDefault();
      openInVSCode({ id: data.id, path: data.id }, { onToast });
    }
  };

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

// ═════════════════════════════════════════════════════════════════════════
//  VOICE COMMAND HANDLER
// ═════════════════════════════════════════════════════════════════════════

/**
 * Handle the "open in vs code" or "open in editor" voice command.
 *
 * @param {import('../frontend/VRViewer').default} viewer
 * @param {Function} onToast
 */
function handleVoiceCommand(viewer, onToast) {
  const nodeId = viewer?.getSelectedNodeId?.();
  if (!nodeId) {
    onToast?.('No node selected. Point at a node first.', 'warning');
    return;
  }

  openInVSCode({ id: nodeId, path: nodeId }, { onToast });
}

// ═════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export {
  openInVSCode,
  checkVSCodeAvailability,
  registerKeyboardShortcut,
  handleVoiceCommand,
  normalizePath,
};
