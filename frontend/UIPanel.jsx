/**
 * Holocron VR — UIPanel React Component
 *
 * Primary UI entry point for the VR Explorer. Rendered as a card in
 * YodaMan's Plugins tab and exposes a "Launch VR Explorer" button that
 * opens the full-screen Three.js / WebXR modal.
 *
 * Inherits YodaMan's theme tokens via CSS custom properties.
 * Reuses the host React instance — no separate React bundle.
 *
 * @module frontend/UIPanel
 */

import React, { useCallback, useState } from 'react';

/**
 * UIPanel — Plugins-tab card component.
 *
 * Displays a launch button, status indicator, and diagnostic messages.
 * Clicking the button instructs YodaMan's modal system to open the VR explorer scene.
 *
 * @param {object}   props
 * @param {object}   props.api        — YodaMan plugin API handle
 * @param {Function} props.openModal  — Convenience opener for the VR modal
 */
function UIPanel({ api, openModal }) {
  const [isLaunching, setIsLaunching] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null); // { type: 'info'|'error'|'success', text: string }

  /**
   * Handle the "Launch VR Explorer" button click.
   * Opens a full-screen YodaMan modal that renders VRViewer.
   * Provides detailed user-visible diagnostics on success and failure.
   */
  const handleLaunch = useCallback(async () => {
    setIsLaunching(true);
    setStatusMessage(null);

    // Check if Graphify is available (required for constellation data)
    let graphifyAvailable = false;
    try {
      if (api?.graphify?.status) {
        const gStatus = await api.graphify.status();
        graphifyAvailable = gStatus?.ok === true;
        if (!graphifyAvailable) {
          setStatusMessage({
            type: 'info',
            text: 'Graphify data not available — the VR constellation will be empty. Run Sync Repository to build the knowledge graph.',
          });
        }
      }
    } catch (_) {
      setStatusMessage({
        type: 'info',
        text: 'Could not check Graphify status — the VR constellation may be empty.',
      });
    }

    try {
      setStatusMessage({ type: 'info', text: 'Loading 3D engine (Three.js + WebGL)...' });

      await (openModal || api?.ui?.openModal)({
        id: 'constellation-vr-modal',
        title: 'Holocron VR',
        component: './frontend/VRViewer.js',
        fullScreen: true,
        closable: true,
        onClose: () => {
          setIsLaunching(false);
          setStatusMessage(null);
        },
      });

      setStatusMessage({ type: 'success', text: 'VR Explorer launched successfully.' });
    } catch (err) {
      const errorText = err?.message || String(err);
      setStatusMessage({
        type: 'error',
        text: `Failed to launch VR Explorer: ${errorText}. Check that WebGL is supported and the runtime is running on port 3090.`,
      });
      // Also log to console for debugging
      // eslint-disable-next-line no-console
      console.error('[VR] Failed to open modal:', err);
    } finally {
      setIsLaunching(false);
    }
  }, [api, openModal]);

  return (
    <div className="holocron-vr-panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
      <button
        type="button"
        className="holocron-vr-launch-btn"
        onClick={handleLaunch}
        disabled={isLaunching}
        aria-label="Launch VR Explorer"
      >
        {isLaunching ? 'Launching…' : 'Launch VR Explorer'}
      </button>

      {statusMessage && (
        <div
          style={{
            fontSize: '11px',
            padding: '6px 10px',
            borderRadius: '6px',
            maxWidth: '400px',
            lineHeight: '1.4',
            ...(statusMessage.type === 'error'
              ? { background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5' }
              : statusMessage.type === 'info'
              ? { background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', color: '#93c5fd' }
              : { background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', color: '#86efac' }
            ),
          }}
        >
          {statusMessage.type === 'error' ? '⚠️ ' : statusMessage.type === 'info' ? 'ℹ️ ' : '✅ '}
          {statusMessage.text}
        </div>
      )}
    </div>
  );
}

export default UIPanel;
