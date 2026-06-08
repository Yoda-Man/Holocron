/**
 * SettingsPanel.jsx — VR Explorer Slide-In Drawer (03-UI-Spec.md §3.6)
 *
 * Slide-in drawer from the right edge with LOD thresholds, max nodes,
 * voice toggle, comfort mode, theme selector, and node filters.
 *
 * Settings are persisted via YodaMan's config API (05-YodaMan-Integration.md §9):
 *   On mount:  api.config.get('graphify-vr-explorer.<key>') ?? default
 *   On save:   api.config.set('graphify-vr-explorer.<key>', value)
 *   On change: api.config.onChange('graphify-vr-explorer.*', handler)
 *
 * @see 03-UI-Spec.md §3.6 — Settings panel layout
 * @see 05-YodaMan-Integration.md §9 — Config persistence
 * @see 05-YodaMan-Integration.md §8 — Theme integration
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── Factory Defaults ───────────────────────────────────────────────────

const DEFAULTS = {
  lodNear: 5,
  lodMid: 15,
  lodFar: 30,
  maxNodes: 3000,
  voiceEnabled: true,
  comfortMode: true,
  theme: 'auto',
};

const LOD_MIN = 1;
const LOD_MAX = 100;
const MAX_NODES_MIN = 500;
const MAX_NODES_MAX = 10000;
const MAX_NODES_STEP = 100;

// ─── Config key prefix per §9 ───────────────────────────────────────────

const CFG_PREFIX = 'graphify-vr-explorer';

// ─── Animation durations (03-UI-Spec.md §8) ─────────────────────────────

const SLIDE_IN_MS = 250;

// ─── Styles — component as inline style object ──────────────────────────

const s = (open) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(0,0,0,0.4)',
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    transition: `opacity ${SLIDE_IN_MS}ms ease-out`,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '340px',
    maxWidth: '90vw',
    zIndex: 1001,
    background: 'rgba(13, 13, 26, 0.96)',
    borderLeft: '1px solid rgba(124, 106, 247, 0.3)',
    backdropFilter: 'blur(12px)',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    color: '#e8e8f0',
    fontSize: '13px',
    display: 'flex',
    flexDirection: 'column',
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    transition: `transform ${SLIDE_IN_MS}ms ease-out`,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '20px 20px 14px',
    borderBottom: '1px solid rgba(124, 106, 247, 0.12)',
    flexShrink: 0,
  },
  headerTitle: { fontSize: '15px', fontWeight: 600, flex: 1 },
  closeBtn: {
    background: 'none', border: 'none', color: '#8e8ea0',
    cursor: 'pointer', fontSize: '18px', padding: '4px 8px',
    borderRadius: '6px', lineHeight: 1,
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '16px 20px',
  },
  section: { marginBottom: '20px' },
  sectionTitle: {
    fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.8px', color: '#8e8ea0', marginBottom: '10px',
  },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 0', gap: '12px',
  },
  label: { color: '#e8e8f0', flex: 1, fontSize: '13px' },
  labelDesc: { fontSize: '11px', color: '#6b7280', marginTop: '-4px' },
  numberInput: {
    width: '64px', padding: '5px 8px',
    background: 'rgba(124,106,247,0.08)', border: '1px solid rgba(124,106,247,0.25)',
    borderRadius: '6px', color: '#e8e8f0', fontSize: '12px',
    textAlign: 'center', fontFamily: 'ui-monospace, monospace',
  },
  slider: { flex: 1, accentColor: '#7c6af7', height: '4px', cursor: 'pointer' },
  sliderValue: {
    minWidth: '44px', textAlign: 'right', fontSize: '12px',
    fontFamily: 'ui-monospace, monospace', color: '#c084fc',
  },
  checkbox: {
    width: '16px', height: '16px', accentColor: '#7c6af7', cursor: 'pointer', flexShrink: 0,
  },
  select: {
    padding: '5px 10px', background: 'rgba(124,106,247,0.08)',
    border: '1px solid rgba(124,106,247,0.25)', borderRadius: '6px',
    color: '#e8e8f0', fontSize: '12px', cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  footer: {
    padding: '14px 20px 20px',
    borderTop: '1px solid rgba(124, 106, 247, 0.12)',
    display: 'flex', gap: '10px',
    flexShrink: 0,
  },
  btn: {
    flex: 1, height: '38px', border: '1px solid rgba(124,106,247,0.3)',
    borderRadius: '8px', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
  },
  btnPrimary: {
    background: 'rgba(124,106,247,0.2)', color: '#c084fc',
  },
  btnSecondary: {
    background: 'transparent', color: '#8e8ea0',
  },
  filterRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '4px 0', cursor: 'pointer',
  },
  langChip: {
    padding: '3px 10px', borderRadius: '6px',
    border: '1px solid rgba(124,106,247,0.2)',
    background: 'rgba(124,106,247,0.06)', color: '#e8e8f0',
    fontSize: '11px', cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'background 0.12s',
  },
  langChipActive: {
    background: 'rgba(124,106,247,0.25)', borderColor: 'rgba(124,106,247,0.5)', color: '#c084fc',
  },
});

// ═════════════════════════════════════════════════════════════════════════
//  SettingsPanel
// ═════════════════════════════════════════════════════════════════════════

/**
 * Slide-in settings drawer for Holocron VR.
 *
 * @param {object}   props
 * @param {boolean}  props.open               — Drawer visible
 * @param {Function} props.onClose             — Close drawer
 * @param {object}   [props.api]              — YodaMan API handle (for config persistence)
 * @param {object}   [props.initialValues]     — Override initial values
 * @param {Function} [props.onSave]            — Called with all values on Save
 * @param {object}   [props.filters]           — Current filter state
 * @param {Function} [props.onFilterChange]    — Filter toggle callback
 * @param {Function} [props.onResetFilters]    — Reset filters callback
 */
function SettingsPanel({
  open,
  onClose,
  api,
  initialValues = {},
  onSave,
  filters = {},
  onFilterChange,
  onResetFilters,
}) {
  // ── State (lazy-loaded from config or defaults) ──────────────────
  const [values, setValues] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef(false);

  // Load settings from YodaMan config on mount / open
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;

    (async () => {
      const out = { ...DEFAULTS, ...initialValues };
      if (api?.config?.get) {
        for (const key of Object.keys(DEFAULTS)) {
          try {
            const v = await api.config.get(`${CFG_PREFIX}.${key}`);
            if (v !== undefined && v !== null) out[key] = v;
          } catch { /* use default */ }
        }
      }
      if (!cancelled) { setValues(out); setLoaded(true); }
    })();

    return () => { cancelled = true; };
  }, [open, loaded, api, initialValues]);

  // Reset to defaults when modal reopens
  useEffect(() => {
    if (!open) { setLoaded(false); pendingRef.current = false; }
  }, [open]);

  // ── Handlers ───────────────────────────────────────────────────
  const set = useCallback((key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked
            : e.target.type === 'number'   ? Math.max(LOD_MIN, Math.min(LOD_MAX, Number(e.target.value)))
            : e.target.value;
    setValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  const setSlider = useCallback((key) => (e) => {
    setValues((prev) => ({ ...prev, [key]: Number(e.target.value) }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!values) return;
    const pending = { ...values };

    // Persist via YodaMan config API (§9)
    if (api?.config?.set) {
      const promises = Object.entries(pending).map(([key, val]) =>
        api.config.set(`${CFG_PREFIX}.${key}`, val).catch(() => {})
      );
      await Promise.all(promises);
    }

    // Notify parent
    if (onSave) onSave(pending);
    if (onClose) onClose();
  }, [values, api, onSave, onClose]);

  const handleReset = useCallback(async () => {
    const reset = { ...DEFAULTS };
    setValues(reset);

    // Persist defaults
    if (api?.config?.set) {
      await Promise.all(
        Object.entries(reset).map(([k, v]) =>
          api.config.set(`${CFG_PREFIX}.${k}`, v).catch(() => {})
        )
      );
    }
    if (onSave) onSave(reset);
  }, [api, onSave]);

  useMemo(() => { if (!values) return ''; }, [values]);

  // ── Filter toggle helper ────────────────────────────────────────
  const toggleFilter = useCallback(
    (key) => (e) => onFilterChange?.(key, e.target.checked),
    [onFilterChange]
  );

  const toggleLang = useCallback(
    (key) => () => onFilterChange?.(key, !filters[key]),
    [filters, onFilterChange]
  );

  // ── Render ──────────────────────────────────────────────────────
  const style = s(open);
  // 'open' state from style function

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────── */}
      <div style={style.overlay} onClick={onClose} />

      {/* ── Drawer ────────────────────────────────────────────── */}
      <div style={style.drawer} role="dialog" aria-label="VR Explorer Settings">
        {/* ── Header ────────────────────────────────────────── */}
        <div style={style.header}>
          <span style={{ fontSize: '18px' }}>⚙</span>
          <span style={style.headerTitle}>Settings</span>
          <button type="button" style={style.closeBtn} onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        {/* ── Body (scrollable) ──────────────────────────────── */}
        <div style={style.body}>
          {values && (
            <>
              {/* ═══ LOD Thresholds ════════════════════════════ */}
              <div style={style.section}>
                <div style={style.sectionTitle}>Level of Detail</div>

                <div style={style.row}>
                  <span style={style.label}>Near threshold</span>
                  <input
                    type="number" min={LOD_MIN} max={LOD_MAX}
                    style={style.numberInput}
                    value={values.lodNear}
                    onChange={set('lodNear')}
                    aria-label="LOD near threshold"
                  />
                </div>
                <div style={style.row}>
                  <span style={style.label}>Mid threshold</span>
                  <input
                    type="number" min={LOD_MIN} max={LOD_MAX}
                    style={style.numberInput}
                    value={values.lodMid}
                    onChange={set('lodMid')}
                    aria-label="LOD mid threshold"
                  />
                </div>
                <div style={style.row}>
                  <span style={style.label}>Far threshold</span>
                  <input
                    type="number" min={LOD_MIN} max={LOD_MAX}
                    style={style.numberInput}
                    value={values.lodFar}
                    onChange={set('lodFar')}
                    aria-label="LOD far threshold"
                  />
                </div>
              </div>

              {/* ═══ Max Nodes ══════════════════════════════════ */}
              <div style={style.section}>
                <div style={style.sectionTitle}>Rendering</div>
                <div style={style.row}>
                  <span style={style.label}>Max nodes</span>
                  <span style={style.sliderValue}>{values.maxNodes}</span>
                </div>
                <input
                  type="range" min={MAX_NODES_MIN} max={MAX_NODES_MAX} step={MAX_NODES_STEP}
                  style={style.slider}
                  value={values.maxNodes}
                  onChange={setSlider('maxNodes')}
                  aria-label="Maximum nodes to render"
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                  <span>500</span>
                  <span>10,000</span>
                </div>
              </div>

              {/* ═══ Voice / Comfort Toggles ════════════════════ */}
              <div style={style.section}>
                <div style={style.sectionTitle}>Preferences</div>

                <label style={style.row}>
                  <input type="checkbox" style={style.checkbox}
                    checked={values.voiceEnabled} onChange={set('voiceEnabled')} />
                  <span style={style.label}>Voice commands</span>
                </label>

                <label style={{ ...style.row, border: 'none' }}>
                  <input type="checkbox" style={style.checkbox}
                    checked={values.comfortMode} onChange={set('comfortMode')} />
                  <span style={style.label}>VR comfort mode</span>
                </label>
              </div>

              {/* ═══ Theme Selector ══════════════════════════════ */}
              <div style={style.section}>
                <div style={style.sectionTitle}>Theme</div>
                <div style={style.row}>
                  <span style={style.label}>Colour scheme</span>
                  <select style={style.select} value={values.theme} onChange={set('theme')}>
                    <option value="auto">Auto</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
              </div>

              {/* ═══ Node Filters ════════════════════════════════ */}
              <div style={style.section}>
                <div style={style.sectionTitle}>Node Filters</div>

                <label style={style.filterRow}>
                  <input type="checkbox" style={style.checkbox}
                    checked={!!filters.tests} onChange={toggleFilter('tests')} />
                  <span style={style.label}>Show test files</span>
                </label>
                <div style={{ ...style.labelDesc, marginLeft: '24px', marginBottom: '4px' }}>
                  test/, spec/, _test.*
                </div>

                <label style={style.filterRow}>
                  <input type="checkbox" style={style.checkbox}
                    checked={!!filters.thirdParty} onChange={toggleFilter('thirdParty')} />
                  <span style={style.label}>Show third-party code</span>
                </label>
                <div style={{ ...style.labelDesc, marginLeft: '24px', marginBottom: '2px' }}>
                  node_modules, vendor/
                </div>

                <label style={style.filterRow}>
                  <input type="checkbox" style={style.checkbox}
                    checked={!!filters.generated} onChange={toggleFilter('generated')} />
                  <span style={style.label}>Show generated files</span>
                </label>

                <label style={style.filterRow}>
                  <input type="checkbox" style={style.checkbox}
                    checked={!!filters.recent} onChange={toggleFilter('recent')} />
                  <span style={style.label}>Only changed in 30 days</span>
                </label>
              </div>

              {/* ═══ Language Filter ══════════════════════════════ */}
              <div style={style.section}>
                <div style={style.sectionTitle}>Language (show only)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {['dart','typescript','javascript','python','json','yaml'].map((l) => (
                    <button key={l} type="button"
                      style={{ ...style.langChip, ...(filters[l] ? style.langChipActive : {}) }}
                      onClick={toggleLang(l)}
                      aria-pressed={!!filters[l]}>
                      {l === 'typescript' ? 'TS' : l === 'javascript' ? 'JS' : l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer — Save / Reset ──────────────────────────── */}
        <div style={style.footer}>
          <button type="button"
            style={{ ...style.btn, ...style.btnSecondary }}
            onClick={handleReset}>
            Reset Defaults
          </button>
          <button type="button"
            style={{ ...style.btn, ...style.btnPrimary }}
            onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════
//  Settings Button (gear icon for VR Explorer modal footer)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Small gear icon button to open the settings drawer.
 * Renders in the VR Explorer modal footer.
 *
 * @param {object}   props
 * @param {Function} props.onClick
 */
function SettingsButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open settings"
      aria-label="Open settings"
      style={{
        width: '36px', height: '36px', border: '1px solid rgba(124,106,247,0.25)',
        borderRadius: '8px', background: 'rgba(124,106,247,0.08)',
        color: '#8e8ea0', cursor: 'pointer', fontSize: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(124,106,247,0.18)'; e.currentTarget.style.color = '#c084fc'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(124,106,247,0.08)'; e.currentTarget.style.color = '#8e8ea0'; }}
    >
      ⚙
    </button>
  );
}

export default SettingsPanel;
export { SettingsButton, DEFAULTS, CFG_PREFIX };
