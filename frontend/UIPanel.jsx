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
 * Displays a launch button and status indicator. Clicking the button
 * instructs YodaMan's modal system to open the VR explorer scene.
 *
 * @param {object}   props
 * @param {object}   props.api        — YodaMan plugin API handle
 * @param {Function} props.openModal  — Convenience opener for the VR modal
 */
function UIPanel({ api, openModal }) {
  const [isLaunching, setIsLaunching] = useState(false);

  /**
   * Handle the "Launch VR Explorer" button click.
   * Opens a full-screen YodaMan modal that renders VRViewer.
   */
  const handleLaunch = useCallback(async () => {
    setIsLaunching(true);

    try {
      await (openModal || api?.ui?.openModal)({
        id: 'constellation-vr-modal',
        title: 'Holocron VR',
        component: './frontend/VRViewer.js',
        fullScreen: true,
        closable: true,
        onClose: () => {
          setIsLaunching(false);
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[VR] Failed to open modal:', err);
      setIsLaunching(false);
    }
  }, [api, openModal]);

  return (
    <div className="holocron-vr-panel">
      <button
        type="button"
        className="holocron-vr-launch-btn"
        onClick={handleLaunch}
        disabled={isLaunching}
        aria-label="Launch VR Explorer"
      >
        {isLaunching ? 'Launching…' : 'Launch VR Explorer'}
      </button>
    </div>
  );
}

export default UIPanel;
