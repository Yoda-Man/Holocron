/**
 * VRController.js — WebXR Session Manager for Holocron VR
 *
 * Manages WebXR device sessions (Quest 2/3), controller input, and the
 * XR animation loop. Emits events that VRViewer.js consumes to update
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

    /** @type {XRSpace|null} Reference space (local-floor). */
    this.refSpace = null;

    /** @type {XRWebGLLayer|null} */
    this.xrLayer = null;

    /** @type {boolean} Whether WebXR is available on this device. */
    this._available = false;

    /** @type {number|null} XR animation frame handle. */
    this._xrFrameId = null;

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
   * Request an immersive-vr session with 'local-floor' reference space.
   *
   * @param {WebGLRenderingContext} gl — The renderer's WebGL context
   * @returns {Promise<XRSession>}
   * @throws {Error} If WebXR is unavailable or session request fails
   */
  async requestVRSession(gl) {
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

    await this.setupSession(session, gl);
    return session;
  }

  /**
   * Set up the XR session: create WebGL layer, set up reference space,
   * attach controller event handlers, and start the XR frame loop.
   *
   * @param {XRSession} session
   * @param {WebGLRenderingContext} gl
   */
  async setupSession(session, gl) {
    this.session = session;

    // ── Create XRWebGLLayer ──────────────────────────────────────────
    this.xrLayer = new XRWebGLLayer(session, gl, {
      antialias: true,
      depth: true,
      stencil: false,
      alpha: false,
    });
    session.updateRenderState({ baseLayer: this.xrLayer });

    // ── Reference space ──────────────────────────────────────────────
    this.refSpace = await session.requestReferenceSpace('local-floor');

    // Attach viewer reference space for the camera
    this._viewerSpace = this.refSpace;

    // ── Attach controller events ─────────────────────────────────────
    this._attachControllerEvents(session);

    // ── Handle session end ───────────────────────────────────────────
    session.addEventListener('end', () => {
      console.log('[VR] XR session ended');
      this._cleanupSession();
      this._emit('vr-end', {});
    });

    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState === 'hidden') {
        console.log('[VR] XR session hidden (occluded)');
      }
    });

    // ── Start XR frame loop ─────────────────────────────────────────
    this._startXRFrameLoop();

    console.log('[VR] VR session started (local-floor)');
    this._emit('vr-ready', { session });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CONTROLLER INPUT HANDLING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Attach WebXR controller events (select, squeeze, end) for both
   * left and right controllers.
   *
   * @param {XRSession} session
   */
  _attachControllerEvents(session) {
    // ── squeeze (grip button) ───────────────────────────────────────
    session.addEventListener('squeezestart', (event) => {
      const hand = event.inputSource.handedness;
      this._controllers.set(hand, {
        ...this._controllers.get(hand),
        squeezing: true,
        squeezeTime: performance.now(),
      });
      this._checkBothGrips();
    });

    session.addEventListener('squeezeend', (event) => {
      const hand = event.inputSource.handedness;
      this._controllers.set(hand, {
        ...this._controllers.get(hand),
        squeezing: false,
      });
      this._checkBothGrips();
    });

    // ── select (trigger) ─────────────────────────────────────────────
    session.addEventListener('selectstart', (event) => {
      const hand = event.inputSource.handedness;
      this._triggerStart = performance.now();
      this._triggerController = hand;
    });

    session.addEventListener('selectend', (event) => {
      const elapsed = performance.now() - (this._triggerStart || 0);

      if (this._triggerController) {
        if (elapsed >= LONG_PRESS_MS) {
          // Long press → pin
          this._emit('pin-node', { handedness: this._triggerController });
        } else {
          // Short press → select
          this._handleRaySelect(event.inputSource);
        }
      }

      this._triggerStart = null;
      this._triggerController = null;
    });

    // ── controller disconnect ────────────────────────────────────────
    session.addEventListener('inputsourceschange', (event) => {
      for (const src of event.removed) {
        this._controllers.delete(src.handedness);
      }
      for (const src of event.added) {
        this._controllers.set(src.handedness, {
          squeezing: false,
          pointing: new Float32Array(4),
        });
      }
    });
  }

  /**
   * Handle ray-based node selection from a controller trigger press.
   *
   * Uses the controller's targetRaySpace to cast a ray into the scene.
   *
   * @param {XRInputSource} inputSource
   */
  _handleRaySelect(inputSource) {
    if (!this.viewer || !this.viewer.nodesMesh) return;

    // Get the target ray pose
    const raySpace = inputSource.targetRaySpace;
    if (!raySpace) return;

    const pose = this.xrFrame?.getPose(raySpace, this._viewerSpace);
    if (!pose) return;

    // Ray origin & direction
    const origin = pose.transform.position;
    const dir = new THREE.Vector3(
      -pose.transform.orientation.x,
      -pose.transform.orientation.y,
      -pose.transform.orientation.z
    );

    // Raycast using Three.js
    const raycaster = new THREE.Raycaster(origin, dir.normalize());
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
          this._emit('fly', {
            direction: this._getControllerForward(src),
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
   * Get the forward direction of a controller.
   *
   * @param {XRInputSource} inputSource
   * @returns {THREE.Vector3}
   */
  _getControllerForward(inputSource) {
    const pose = this.xrFrame?.getPose(
      inputSource.targetRaySpace,
      this._viewerSpace
    );

    if (pose) {
      const q = new THREE.Quaternion(
        pose.transform.orientation.x,
        pose.transform.orientation.y,
        pose.transform.orientation.z,
        pose.transform.orientation.w
      );
      const forward = new THREE.Vector3(0, 0, -1);
      return forward.applyQuaternion(q);
    }

    return new THREE.Vector3(0, 0, -1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  XR FRAME LOOP
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Start the XR presentation frame loop.
   * Replaces the standard requestAnimationFrame while VR is active.
   */
  _startXRFrameLoop() {
    if (!this.session) return;

    const onXRFrame = (time, frame) => {
      this._xrFrameId = this.session.requestAnimationFrame(onXRFrame);
      this.xrFrame = frame;

      if (!this.xrLayer) return;

      // ── Get viewer (head) pose ────────────────────────────────────
      const pose = frame.getViewerPose(this._viewerSpace);
      if (!pose) return;

      // ── Poll controllers every N frames ───────────────────────────
      this._frameCount++;
      if (this._frameCount % CONTROLLER_POLL_INTERVAL === 0) {
        this._pollControllerState();
      }

      // ── Render each eye ───────────────────────────────────────────
      const gl = this.xrLayer.context;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.xrLayer.framebuffer);

      for (const view of pose.views) {
        const viewport = this.xrLayer.getViewport(view);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

        // Update the viewer camera from XR view
        if (this.viewer) {
          this.viewer.camera.projectionMatrix.fromArray(view.projectionMatrix);
          const viewMatrix = new THREE.Matrix4().fromArray(view.transform.inverse.matrix);
          this.viewer.camera.matrix.fromArray(viewMatrix);
          this.viewer.camera.matrix.decompose(
            this.viewer.camera.position,
            this.viewer.camera.quaternion,
            this.viewer.camera.scale
          );
        }

        // Render
        if (this.viewer) {
          this.viewer.renderer.render(this.viewer.scene, this.viewer.camera);
        }
      }
    };

    this._xrFrameId = this.session.requestAnimationFrame(onXRFrame);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * End the active VR session and return to desktop 3D mode.
   */
  async endSession() {
    if (!this.session) return;

    try {
      // Cancel XR frame loop
      if (this._xrFrameId !== null) {
        this.session.cancelAnimationFrame(this._xrFrameId);
        this._xrFrameId = null;
      }

      await this.session.end();
    } catch (err) {
      console.warn('[VR] Error ending session:', err);
    }

    this._cleanupSession();
    this._emit('vr-end', {});
  }

  /**
   * Clean up session state without calling session.end().
   * Called on 'end' event from the session or after endSession().
   */
  _cleanupSession() {
    if (this._xrFrameId !== null) {
      try { this.session?.cancelAnimationFrame(this._xrFrameId); } catch { /* ignore */ }
      this._xrFrameId = null;
    }
    this.session = null;
    this.refSpace = null;
    this.xrLayer = null;
    this._controllers.clear();
    this._triggerStart = null;
    this._triggerController = null;
    this._bothGrips = false;
    this._frameCount = 0;
    this.xrFrame = null;
  }

  /**
   * Clean up all resources.
   */
  dispose() {
    if (this.session) {
      this.endSession().catch(() => {});
    }
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
