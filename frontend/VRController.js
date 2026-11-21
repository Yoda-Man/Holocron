/**
 * VRController.js — WebXR Session Manager for Holocron VR
 *
 * Manages WebXR device sessions (Quest 2/3) through three.js's renderer.xr,
 * and controller input. Emits events that VRViewer.js consumes to update
 * the scene based on headset/controller state.
 *
 * Controller mapping (08-Testing-Spec.md §3.2):
 *
 *   Action              | Input                      | Event
 *   ────────────────────┼────────────────────────────┼──────────────────
 *   Fly forward         | Right grip + point forward | 'fly' (direction)
 *   Orbit               | Right thumbstick L/R       | 'orbit' (angle)
 *   Return to centre    | Both grips simultaneously  | 'return-to-centre'
 *   Select node         | Right trigger on hit       | 'node-select' (id)
 *   Pin info panel      | Hold trigger 1 s           | 'pin-node' (id)
 *
 * Fallback: when WebXR is unavailable, emits 'fallback' so the app can
 * activate OrbitControls instead.
 *
 * @see 04-WASM-Spec.md §3.3 — VR session management tests
 * @see 08-Testing-Spec.md §3.2 — Controller mapping validation
 */

import * as THREE from 'three';

// ─── Constants ──────────────────────────────────────────────────────────

/** Duration for "long press" trigger detection (ms). */
const LONG_PRESS_MS = 1000;

/** How often the XR frame loop polls controller state (every N frames). */
const CONTROLLER_POLL_INTERVAL = 2;

/** Movement speed when flying (units per second). */
const FLY_SPEED = 4;

/** Orbit sensitivity (radians per unit of thumbstick deflection). */
const ORBIT_SENSITIVITY = 0.03;

// ═════════════════════════════════════════════════════════════════════════
//  VRController
// ═════════════════════════════════════════════════════════════════════════

class VRController {
  /**
   * @param {import('./VRViewer.js').default} viewer — VRViewer instance
   */
  constructor(viewer) {
    /** @type {import('./VRViewer.js').default} */
    this.viewer = viewer;

    /** @type {XRSession|null} Active WebXR session. */
    this.session = null;

    /** @type {{ray: THREE.Group, grip: THREE.Group}[]|null} From renderer.xr.getController/getControllerGrip. */
    this._xrControllers = null;

    /** @type {boolean} Whether WebXR is available on this device. */
    this._available = false;

    /** @type {Map<string, object>} Controller state by handedness. */
    this._controllers = new Map();

    /** @type {number} Frame counter for throttled operations. */
    this._frameCount = 0;

    /** @type {number|null} Timestamp when trigger was first pressed (for long-press). */
    this._triggerStart = null;

    /** @type {string|null} Which controller has the trigger pressed. */
    this._triggerController = null;

    /** @type {boolean} Both grips pressed state for return-to-centre. */
    this._bothGrips = false;

    // ── Event callbacks ──────────────────────────────────────────────
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  AVAILABILITY & SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check whether WebXR is available and supports immersive-vr mode.
   *
   * @returns {Promise<boolean>}
   */
  async checkAvailability() {
    if (typeof navigator === 'undefined' || !navigator.xr) {
      this._available = false;
      return false;
    }

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      this._available = supported;
      if (!supported) {
        this._emit('fallback', { reason: 'immersive-vr not supported' });
      }
      return supported;
    } catch (err) {
      console.warn('[VR] WebXR availability check failed:', err);
      this._available = false;
      this._emit('fallback', { reason: err.message });
      return false;
    }
  }

  /**
   * Check if AR mode is supported (optional, not required for MVP).
   *
   * @returns {Promise<boolean>}
   */
  async checkARAvailability() {
    if (typeof navigator === 'undefined' || !navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  /**
   * Request an immersive-vr session and hand it to three.js's WebXR manager.
   *
   * @returns {Promise<XRSession>}
   * @throws {Error} If WebXR is unavailable or session request fails
   */
  async requestVRSession() {
    if (!this._available) {
      const avail = await this.checkAvailability();
      if (!avail) {
        throw new Error('WebXR immersive-vr is not available on this device');
      }
    }

    if (this.session) {
      console.warn('[VR] VR session already active — ending first');
      await this.endSession();
    }

    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });

    await this.setupSession(session);
    return session;
  }

  /**
   * Start the session through renderer.xr, attach the two controllers and
   * switch the viewer to the XR animation loop.
   *
   * @param {XRSession} session
   */
  async setupSession(session) {
    this.session = session;
    const { renderer } = this.viewer;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    this._attachControllers(renderer);
    session.addEventListener('end', () => {
      if (this.session !== session) return; // endSession() already cleaned up
      console.log('[VR] XR session ended');
      this._cleanupSession();
      this._emit('vr-end', {});
    });

    await renderer.xr.setSession(session);

    this.viewer.startXR(() => {
      this._frameCount++;
      if (this._frameCount % CONTROLLER_POLL_INTERVAL === 0) this._pollControllerState();
    });

    console.log('[VR] VR session started (local-floor)');
    this._emit('vr-ready', { session });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CONTROLLER INPUT HANDLING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Add three.js's controller spaces (target ray and grip) for both hands to
   * the scene and listen for their select and squeeze events. three.js keeps
   * their poses current every XR frame.
   *
   * @param {THREE.WebGLRenderer} renderer
   */
  _attachControllers(renderer) {
    if (this._xrControllers) return; // renderer.xr returns the same groups every session
    this._xrControllers = [0, 1].map((i) => {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      this.viewer.scene.add(ray, grip);
      ray.addEventListener('connected', (e) => { ray.userData.handedness = e.data.handedness; });
      ray.addEventListener('disconnected', () => {
        this._controllers.delete(ray.userData.handedness);
        ray.userData.handedness = null;
      });
      ray.addEventListener('squeezestart', () => this._setSqueeze(ray, true));
      ray.addEventListener('squeezeend', () => this._setSqueeze(ray, false));
      ray.addEventListener('selectstart', () => {
        this._triggerStart = performance.now();
        this._triggerController = ray.userData.handedness;
      });
      ray.addEventListener('selectend', () => {
        const elapsed = performance.now() - (this._triggerStart || 0);
        if (this._triggerController) {
          if (elapsed >= LONG_PRESS_MS) this._emit('pin-node', { handedness: this._triggerController });
          else this._handleRaySelect(ray);
        }
        this._triggerStart = null;
        this._triggerController = null;
      });
      return { ray, grip };
    });
  }

  _setSqueeze(ray, squeezing) {
    const hand = ray.userData.handedness;
    this._controllers.set(hand, { ...this._controllers.get(hand), squeezing });
    this._checkBothGrips();
  }

  /**
   * Cast a ray from a controller's target-ray pose and emit `node-select` on a hit.
   *
   * @param {THREE.Group} ray — a group from renderer.xr.getController()
   */
  _handleRaySelect(ray) {
    if (!this.viewer || !this.viewer.nodesMesh) return;

    const origin = new THREE.Vector3().setFromMatrixPosition(ray.matrixWorld);
    const raycaster = new THREE.Raycaster(origin, this._forwardOf(ray));
    const intersects = raycaster.intersectObject(this.viewer.nodesMesh);

    if (intersects.length > 0) {
      const instanceIdx = intersects[0].instanceId;
      for (const [id, idx] of this.viewer.nodeIdMap) {
        if (idx === instanceIdx) {
          this._emit('node-select', { nodeId: id, instanceIdx });
          return;
        }
      }
    }
  }

  /**
   * Check if both controllers are squeezing simultaneously.
   * When both grips are held, emit 'return-to-centre'.
   */
  _checkBothGrips() {
    const left = this._controllers.get('left');
    const right = this._controllers.get('right');
    const both = left?.squeezing && right?.squeezing;

    if (both && !this._bothGrips) {
      this._bothGrips = true;
      this._emit('return-to-centre', {});
    } else if (!both) {
      this._bothGrips = false;
    }
  }

  /**
   * Poll controller gamepad state: thumbstick axes.
   * Called from the XR frame loop.
   *
   * Right thumbstick horizontal → orbit rotation.
   */
  _pollControllerState() {
    if (!this.session) return;

    const sources = this.session.inputSources;
    for (const src of sources) {
      const hand = src.handedness;
      if (!hand) continue;

      const gamepad = src.gamepad;
      if (!gamepad) continue;

      // Thumbstick axes
      // axes[0] = horizontal, axes[1] = vertical (both -1 to 1)
      const stickX = gamepad.axes[2] ?? gamepad.axes[0] ?? 0;
      const stickY = gamepad.axes[3] ?? gamepad.axes[1] ?? 0;

      // Dead zone
      const deadZone = 0.15;

      if (hand === 'right') {
        // Right thumbstick: horizontal → orbit
        if (Math.abs(stickX) > deadZone) {
          this._emit('orbit', { angle: stickX * ORBIT_SENSITIVITY });
        }

        // Right grip + pointing forward → fly
        const squeezing = this._controllers.get('right')?.squeezing;
        if (squeezing) {
          const ray = this._xrControllers?.find((c) => c.ray.userData.handedness === 'right')?.ray;
          this._emit('fly', {
            direction: ray ? this._forwardOf(ray) : new THREE.Vector3(0, 0, -1),
            speed: FLY_SPEED,
          });
        }
      }

      // Store the pointing direction
      this._controllers.set(hand, {
        ...this._controllers.get(hand),
        axes: [stickX, stickY],
      });
    }
  }

  /**
   * Forward (-Z) direction of a controller's target ray in world space.
   *
   * @param {THREE.Group} ray
   * @returns {THREE.Vector3}
   */
  _forwardOf(ray) {
    const q = new THREE.Quaternion().setFromRotationMatrix(ray.matrixWorld);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * End the active VR session and return to desktop 3D mode.
   * three.js and the session's `end` event do the cleanup and emit `vr-end`.
   */
  async endSession() {
    if (!this.session) return;
    const session = this.session;
    try {
      await session.end();
    } catch (err) {
      console.warn('[VR] Error ending session:', err);
    }
    // A session that never fired `end` must still give the desktop back.
    if (this.session === session) {
      this._cleanupSession();
      this._emit('vr-end', {});
    }
  }

  /**
   * Clean up session state and resume the viewer's desktop loop.
   */
  _cleanupSession() {
    this.viewer?.stopXR();
    this.session = null;
    this._controllers.clear();
    this._triggerStart = null;
    this._triggerController = null;
    this._bothGrips = false;
    this._frameCount = 0;
  }

  /**
   * Clean up all resources.
   */
  dispose() {
    if (this.session) {
      this.endSession().catch(() => {});
    }
    for (const { ray, grip } of this._xrControllers || []) this.viewer?.scene?.remove(ray, grip);
    this._xrControllers = null;
    this._listeners.clear();
    this.viewer = null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EVENT SYSTEM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Register an event listener.
   *
   * @param {'vr-ready'|'vr-end'|'node-select'|'fly'|'return-to-centre'|'orbit'|'pin-node'|'fallback'} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  /**
   * Remove a previously registered listener.
   *
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const list = this._listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * Emit an event to all registered listeners.
   *
   * @param {string} event
   * @param {object} data
   */
  _emit(event, data) {
    const list = this._listeners.get(event);
    if (list) {
      for (const cb of list) {
        try { cb(data); } catch (err) {
          console.warn(`[VR] Error in ${event} handler:`, err);
        }
      }
    }
  }
}

export default VRController;
