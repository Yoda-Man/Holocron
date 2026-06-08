/**
 * InfoPanel.jsx — Node Information Panel (03-UI-Spec.md §3.4)
 *
 * Displays metadata about a selected graph node: file path, LOC, dependency
 * counts, last modified date, test coverage, and action buttons for agent
 * queries, graph queries, file opening, and panel pinning.
 *
 * Two rendering modes:
 *   Desktop: DOM overlay positioned by the caller
 *   VR:      Three.js CSS2DRenderer Sprite (billboarded via caller)
 *
 * @see 03-UI-Spec.md §3.4  — Desktop info panel layout
 * @see 03-UI-Spec.md §3.5  — VR info panel (billboard)
 * @see 03-UI-Spec.md §4.1  — Colour palette & tokens
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── Constants ──────────────────────────────────────────────────────────

/** Max path length before ellipsis truncation. */
const MAX_PATH_LENGTH = 48;

/** Path segments to keep at start and end when truncating. */
const PATH_KEEP_START = 2;
const PATH_KEEP_END = 2;

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Truncate a long file path for display.
 *
 * Examples:
 *   "src/auth/AuthService.dart" → "src/auth/AuthService.dart"
 *   "very/long/path/to/a/deeply/nested/file.dart"
 *     → "very/…/nested/file.dart"
 *
 * @param {string} path — File path
 * @returns {string} Truncated path
 */
function truncatePath(path) {
  if (!path || path.length <= MAX_PATH_LENGTH) return path || '';

  const segments = path.split('/');
  if (segments.length <= PATH_KEEP_START + PATH_KEEP_END) return path;

  const start = segments.slice(0, PATH_KEEP_START).join('/');
  const end = segments.slice(-PATH_KEEP_END).join('/');
  return `${start}/…/${end}`;
}

/**
 * Format a timestamp into a human-readable relative string.
 *
 * @param {number|string|null} timestamp — Unix ms or ISO string
 * @returns {string}
 */
function formatLastChanged(timestamp) {
  if (!timestamp) return 'Unknown';

  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

/**
 * Format a coverage fraction as a percentage string.
 *
 * @param {number|null} coverage — 0.0 to 1.0
 * @returns {string}
 */
function formatCoverage(coverage) {
  if (coverage === null || coverage === undefined) return '—';
  return `${Math.round(coverage * 100)}%`;
}

// ─── Styles ─────────────────────────────────────────────────────────────

/** Panel container — glassmorphism overlay matching §4.1 tokens. */
const styles = {
  panel: {
    background: 'rgba(13, 13, 26, 0.92)',
    border: '1px solid rgba(124, 106, 247, 0.3)',
    borderRadius: '12px',
    padding: '16px',
    maxWidth: '320px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    color: '#e8e8f0',
    fontSize: '12px',
    lineHeight: 1.5,
    backdropFilter: 'blur(8px)',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '10px',
    paddingBottom: '10px',
    borderBottom: '1px solid rgba(124, 106, 247, 0.15)',
  },
  icon: {
    fontSize: '16px',
    flexShrink: 0,
  },
  path: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e8e8f0',
    wordBreak: 'break-all',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '6px 16px',
    marginBottom: '12px',
  },
  label: {
    color: '#8e8ea0',
    fontSize: '11px',
  },
  value: {
    color: '#e8e8f0',
    fontWeight: 500,
    textAlign: 'right',
  },
  fullWidth: {
    gridColumn: '1 / -1',
    display: 'flex',
    justifyContent: 'space-between',
  },
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '4px',
  },
  button: {
    flex: '1 0 auto',
    minWidth: '0',
    height: '36px',
    padding: '0 14px',
    border: '1px solid rgba(124, 106, 247, 0.3)',
    borderRadius: '8px',
    background: 'rgba(124, 106, 247, 0.1)',
    color: '#e8e8f0',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
    whiteSpace: 'nowrap',
    transition: 'background 0.15s, border-color 0.15s',
  },
  buttonPrimary: {
    background: 'rgba(124, 106, 247, 0.25)',
    borderColor: 'rgba(124, 106, 247, 0.5)',
  },
  pinButton: {
    background: 'rgba(78, 205, 196, 0.15)',
    borderColor: 'rgba(78, 205, 196, 0.3)',
  },
  pinButtonActive: {
    background: 'rgba(78, 205, 196, 0.3)',
    borderColor: '#4ecdc4',
    color: '#4ecdc4',
  },
};

// ═════════════════════════════════════════════════════════════════════════
//  InfoPanel Component
// ═════════════════════════════════════════════════════════════════════════

/**
 * InfoPanel — displays metadata and actions for a selected graph node.
 *
 * @param {object}   props
 * @param {object|null} props.node          — GraphNode with metadata
 * @param {Function}    [props.onAskAgent]     — Click: Ask Agent
 * @param {Function}    [props.onFindRelated]  — Click: Find Related
 * @param {Function}    [props.onOpenInVSCode] — Click: Open in VS Code
 * @param {Function}    [props.onPin]          — Click: Pin Panel
 * @param {Function}    [props.onClose]        — Click: Close/Deselect
 * @param {boolean}     [props.isPinned=false] — Panel is pinned (won't auto-dismiss)
 * @param {boolean}     [props.useCompact=false] — Compact layout for VR mode
 * @param {string}      [props.className]      — Additional CSS class
 */
function InfoPanel({
  node,
  onAskAgent,
  onFindRelated,
  onOpenInVSCode,
  onPin,
  onClose,
  loading = false,
  isPinned = false,
  useCompact = false,
  className = '',
}) {
  // ── Inject pulse animation keyframes once ─────────────────────────
  useEffect(() => {
    const id = 'vr-agent-pulse-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `@keyframes vr-agent-pulse {
      0%, 100% { box-shadow: 0 0 4px rgba(192, 132, 252, 0.3); }
      50%     { box-shadow: 0 0 16px rgba(192, 132, 252, 0.7); }
    }`;
    document.head.appendChild(style);
    return () => { const el = document.getElementById(id); if (el) el.remove(); };
  }, []);

  // ── Hover state for buttons (desktop only) ─────────────────────────
  const [hoveredBtn, setHoveredBtn] = useState(null);

  // ── Derived data ───────────────────────────────────────────────────
  const truncatedPath = useMemo(() => truncatePath(node?.path || node?.id || ''), [node]);

  // If there's no node, render nothing
  if (!node) return null;

  // ── Event handlers ─────────────────────────────────────────────────
  const pulseRef = useRef(null);
  const handleAskAgent = useCallback(() => { if (!loading) onAskAgent?.(node); }, [node, onAskAgent, loading]);
  const handleFindRelated = useCallback(() => onFindRelated?.(node), [node, onFindRelated]);
  const handleOpenInVSCode = useCallback(() => onOpenInVSCode?.(node), [node, onOpenInVSCode]);
  const handlePin = useCallback(() => onPin?.(node), [node, onPin]);
  const handleClose = useCallback(() => onClose?.(node), [node, onClose]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      className={className}
      style={{
        ...styles.panel,
        ...(useCompact ? { padding: '12px', maxWidth: '260px', fontSize: '11px' } : {}),
      }}
      role="dialog"
      aria-label={`Info panel for ${node.path || node.id}`}
    >
      {/* ── Header: icon + path ──────────────────────────────────── */}
      <div style={styles.header}>
        <span style={styles.icon}>📄</span>
        <span style={styles.path} title={node.path || node.id}>
          {truncatedPath}
        </span>
      </div>

      {/* ── Metadata grid ────────────────────────────────────────── */}
      <div style={styles.grid}>
        <div style={styles.fullWidth}>
          <span style={styles.label}>Lines of code</span>
          <span style={styles.value}>{node.size?.toLocaleString() ?? '—'}</span>
        </div>

        <div style={styles.fullWidth}>
          <span style={styles.label}>Incoming deps</span>
          <span style={styles.value}>{node.importance ?? '—'}</span>
        </div>

        <div style={styles.fullWidth}>
          <span style={styles.label}>Outgoing deps</span>
          <span style={styles.value}>
            {node.outgoingDeps !== undefined ? node.outgoingDeps : '—'}
          </span>
        </div>

        <div style={styles.fullWidth}>
          <span style={styles.label}>Last changed</span>
          <span style={styles.value}>
            {node.lastChanged ? formatLastChanged(node.lastChanged) : '—'}
          </span>
        </div>

        <div style={styles.fullWidth}>
          <span style={styles.label}>Test coverage</span>
          <span style={{
            ...styles.value,
            color: node.testCoverage ? '#57c785' : '#8e8ea0',
          }}>
            {formatCoverage(node.testCoverage ?? null)}
          </span>
        </div>
      </div>

      {/* ── Action buttons ───────────────────────────────────────── */}
      <div style={styles.buttonRow}>
        <button
          type="button"
          ref={pulseRef}
          style={{
            ...styles.button,
            ...styles.buttonPrimary,
            ...(loading ? {
              opacity: 0.6,
              cursor: 'wait',
              animation: 'vr-agent-pulse 1.2s ease-in-out infinite',
              borderColor: 'rgba(192, 132, 252, 0.6)',
            } : {}),
          }}
          onClick={handleAskAgent}
          disabled={loading}
          onMouseEnter={() => setHoveredBtn('agent')}
          onMouseLeave={() => setHoveredBtn(null)}
          title={loading ? 'Agent is thinking…' : 'Ask YodaMan agent about this file'}
          aria-label="Ask Agent about this file"
        >
          {loading ? '⏳ Thinking…' : '🤖 Ask Agent'}
        </button>

        <button
          type="button"
          style={styles.button}
          onClick={handleFindRelated}
          onMouseEnter={() => setHoveredBtn('related')}
          onMouseLeave={() => setHoveredBtn(null)}
          title="Find related files in the graph"
          aria-label="Find Related files"
        >
          🔗 Find Related
        </button>
      </div>

      <div style={{ ...styles.buttonRow, marginTop: '6px' }}>
        <button
          type="button"
          style={styles.button}
          onClick={handleOpenInVSCode}
          onMouseEnter={() => setHoveredBtn('vscode')}
          onMouseLeave={() => setHoveredBtn(null)}
          title="Open this file in VS Code"
          aria-label="Open in VS Code"
        >
          📂 Open in VS Code
        </button>

        <button
          type="button"
          style={{
            ...styles.button,
            ...(isPinned ? styles.pinButtonActive : styles.pinButton),
          }}
          onClick={handlePin}
          onMouseEnter={() => setHoveredBtn('pin')}
          onMouseLeave={() => setHoveredBtn(null)}
          title={isPinned ? 'Unpin panel' : 'Pin panel (keep open while flying)'}
          aria-label={isPinned ? 'Unpin Panel' : 'Pin Panel'}
        >
          {isPinned ? '📌 Pinned' : '📌 Pin Panel'}
        </button>

        <button
          type="button"
          style={{ ...styles.button, flex: '0 0 auto', padding: '0 10px' }}
          onClick={handleClose}
          title="Close panel"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default InfoPanel;
export { truncatePath, formatLastChanged, formatCoverage };
