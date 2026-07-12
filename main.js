/**
 * Holocron VR — YodaMan Plugin Entry Point
 *
 * Implements the YodaMan plugin lifecycle contract:
 *   onLoad  → onEnable → (active) → onDisable → onUnload
 *
 * Lifecycle hook signatures follow 05-YodaMan-Integration.md §1.
 * Manifest fields (plugin.json) follow 02-TSD.md §3.
 *
 * @module holocron-vr/main
 */

module.exports = {
  name: 'holocron-vr',
  permissions: ['graphify:read', 'agent:invoke', 'audit:write', 'task:create', 'desktop:openFile', 'storage:indexeddb', 'webxr', 'speech', 'git:read', 'upload:temp', 'filesystem:read-selected'],

  async execute(params = {}) {
    if (params._action === 'open') {
      return { opened: true, renderer: 'yodaman-host', project: params.project, message: 'Holocron VR launch accepted by the YodaMan host.' };
    }
    if (params._action === 'enable') return { enabled: true };
    if (params._action === 'disable') return { disabled: true };
    if (params._action === 'unload') return { unloaded: true };
    return { ok: true, name: 'holocron-vr' };
  },

  // ─── Lifecycle: onLoad ────────────────────────────────────────────────
  /**
   * Called once when YodaMan reads the plugin manifest.
   * Use for: registering UI extension points, verifying dependencies.
   * Must complete synchronously or return a resolved Promise quickly.
   *
   * @param {object} api — YodaMan plugin API handle
   * @returns {Promise<void>}
   */
  async onLoad(api) {
    // Verify Graphify is available — plugin can load but remain inactive
    // if the knowledge graph service isn't running yet.
    try {
      const status = await api.fetch('/api/graphify/status').then((r) => r.json());
      if (!status.available) {
        api.log.warn('[VR] Graphify not available; plugin loaded but inactive');
      }
    } catch (err) {
      api.log.warn('[VR] Could not reach Graphify API; plugin loaded but inactive', err);
    }

    // Register the Plugins-tab card component — renders a clickable card
    // in YodaMan's Plugins screen that opens the Holocron VR modal.
    api.ui.registerPluginCard({
      id: 'constellation-vr-card',
      component: './frontend/UIPanel.jsx',
      icon: './assets/icon.svg',
      label: 'Holocron VR',
      description: 'Explore your codebase as an immersive 3D constellation.',
    });

    api.log.info('[VR] Plugin loaded successfully');
  },

  // ─── Lifecycle: onEnable ──────────────────────────────────────────────
  /**
   * Called when the user enables the plugin (or YodaMan starts with
   * the plugin already in the enabled list).
   * Use for: starting background services, registering keyboard shortcuts.
   *
   * @param {object} api — YodaMan plugin API handle
   * @returns {Promise<void>}
   */
  async onEnable(api) {
    // Pre-warm the graph cache in the background (non-blocking).
    // The Web Worker fetches /api/graphify/map and computes the 3D layout
    // so that the VR scene is ready when the user opens the modal.
    api.worker.run('./backend/graphCache.js', { prefetch: true });

    // Register a desktop keyboard shortcut (Ctrl+Shift+V) to launch the
    // VR explorer without navigating through the Plugins tab.
    api.ui.registerShortcut({
      id: 'constellation-vr-open',
      keys: ['Ctrl', 'Shift', 'V'],
      action: () =>
        api.ui.openModal({
          id: 'constellation-vr-modal',
          title: 'Holocron VR',
          component: './frontend/UIPanel.jsx#VRExplorerModal',
          fullScreen: true,
          closable: true,
          onClose: () => api.log.info('[VR] Modal closed'),
        }),
      label: 'Open Holocron VR',
    });

    api.log.info('[VR] Plugin enabled');
  },

  // ─── Lifecycle: onDisable ─────────────────────────────────────────────
  /**
   * Called when the user disables the plugin in YodaMan Settings.
   * Use for: clearing background services, releasing resources.
   * The plugin UI is already hidden by the time this fires.
   *
   * @param {object} api — YodaMan plugin API handle
   * @returns {Promise<void>}
   */
  async onDisable(api) {
    // Terminate any running Web Workers (layoutWorker, graphCache)
    api.worker.terminateAll();

    // Unregister the keyboard shortcut registered in onEnable
    api.ui.unregisterShortcut('constellation-vr-open');

    api.log.info('[VR] Plugin disabled');
  },

  // ─── Lifecycle: onUnload ──────────────────────────────────────────────
  /**
   * Called when YodaMan is shutting down.
   * Use for: emergency cleanup (brief budget, ~100 ms).
   * IndexedDB writes are async — layout data persists across restarts
   * via the cache, so we don't block shutdown here.
   *
   * @param {object} api — YodaMan plugin API handle
   * @returns {void}
   */
  onUnload(api) {
    api.worker.terminateAll();
    api.log.info('[VR] Plugin unloaded');
  },
};
