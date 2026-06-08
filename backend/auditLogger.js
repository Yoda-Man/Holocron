/**
 * auditLogger.js — Centralized Audit Log (05-YodaMan-Integration.md §6)
 *
 * Fire-and-forget audit log writer for all user actions in Holocron VR.
 * Every log entry is POSTed to YodaMan's /api/audit endpoint and stored
 * in audit-log.jsonl on the local machine.
 *
 * ── Privacy Guarantees (§6.3) ───────────────────────────────────────────
 *   ✓ File contents are NEVER logged
 *   ✓ Raw voice transcripts are NEVER logged (only matched command names)
 *   ✓ Session recordings (WebXR frame data) are NEVER captured or logged
 *   ✓ Node file paths are logged but treated as local-only data
 *
 * ── Logged Actions (§6.1) ──────────────────────────────────────────────
 *   vr_explorer_open     — workspace path, node count
 *   vr_explorer_close    — session duration (ms)
 *   vr_mode_enter        — headset type
 *   vr_node_select       — node id, node path
 *   vr_voice_command     — command name
 *   vr_ask_agent         — node id, task id
 *   vr_save_view         — task id
 *   vr_open_file         — node path
 *
 * @see 05-YodaMan-Integration.md §6.1 — Logged actions table
 * @see 05-YodaMan-Integration.md §6.2 — Audit write implementation
 * @see 05-YodaMan-Integration.md §6.3 — Privacy considerations
 */

// ─── Meta ───────────────────────────────────────────────────────────────

const PLUGIN_NAME = 'graphify-vr-explorer';

/**
 * Session start timestamp — set when the plugin modal opens.
 * Used to compute session duration on close.
 */
let _sessionStart = null;

// ═════════════════════════════════════════════════════════════════════════
//  AUDIT LOG — Core Function
// ═════════════════════════════════════════════════════════════════════════

/**
 * Submit an audit log entry to YodaMan's backend.
 *
 * Fire-and-forget: does not block the caller. Failures are silently
 * caught since audit writes are non-critical.
 *
 * @param {string} userAction  — Action enum (§6.1)
 * @param {object} [data={}]   — Additional fields (nodeId, taskId, etc.)
 * @param {object} [options]
 * @param {object} [options.fetchImpl]  — Override fetch (testing)
 */
function auditLog(userAction, data = {}, options = {}) {
  const f = options.fetchImpl || globalThis.fetch;

  const body = {
    userAction,
    plugin: PLUGIN_NAME,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Fire-and-forget — never await in hot paths (§6.2)
  f('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    // Non-critical; silently ignored
  });
}

// ═════════════════════════════════════════════════════════════════════════
//  SESSION TRACKING
// ═════════════════════════════════════════════════════════════════════════

/**
 * Record that the VR Explorer modal opened.
 * Includes workspace path and node count for context.
 *
 * @param {string} workspacePath
 * @param {number} [nodeCount=0]
 */
function logExplorerOpen(workspacePath, nodeCount = 0) {
  _sessionStart = Date.now();
  auditLog('vr_explorer_open', {
    workspacePath,
    nodeCount,
  });
}

/**
 * Record that the VR Explorer modal closed.
 * Computes and includes session duration automatically.
 */
function logExplorerClose() {
  const duration = _sessionStart ? Date.now() - _sessionStart : 0;
  _sessionStart = null;
  auditLog('vr_explorer_close', {
    sessionDurationMs: duration,
  });
}

// ═════════════════════════════════════════════════════════════════════════
//  ACTION LOGGERS
// ═════════════════════════════════════════════════════════════════════════

/**
 * Log VR mode entry with headset type.
 *
 * @param {string} headsetType — e.g., "Meta Quest 2", "Meta Quest 3"
 */
function logVRModeEnter(headsetType) {
  auditLog('vr_mode_enter', { headsetType });
}

/**
 * Log node selection.
 *
 * @param {string} nodeId   — Full node identifier
 * @param {string} nodePath — File path (logged but local-only)
 */
function logNodeSelect(nodeId, nodePath) {
  auditLog('vr_node_select', { nodeId, nodePath });
}

/**
 * Log a voice command (command name only — NEVER the raw transcript).
 *
 * @param {string} commandName  — e.g., "flyToNode", "showCluster"
 * @param {string} [param]      — Command parameter (optional)
 */
function logVoiceCommand(commandName, param) {
  auditLog('vr_voice_command', {
    commandName,
    ...(param !== undefined ? { param } : {}),
  });
}

/**
 * Log an "Ask Agent" interaction.
 *
 * @param {string} nodeId
 * @param {string} taskId  — YodaMan task ID for the agent request
 */
function logAskAgent(nodeId, taskId) {
  auditLog('vr_ask_agent', { nodeId, taskId });
}

/**
 * Log a "Save View" action.
 *
 * @param {string} taskId — YodaMan task ID for the saved view
 */
function logSaveView(taskId) {
  auditLog('vr_save_view', { taskId });
}

/**
 * Log "Open in VS Code" action.
 *
 * @param {string} nodePath — File path opened
 */
function logOpenFile(nodePath) {
  auditLog('vr_open_file', { nodePath });
}

// ═════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export {
  auditLog,
  logExplorerOpen,
  logExplorerClose,
  logVRModeEnter,
  logNodeSelect,
  logVoiceCommand,
  logAskAgent,
  logSaveView,
  logOpenFile,
};
