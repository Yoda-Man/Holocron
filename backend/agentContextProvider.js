/**
 * agentContextProvider.js — Multi-Source Context Aggregator
 *
 * Gathers structured context from the current VR session, Git state,
 * selected nodes, and attached files before sending to /api/agent/task.
 *
 * This ensures YodaMan's agent has full awareness of what the user
 * is looking at, where they are in the codebase, and what they're
 * trying to accomplish.
 *
 * ── Context Sources ──────────────────────────────────────────────────────
 *
 *   VR state      → Camera position, visible clusters, selected node
 *   Graphify      → Node metadata, similar files, dependency chains
 *   Git           → Current branch, recent commits, uncommitted changes
 *   File system   → Snippets, full content (configs), previews (large files)
 *   Voice         → Matched command name, parameter, confidence
 *
 * ── Usage ───────────────────────────────────────────────────────────────
 *
 *   import { gatherContext } from './agentContextProvider.js';
 *
 *   const ctx = await gatherContext('vr_node', {
 *     nodeId: 'src/auth/AuthService.dart',
 *     workspacePath: '/Users/dev/my-project',
 *     api: yodaManApiHandle,
 *   });
 *
 *   // ctx is ready to attach to agent task:
 *   fetch('/api/agent/task', {
 *     body: JSON.stringify({
 *       task: prompt,
 *       metadata: { agentContext: ctx },   // ← context attached here
 *     }),
 *   });
 *
 * @see 05-YodaMan-Integration.md §4.1 — Ask Agent button flow
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum file content size to include inline (bytes). */
const MAX_INLINE_CONTENT = 50_000; // 50 KB

/** Maximum file content size for preview (bytes). */
const MAX_PREVIEW_SIZE = 200_000; // 200 KB

/** Preview line count for large files. */
const PREVIEW_LINES = 30;

/** File extensions treated as "config" — included fully if under MAX_INLINE_CONTENT. */
const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.env', '.env.example', '.editorconfig', '.gitignore',
  '.dockerfile', '.nginx.conf', '.xml', '.plist',
]);

/** File extensions treated as "log" — included fully if under MAX_INLINE_CONTENT. */
const LOG_EXTENSIONS = new Set([
  '.log', '.out', '.err', '.md',
]);

/** File extensions treated as source code — included as snippet preview. */
const SOURCE_EXTENSIONS = new Set([
  '.dart', '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go',
  '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.css', '.scss', '.less', '.html', '.vue', '.svelte',
]);

// ─── Content Size Helpers ──────────────────────────────────────────────

/**
 * Attempt to read file content from YodaMan's file system API.
 * Falls back to a simulated snippet if the API is unavailable.
 *
 * @param {string} filePath
 * @param {object} api — YodaMan plugin API handle
 * @returns {Promise<{ content: string|null, truncated: boolean, size: string }>}
 */
async function readFileContent(filePath, api) {
  try {
    // Try using YodaMan's file reading API
    if (api?.fs?.readFile) {
      const buffer = await api.fs.readFile(filePath);
      const size = buffer.byteLength || buffer.length || 0;
      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

      // Config/log files: include fully if small
      if (CONFIG_EXTENSIONS.has(ext) || LOG_EXTENSIONS.has(ext)) {
        if (size <= MAX_INLINE_CONTENT) {
          const content = typeof buffer === 'string' ? buffer : new TextDecoder().decode(buffer);
          return { content, truncated: false, size: formatSize(size) };
        }
        // Large config: include first MAX_INLINE_CONTENT bytes
        const partial = typeof buffer === 'string'
          ? buffer.slice(0, MAX_INLINE_CONTENT)
          : new TextDecoder().decode(buffer.slice(0, MAX_INLINE_CONTENT));
        return { content: partial + '\n... [truncated]', truncated: true, size: formatSize(size) };
      }

      // Source files: include preview (last N lines)
      if (SOURCE_EXTENSIONS.has(ext)) {
        const text = typeof buffer === 'string' ? buffer : new TextDecoder().decode(buffer);
        const lines = text.split('\n');
        if (lines.length <= PREVIEW_LINES) {
          return { content: text, truncated: false, size: formatSize(size) };
        }
        const preview = lines.slice(-PREVIEW_LINES).join('\n');
        return {
          content: `[${lines.length} lines total — showing last ${PREVIEW_LINES}]\n${preview}`,
          truncated: true,
          size: formatSize(size),
        };
      }

      // Other files: just report size
      return { content: null, truncated: false, size: formatSize(size) };
    }

    // Fallback: return null
    return { content: null, truncated: false, size: 'unknown' };
  } catch {
    return { content: null, truncated: false, size: 'unknown' };
  }
}

/**
 * Format a byte count as a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ═════════════════════════════════════════════════════════════════════════
//  CONTEXT PROVIDERS
// ═════════════════════════════════════════════════════════════════════════

/**
 * Gather selected node context from the VR scene.
 *
 * @param {object}   params
 * @param {string}   params.nodeId         — Selected node ID
 * @param {string}   params.workspacePath  — Active workspace
 * @param {object}   [params.viewer]       — VRViewer instance
 * @param {object}   [params.api]          — YodaMan API handle
 * @returns {Promise<object>} Node context block
 */
async function gatherNodeContext({ nodeId, workspacePath, viewer, api }) {
  if (!nodeId) return { nodes: [] };

  // Get node data from the viewer (if available)
  let nodeData = null;
  if (viewer) {
    const idx = viewer.getNodeIndex?.(nodeId);
    if (idx !== undefined) {
      nodeData = viewer.getNodeData?.(idx);
    }
  }

  // Build node info block
  const nodeInfo = {
    id: nodeId,
    path: nodeId,
    size: nodeData?.size ?? null,
    importance: nodeData?.importance ?? null,
    language: nodeData?.language ?? null,
  };

  // Try to fetch more metadata from Graphify
  if (api && workspacePath) {
    try {
      const response = await api.fetch('/api/graphify/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workspacePath, node: nodeId }),
      });
      if (response.ok) {
        const explain = await response.json();
        if (explain?.summary) {
          nodeInfo.importance = explain.summary.importance ?? nodeInfo.importance;
          nodeInfo.language = explain.summary.language ?? nodeInfo.language;
          nodeInfo.outgoingDeps = explain.summary.outgoingDependencies;
          nodeInfo.incomingDeps = explain.summary.incomingDependencies;
        }
      }
    } catch { /* non-critical — use whatever we have */ }
  }

  return { nodes: [nodeInfo] };
}

/**
 * Gather Git state from the workspace.
 *
 * @param {object} params
 * @param {string} params.workspacePath
 * @param {object} [params.api] — YodaMan API handle
 * @returns {Promise<object>} Git context block
 */
async function gatherGitContext({ workspacePath, api }) {
  const git = {
    branch: null,
    uncommitted: [],
    recentCommits: [],
    aheadBehind: null,
  };

  if (!api) return { git };

  try {
    // Try reading Git state from YodaMan's Git integration
    if (api.git?.getBranch) {
      git.branch = await api.git.getBranch(workspacePath);
    }

    if (api.git?.getUncommittedFiles) {
      const files = await api.git.getUncommittedFiles(workspacePath);
      git.uncommitted = Array.isArray(files) ? files.slice(0, 20) : [];
    }

    if (api.git?.getRecentCommits) {
      const commits = await api.git.getRecentCommits(workspacePath, 5);
      git.recentCommits = Array.isArray(commits)
        ? commits.map((c) => ({
            hash: c.hash?.slice(0, 8),
            message: c.message?.split('\n')[0],
            author: c.author,
            date: c.date,
          }))
        : [];
    }

    if (api.git?.getAheadBehind) {
      git.aheadBehind = await api.git.getAheadBehind(workspacePath);
    }
  } catch { /* non-critical — Git info is optional */ }

  return { git };
}

/**
 * Gather VR view state (camera, visible clusters).
 *
 * @param {object}   params
 * @param {object}   [params.viewer] — VRViewer instance
 * @returns {Promise<object>} VR context block
 */
async function gatherVRContext({ viewer }) {
  if (!viewer) return { vr: null };

  const camera = viewer.camera;
  const vr = {
    camera: camera
      ? {
          position: [camera.position.x, camera.position.y, camera.position.z].map((v) => Math.round(v * 100) / 100),
        }
      : null,
    selectedNodeId: viewer.getSelectedNodeId?.() ?? null,
    visibleNodeCount: viewer.lodData?.length ?? null,
    activeFilters: viewer.getFilters ? { ...viewer.getFilters() } : null,
  };

  return { vr };
}

/**
 * Gather context from attached files.
 *
 * @param {object}   params
 * @param {Array}    [params.filePaths] — File paths to include
 * @param {object}   [params.api]       — YodaMan API handle
 * @returns {Promise<object>} Attachments context block
 */
async function gatherAttachments({ filePaths, api }) {
  if (!filePaths || filePaths.length === 0) return { attachments: [] };

  const attachments = [];

  for (const filePath of filePaths.slice(0, 5)) {
    const { content, truncated, size } = await readFileContent(filePath, api);
    attachments.push({
      name: filePath.split('/').pop(),
      path: filePath,
      content,
      size,
      truncated,
    });
  }

  return { attachments };
}

/**
 * Query Graphify for related nodes (used by "find similar").
 *
 * @param {object}   params
 * @param {string}   params.nodeId
 * @param {string}   params.workspacePath
 * @param {object}   [params.api]
 * @returns {Promise<object>} Graphify context block
 */
async function gatherGraphifyContext({ nodeId, workspacePath, api }) {
  if (!api || !nodeId || !workspacePath) return { graphify: null };

  const graphify = {};

  // Fetch explain context
  try {
    const resp = await api.fetch('/api/graphify/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspacePath, node: nodeId }),
    });
    if (resp.ok) {
      const data = await resp.json();
      graphify.explain = {
        summary: data.summary,
        dependencies: data.dependencies,
        recentActivity: data.recentActivity,
      };
    }
  } catch { /* non-critical */ }

  return { graphify: Object.keys(graphify).length > 0 ? graphify : null };
}

// ═════════════════════════════════════════════════════════════════════════
//  MAIN AGGREGATOR
// ═════════════════════════════════════════════════════════════════════════

/**
 * Gather all available context for the given query type and parameters.
 *
 * @param {'chat'|'vr_node'|'vr_voice'|'git_commit'|'file_upload'} queryType
 * @param {object}   params
 * @param {string}   [params.nodeId]
 * @param {string}   [params.workspacePath]
 * @param {string}   [params.voiceCommand]
 * @param {Array}    [params.filePaths]
 * @param {object}   [params.viewer]      — VRViewer instance
 * @param {object}   [params.api]         — YodaMan plugin API handle
 * @param {string}   [params.commitHash]
 * @param {string}   [params.query]       — Raw text/voice input (for 'chat' type)
 * @returns {Promise<object>} Structured context JSON
 */
async function gatherContext(queryType, params = {}) {
  const {
    nodeId,
    workspacePath,
    voiceCommand,
    filePaths,
    viewer,
    api,
    commitHash,
    query,
  } = params;

  // ── Base context (always included) ──────────────────────────────────
  const context = {
    type: queryType,
    timestamp: new Date().toISOString(),
    source: 'holocron-vr',
  };

  // ── Type-specific context ──────────────────────────────────────────
  switch (queryType) {
    case 'vr_node': {
      // Node selected in VR — include node info, Git state, VR view
      const [nodeCtx, gitCtx, vrCtx, attachCtx] = await Promise.all([
        gatherNodeContext({ nodeId, workspacePath, viewer, api }),
        gatherGitContext({ workspacePath, api }),
        gatherVRContext({ viewer }),
        gatherAttachments({ filePaths, api }),
      ]);
      Object.assign(context, nodeCtx, gitCtx, vrCtx, attachCtx);
      break;
    }

    case 'vr_voice': {
      // Voice command in VR — include command info, selected node, VR view
      const [nodeCtx, gitCtx, vrCtx] = await Promise.all([
        gatherNodeContext({ nodeId, workspacePath, viewer, api }),
        gatherGitContext({ workspacePath, api }),
        gatherVRContext({ viewer }),
      ]);
      Object.assign(context, nodeCtx, gitCtx, vrCtx);
      if (voiceCommand) {
        context.voiceCommand = voiceCommand;
      }
      break;
    }

    case 'chat': {
      // Text/voice input — include Git state, attached files, VR view
      const [gitCtx, vrCtx, attachCtx] = await Promise.all([
        gatherGitContext({ workspacePath, api }),
        gatherVRContext({ viewer }),
        gatherAttachments({ filePaths, api }),
      ]);
      Object.assign(context, gitCtx, vrCtx, attachCtx);
      if (query) {
        context.query = query;
      }
      // If a node is selected, include it
      if (nodeId) {
        const nodeCtx = await gatherNodeContext({ nodeId, workspacePath, viewer, api });
        Object.assign(context, nodeCtx);
      }
      break;
    }

    case 'git_commit': {
      // Git commit selected — include commit info and changed files
      const [gitCtx, attachCtx] = await Promise.all([
        gatherGitContext({ workspacePath, api }),
        gatherAttachments({ filePaths, api }),
      ]);
      Object.assign(context, gitCtx, attachCtx);
      if (commitHash) {
        context.commitHash = commitHash;
      }
      // If a node is selected, include it
      if (nodeId) {
        const nodeCtx = await gatherNodeContext({ nodeId, workspacePath, viewer, api });
        Object.assign(context, nodeCtx);
      }
      break;
    }

    case 'file_upload': {
      // File upload — include file contents and Git state
      const [gitCtx, attachCtx] = await Promise.all([
        gatherGitContext({ workspacePath, api }),
        gatherAttachments({ filePaths, api }),
      ]);
      Object.assign(context, gitCtx, attachCtx);
      break;
    }

    default:
      // Unknown type — include whatever is available
      const defaultCtx = await gatherContext('chat', params);
      Object.assign(context, defaultCtx);
  }

  return context;
}

// ═════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPT BUILDER
// ═════════════════════════════════════════════════════════════════════════

/**
 * Build the system prompt section that describes the current context
 * to the agent. This becomes part of the agent task prompt.
 *
 * @param {object} context — The context object from gatherContext()
 * @returns {string} System prompt text
 */
function buildContextPrompt(context) {
  const parts = [];

  if (context.nodes?.length > 0) {
    const n = context.nodes[0];
    parts.push(`Selected file: "${n.path}"${n.size ? ` (${n.size} lines)` : ''}${n.importance ? `, ${n.importance} incoming dependencies` : ''}`);
  }

  if (context.git?.branch) {
    parts.push(`Git branch: ${context.git.branch}`);
    if (context.git.uncommitted?.length > 0) {
      parts.push(`Uncommitted changes: ${context.git.uncommitted.join(', ')}`);
    }
    if (context.git.recentCommits?.length > 0) {
      parts.push(`Recent commits: ${context.git.recentCommits.map((c) => `${c.hash} ${c.message}`).join('; ')}`);
    }
  }

  if (context.vr?.camera) {
    parts.push(`Camera position: [${context.vr.camera.position.join(', ')}]`);
  }

  if (context.attachments?.length > 0) {
    for (const a of context.attachments) {
      if (a.content) {
        parts.push(`\n--- ${a.name} (${a.size})${a.truncated ? ' [truncated]' : ''} ---\n${a.content}`);
      }
    }
  }

  return parts.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export {
  gatherContext,
  buildContextPrompt,
  gatherNodeContext,
  gatherGitContext,
  gatherVRContext,
  gatherAttachments,
  gatherGraphifyContext,
  formatSize,
};
