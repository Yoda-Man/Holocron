import { auditLog, logSaveView } from './auditLogger.js';

/**
 * viewStore.js — Save/Restore VR Views as YodaMan Tasks
 *
 * Implements the task-system integration from 05-YodaMan-Integration.md §5.
 * Views are saved as YodaMan agent tasks with metadata containing the full
 * camera state and selected node for later restoration.
 *
 * ── Flow ────────────────────────────────────────────────────────────────
 *
 * Save View:
 *   Button/Voice → saveView(camera, nodeId, workspacePath)
 *     → POST /api/agent/task { task: "[VR View] ...", metadata: { vrViewState } }
 *     → Shows toast "View saved as task a1b2c3d4"
 *
 * Load Recent Views:
 *   On plugin load → loadRecentViews()
 *     → GET /api/agent/tasks
 *     → Filter for tasks with task.startsWith("[VR View]") && metadata.vrViewState
 *     → Return sorted by createdAt DESC
 *
 * Restore View:
 *   Click saved view → restoreView(task, viewer)
 *     → viewer.restoreCamera(state.camera)
 *     → viewer.selectNodeById(state.selectedNode) if set
 *     → viewer.flyToNode(state.selectedNode) if set
 *
 * @see 05-YodaMan-Integration.md §5.1 — Save View
 * @see 05-YodaMan-Integration.md §5.2 — Restore View
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** Prefix that identifies VR view tasks. */
const VR_VIEW_PREFIX = '[VR View]';

/** Timeout for task API calls (milliseconds). */
const TASK_API_TIMEOUT = 10_000;

// ─── State ──────────────────────────────────────────────────────────────

/** Cached list of recent views (loaded once, refreshed explicitly). */
let _recentViewsCache = [];
let _cacheTimestamp = 0;

/** Cache TTL in ms (30 seconds). */
const CACHE_TTL = 30_000;

// ═════════════════════════════════════════════════════════════════════════
//  SAVE VIEW (§5.1)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Save the current VR view (camera + selection) as a YodaMan task.
 *
 * @param {THREE.Camera}  camera         — Three.js camera
 * @param {string|null}   selectedNodeId — Currently selected node ID or null
 * @param {string}        workspacePath  — Active workspace path
 * @param {object}        [options]
 * @param {Function}      [options.onToast]  — Toast callback
 * @param {object}        [options.fetchImpl] — Override fetch (testing)
 * @returns {Promise<object|null>} { taskId, task } or null
 */
async function saveView(camera, selectedNodeId, workspacePath, options = {}) {
  const f = options.fetchImpl || globalThis.fetch;
  const onToast = options.onToast || (() => {});

  // Validate camera
  if (!camera || !camera.position || !camera.quaternion) {
    console.warn('[VR] saveView: invalid camera');
    onToast('Could not save view: camera not available', 'error');
    return null;
  }

  // Build view state (§5.1)
  const viewState = {
    camera: {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
    },
    selectedNode: selectedNodeId || null,
    workspace: workspacePath,
    timestamp: Date.now(),
  };

  // Build task title
  const workspaceName = workspacePath.split('/').pop() || workspacePath;
  const timeStr = new Date().toLocaleTimeString();
  const taskTitle = `${VR_VIEW_PREFIX} ${workspaceName} at ${timeStr}`;

  try {
    const signal = AbortSignal.timeout(TASK_API_TIMEOUT);
    const response = await f('/api/agent/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskTitle,
        projectId: workspacePath,
        metadata: { vrViewState: viewState },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Task API returned ${response.status}`);
    }

    const data = await response.json();
    const taskId = data.taskId || data.id;

    if (!taskId) {
      throw new Error('Task response missing taskId');
    }

    // Show toast with truncated task ID
    const shortId = taskId.slice(0, 8);
    onToast(`View saved as task ${shortId}`, 'success');

    // Invalidate cache so next loadRecentViews() refreshes
    _cacheTimestamp = 0;

    // Audit log
    logSaveView(taskId);

    return { taskId, task: taskTitle };
  } catch (err) {
    const msg = err.name === 'TimeoutError'
      ? 'Save timed out. Please try again.'
      : `Could not save view: ${err.message}`;
    console.warn('[VR] saveView error:', err);
    onToast(msg, 'error');
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  LOAD RECENT VIEWS (§5.2)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Fetch saved VR views from YodaMan's task system.
 *
 * Calls GET /api/agent/tasks, filters for tasks with:
 *   - task property starting with "[VR View]"
 *   - metadata.vrViewState containing camera data
 *
 * Results are cached for CACHE_TTL to avoid repeated API calls.
 *
 * @param {object}  [options]
 * @param {Function} [options.fetchImpl] — Override fetch (testing)
 * @param {boolean} [options.forceRefresh=false] — Bypass cache
 * @returns {Promise<Array<object>>} Sorted list of VR view tasks
 */
async function loadRecentViews(options = {}) {
  const f = options.fetchImpl || globalThis.fetch;
  const force = options.forceRefresh || false;

  // Return cache if fresh
  if (!force && _recentViewsCache.length > 0 &&
      Date.now() - _cacheTimestamp < CACHE_TTL) {
    return _recentViewsCache;
  }

  try {
    const signal = AbortSignal.timeout(TASK_API_TIMEOUT);
    const response = await f('/api/agent/tasks', { signal });

    if (!response.ok) {
      throw new Error(`Tasks API returned ${response.status}`);
    }

    const data = await response.json();
    const tasks = Array.isArray(data) ? data : (data.tasks || data.results || []);

    // Filter for VR view tasks with valid state
    const vrViews = tasks
      .filter((t) => {
        const taskText = t.task || t.title || '';
        return taskText.startsWith(VR_VIEW_PREFIX) &&
               t.metadata?.vrViewState?.camera?.position;
      })
      .map((t) => ({
        id: t.id || t.taskId,
        task: t.task || t.title,
        createdAt: t.createdAt || t.timestamp || Date.now(),
        workspace: t.metadata.vrViewState.workspace || '',
        viewState: t.metadata.vrViewState,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    _recentViewsCache = vrViews;
    _cacheTimestamp = Date.now();

    return vrViews;
  } catch (err) {
    console.warn('[VR] loadRecentViews error:', err);
    return [];
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  RESTORE VIEW (§5.2)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Restore a saved VR view by applying camera state and selecting the node.
 *
 * @param {object}        vrView          — Task object from loadRecentViews()
 * @param {import('../frontend/VRViewer').default} viewer — VRViewer instance
 * @param {object}        [options]
 * @param {Function}      [options.onToast]  — Toast callback
 */
function restoreView(vrView, viewer, options = {}) {
  const onToast = options.onToast || (() => {});

  if (!vrView?.viewState) {
    onToast('Cannot restore: view state is missing', 'error');
    return;
  }

  const state = vrView.viewState;

  if (!state.camera?.position || !state.camera?.quaternion) {
    onToast('Cannot restore: camera state is incomplete', 'error');
    return;
  }

  // Apply camera
  if (viewer?.restoreCamera) {
    viewer.restoreCamera(state.camera);
  }

  // Select and fly to node
  if (state.selectedNode && viewer?.selectNodeById && viewer?.flyToNode) {
    viewer.selectNodeById(state.selectedNode);
    setTimeout(() => viewer.flyToNode(state.selectedNode), 100);
  }

  onToast(`Restored: ${vrView.task}`, 'success');
}

// ═════════════════════════════════════════════════════════════════════════
//  RECENT VIEWS REACT COMPONENT
// ═════════════════════════════════════════════════════════════════════════

/**
 * Format a timestamp for display in the recent views list.
 *
 * @param {string|number} ts — ISO string or Unix ms
 * @returns {string}
 */
function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ═════════════════════════════════════════════════════════════════════════
//  VOICE COMMAND INTEGRATION
// ═════════════════════════════════════════════════════════════════════════

/**
 * Handle the "save view" voice command.
 *
 * @param {import('../frontend/VRViewer').default} viewer
 * @param {string}   workspacePath
 * @param {Function} [onToast]
 */
function handleSaveViewVoiceCommand(viewer, workspacePath, onToast) {
  const selectedId = viewer?.getSelectedNodeId?.() || null;
  const camera = viewer?.camera;
  if (!camera) {
    if (onToast) onToast('Camera not available', 'error');
    return;
  }
  saveView(camera, selectedId, workspacePath, { onToast });
}

// ═════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export {
  saveView,
  loadRecentViews,
  restoreView,
  handleSaveViewVoiceCommand,
  formatTimestamp,
};

export { VR_VIEW_PREFIX };
