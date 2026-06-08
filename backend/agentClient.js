import { auditLog, logAskAgent } from './auditLogger.js';

/**
 * agentClient.js — "Ask Agent" Flow (05-YodaMan-Integration.md §4)
 *
 * Orchestrates the three-step agent interaction:
 *   1. Fetch node context via POST /api/graphify/explain
 *   2. Submit agent task via   POST /api/agent/task
 *   3. Open chat panel to show streaming SSE response
 *
 * Also writes an audit log entry via POST /api/audit.
 *
 * The flow is triggered from:
 *   - InfoPanel "🤖 Ask Agent" button
 *   - Voice command "ask agent about this"
 *
 * @see 05-YodaMan-Integration.md §4.1 — Ask Agent button flow
 * @see 05-YodaMan-Integration.md §4.2 — Voice command integration
 * @see 05-YodaMan-Integration.md §6   — Audit logging
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** Timeout for the explain API call (milliseconds). */
const EXPLAIN_TIMEOUT_MS = 10_000;

/** Timeout for the agent task submission (milliseconds). */
const TASK_TIMEOUT_MS = 15_000;

// ─── State ──────────────────────────────────────────────────────────────

/** 
 * Currently active agent request state.
 * Only one agent interaction at a time.
 */
let _state = {
  active: false,
  nodeId: null,
  taskId: null,
  abortController: null,
  /** Callbacks registered by UI to reflect loading state. */
  onStateChange: null,
};

// ─── Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the agent prompt from node metadata and explain context.
 *
 * @param {object} node     — GraphNode: { path, size, importance, id }
 * @param {object} context  — Response from /api/graphify/explain
 * @returns {string} Prompt string for the agent task
 */
function buildPrompt(node, context) {
  const summary = context?.summary ? JSON.stringify(context.summary, null, 2) : '{}';

  return [
    `I am exploring my codebase in VR. I have selected the file:`,
    `"${node.path}" (${node.size ?? '?'} lines, ${node.importance ?? '?'} incoming dependencies).`,
    ``,
    `Graph context: ${summary}`,
    ``,
    `Please explain this file's role in the overall architecture, its key`,
    `responsibilities, and any architectural concerns you can see from`,
    `its dependency relationships.`,
  ].join('\n');
}

// ─── Main askAgent Flow (§4.1) ─────────────────────────────────────────

/**
 * Execute the "Ask Agent" flow for a graph node.
 *
 * Steps:
 *   1. Validate preconditions (node selected, not already loading)
 *   2. Set loading state (UI shows pulsing glow)
 *   3. Fetch graph context  → POST /api/graphify/explain
 *   4. Build prompt
 *   5. Submit agent task   → POST /api/agent/task
 *   6. Open YodaMan chat panel
 *   7. Write audit log
 *   8. Clear loading state
 *
 * @param {object}   node           — GraphNode with { id, path, size, importance }
 * @param {string}   workspacePath  — Active workspace path (projectId)
 * @param {object}   [api]          — YodaMan plugin API handle
 * @param {Function} [onLoading]    — Called with (loading: bool) for UI feedback
 * @param {object}   [fetchImpl]    — Override fetch for testing
 * @returns {Promise<object|null>}  — { taskId } or null on failure
 */
async function askAgent(node, workspacePath, api, onLoading, fetchImpl) {
  // ── Step 1: Validate ──────────────────────────────────────────────
  if (!node || !node.id) {
    console.warn('[VR] askAgent: no node provided');
    return null;
  }
  if (_state.active) {
    console.warn('[VR] askAgent: already processing a request');
    return null;
  }

  const f = fetchImpl || globalThis.fetch;
  const abortController = new AbortController();
  _state.active = true;
  _state.nodeId = node.id;
  _state.abortController = abortController;
  _state.onStateChange = onLoading || null;

  // Notify UI: loading started
  if (_state.onStateChange) _state.onStateChange(true);
  if (api?.log?.info) api.log.info(`[VR] Asking agent about ${node.id}`);

  try {
    // ── Step 2: Fetch graph context (§4.1 Step 1) ─────────────────
    const explainSignal = AbortSignal.timeout(EXPLAIN_TIMEOUT_MS);
    const explainResponse = await f('/api/graphify/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspacePath, node: node.id }),
      signal: explainSignal,
    });

    if (!explainResponse.ok) {
      throw new Error(`Explain API returned ${explainResponse.status}`);
    }

    const context = await explainResponse.json();

    // ── Step 3: Build prompt (§4.1 Step 2) ─────────────────────────
    const prompt = buildPrompt(node, context);

    // ── Step 4: Submit agent task (§4.1 Step 3) ────────────────────
    const taskSignal = AbortSignal.timeout(TASK_TIMEOUT_MS);
    const taskResponse = await f('/api/agent/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: prompt,
        projectId: workspacePath,
      }),
      signal: taskSignal,
    });

    if (!taskResponse.ok) {
      throw new Error(`Agent task API returned ${taskResponse.status}`);
    }

    const taskData = await taskResponse.json();
    const taskId = taskData.taskId || taskData.id;

    if (!taskId) {
      throw new Error('Agent task response missing taskId');
    }

    _state.taskId = taskId;

    // ── Step 5: Open YodaMan chat panel (§4.1 Step 4) ──────────────
    if (api?.ui?.openPanel) {
      try {
        api.ui.openPanel('chat', { taskId });
      } catch (panelErr) {
        // Chat panel might not be available in all environments
        console.warn('[VR] Could not open chat panel:', panelErr);
      }
    }

    // ── Step 6: Audit log (§6.2) ──────────────────────────────────
    logAskAgent(node.id, taskId);

    if (api?.log?.info) {
      api.log.info(`[VR] Agent task submitted: ${taskId}`);
    }

    // ── Step 7: Clear loading ─────────────────────────────────────
    _state.active = false;
    if (_state.onStateChange) _state.onStateChange(false);
    _state.abortController = null;

    return { taskId };
  } catch (err) {
    // ── Error handling ────────────────────────────────────────────
    const message = err.name === 'TimeoutError'
      ? 'Agent request timed out. Please try again.'
      : `Agent request failed: ${err.message}`;

    console.warn('[VR] askAgent error:', err);
    if (api?.log?.warn) api.log.warn(`[VR] ${message}`);

    _state.active = false;
    if (_state.onStateChange) _state.onStateChange(false);
    _state.abortController = null;

    return null;
  }
}

// ─── Abort ──────────────────────────────────────────────────────────────

/**
 * Cancel an in-progress agent request.
 */
function abortAgent() {
  if (_state.abortController) {
    _state.abortController.abort();
    _state.abortController = null;
  }
  _state.active = false;
  if (_state.onStateChange) _state.onStateChange(false);
}

// ─── Voice Command Handler (§4.2) ──────────────────────────────────────

/**
 * Handle the "ask agent about this" or "ask agent" voice command.
 *
 * @param {object}   viewer         — VRViewer instance (to get selected node)
 * @param {string}   workspacePath  — Active workspace path
 * @param {object}   [api]          — YodaMan plugin API handle
 * @param {Function} [onToast]      — Toast callback
 * @param {Function} [onLoading]    — Loading state callback
 */
function handleVoiceCommand(viewer, workspacePath, api, onToast, onLoading) {
  const nodeId = viewer?.getSelectedNodeId?.();
  if (!nodeId) {
    if (onToast) onToast('No node selected. Point at a node first.', 'warning');
    return;
  }

  const nodeData = viewer?.getNodeData?.(viewer.getNodeIndex(nodeId));
  if (!nodeData) {
    if (onToast) onToast('Could not get node data.', 'error');
    return;
  }

  // Construct a minimal node object from the available data
  const node = {
    id: nodeData.id,
    path: nodeData.id,
    size: nodeData.size,
    importance: nodeData.importance,
  };

  askAgent(node, workspacePath, api, onLoading);
}

// ─── Exports ────────────────────────────────────────────────────────────

export {
  askAgent,
  abortAgent,
  handleVoiceCommand,
  buildPrompt,
};
