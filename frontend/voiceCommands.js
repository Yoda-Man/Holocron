/**
 * voiceCommands.js — Web Speech API Voice Command Handler
 *
 * Listens for spoken commands via the Web Speech API, parses them against
 * a pattern grammar (03-UI-Spec.md §9), and emits structured action events
 * that VRViewer.js consumes for camera movement, filtering, and selection.
 *
 * Confidence threshold: ≥ 0.7 (lower confidence is silently ignored).
 * Filler words ("um", "please", "can you") are stripped before matching.
 *
 * Keyboard shortcuts are registered as a fallback when the Speech API is
 * unavailable or voice is disabled in settings.
 *
 * @see 03-UI-Spec.md §9   — Voice command grammar
 * @see 08-Testing-Spec.md §1.2 — Voice command tests
 * @see 05-YodaMan-Integration.md §4 — Agent integration
 */

// ─── Filler Words (stripped before matching) ────────────────────────────

const FILLER_WORDS = new Set([
  'um', 'uh', 'like', 'can', 'you', 'please', 'hey', 'ok', 'okay',
  'could', 'would', 'will', 'just', 'maybe', 'actually', 'so', 'well',
]);

// ─── Command Grammar (03-UI-Spec.md §9) ─────────────────────────────────
//
// Each entry: [regex pattern, actionName, paramGroup]
// The regex is tested against the cleaned transcript.
// paramGroup (1 or 2) indicates which capture group holds the parameter.

const COMMANDS = [
  // ── Navigation ─────────────────────────────────────────────────────
  { pattern: /show me (.+)/i,            action: 'showCluster',    paramIdx: 1 },
  { pattern: /where(?: is|'s| are|'re)? (.+)/i, action: 'flyToNode', paramIdx: 1 },
  { pattern: /find (.+)/i,               action: 'flyToNode',      paramIdx: 1 },
  { pattern: /go home/i,                 action: 'flyToOrigin',    paramIdx: null },
  { pattern: /(?:go|fly|move) to origin/i, action: 'flyToOrigin',  paramIdx: null },

  // ── Dependencies ───────────────────────────────────────────────────
  { pattern: /depend(?:encies|ents|s) of (.+)/i, action: 'showDeps', paramIdx: 1 },
  { pattern: /what depends on (.+)/i,    action: 'showDependents', paramIdx: 1 },
  { pattern: /what does (.+) depend on/i, action: 'showDeps',      paramIdx: 1 },

  // ── Filters ────────────────────────────────────────────────────────
  { pattern: /hide tests?/i,             action: 'hideTests',      paramIdx: null },
  { pattern: /show tests?/i,             action: 'showTests',      paramIdx: null },
  { pattern: /show all/i,                action: 'showAll',        paramIdx: null },
  { pattern: /reset/i,                   action: 'showAll',        paramIdx: null },

  // ── Agent / Queries ────────────────────────────────────────────────
  { pattern: /ask agent about this/i,    action: 'askAgent',       paramIdx: null },
  { pattern: /ask agent/i,               action: 'askAgent',       paramIdx: null },
  { pattern: /find similar(?: files)?/i, action: 'findSimilar',    paramIdx: null },

  // ── Desktop / Save ─────────────────────────────────────────────────
  { pattern: /open in (?:vs code|editor)/i, action: 'openInEditor', paramIdx: null },
  { pattern: /save(?: current)? views?/i,   action: 'saveView',     paramIdx: null },

  // ── Help ───────────────────────────────────────────────────────────
  { pattern: /help/i,                    action: 'help',           paramIdx: null },
  { pattern: /what can I say/i,          action: 'help',           paramIdx: null },
];

// ─── Keyboard Shortcuts (fallback when voice is off) ────────────────────

const KEYBOARD_SHORTCUTS = {
  'KeyH': { action: 'hideTests',  label: 'Hide tests' },
  'KeyS': { action: 'showAll',    label: 'Show all' },
  'KeyR': { action: 'flyToOrigin', label: 'Return to origin' },
};

// ─── Toast Constants (03-UI-Spec.md §8) ────────────────────────────────

const TOAST_DURATION = 2000;   // ms
const TOAST_FADE_IN = 150;    // ms
const TOAST_FADE_OUT = 300;   // ms

// ═════════════════════════════════════════════════════════════════════════
//  VoiceCommands
// ═════════════════════════════════════════════════════════════════════════

class VoiceCommands {
  /**
   * @param {object}   [options]
   * @param {boolean}  [options.enabled=true]  — Voice recognition on by default
   * @param {number}   [options.confidenceThreshold=0.7]
   * @param {Function} [options.onCommand]     — Callback for parsed commands
   * @param {Function} [options.onToast]       — Callback for toast messages
   * @param {Function} [options.onError]       — Callback for errors
   */
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.confidenceThreshold = options.confidenceThreshold ?? 0.7;
    this._onCommand = options.onCommand || null;
    this._onToast = options.onToast || null;
    this._onError = options.onError || null;

    /** @type {SpeechRecognition|null} */
    this._recognition = null;

    /** @type {boolean} Whether the Speech API was initialised. */
    this._initialised = false;

    /** @type {boolean} Whether we've requested microphone permission. */
    this._permissionRequested = false;

    /** @type {boolean} Whether speech is currently listening. */
    this._listening = false;

    /** @type {HTMLElement|null} Toast DOM element. */
    this._toastEl = null;

    /** @type {number|null} Toast timeout ID. */
    this._toastTimeout = null;

    /** @type {boolean} Keyboard shortcut flag. */
    this._keyboardEnabled = true;

    /** @type {Function} Bound keydown handler. */
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  INITIALISATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialise the SpeechRecognition engine.
   * Must be called from a user gesture (click/tap) for microphone permission.
   *
   * @returns {Promise<boolean>} Whether initialisation succeeded
   */
  async init() {
    if (this._initialised) return true;
    if (!this.enabled) return false;

    // Check Speech API availability
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[VR] SpeechRecognition not available in this browser');
      this._fallbackToKeyboard();
      return false;
    }

    try {
      this._recognition = new SpeechRecognition();
      this._recognition.continuous = false;
      this._recognition.interimResults = false;
      this._recognition.lang = 'en-US';
      this._recognition.maxAlternatives = 1;

      this._attachRecognitionHandlers();
      this._initialised = true;

      // Register keyboard shortcuts
      this._registerKeyboardShortcuts();

      console.log('[VR] Voice commands initialised');
      return true;
    } catch (err) {
      console.warn('[VR] SpeechRecognition init failed:', err);
      this._fallbackToKeyboard();
      return false;
    }
  }

  /**
   * Request microphone permission explicitly.
   * Creates a temporary MediaStream to trigger the browser prompt.
   *
   * @returns {Promise<boolean>}
   */
  async requestMicrophonePermission() {
    if (this._permissionRequested) return true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop all tracks — we only needed permission
      stream.getTracks().forEach((t) => t.stop());
      this._permissionRequested = true;
      return true;
    } catch (err) {
      console.warn('[VR] Microphone permission denied:', err.message);
      this._showToast('Microphone access denied. Using keyboard shortcuts.', 'error');
      this._fallbackToKeyboard();
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  LISTENING CONTROL
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Start listening for voice commands.
   * One-shot per utterance (continuous: false).
   */
  start() {
    if (!this._recognition || !this._initialised || this._listening) return;
    try {
      this._recognition.start();
      this._listening = true;
    } catch (err) {
      console.warn('[VR] Recognition start failed:', err);
      this._listening = false;
    }
  }

  /**
   * Stop listening.
   */
  stop() {
    if (!this._recognition || !this._listening) return;
    try {
      this._recognition.stop();
    } catch { /* ignore */ }
    this._listening = false;
  }

  /**
   * Toggle voice on/off.
   *
   * @returns {boolean} New enabled state
   */
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.start();
    } else {
      this.stop();
    }
    this._showToast(
      this.enabled ? 'Voice commands on' : 'Voice commands off',
      'info'
    );
    return this.enabled;
  }

  /**
   * Enable or disable voice.
   *
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  COMMAND PARSER (§9 Grammar)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Parse a transcript against the command grammar.
   *
   * Steps (03-UI-Spec.md §9.1):
   *   1. Lowercase the transcript
   *   2. Strip filler words
   *   3. Try each pattern in order
   *   4. If matched, extract the parameter group
   *   5. Return { action, param } or null
   *
   * @param {string} transcript  — Raw speech transcript
   * @returns {object|null} { action: string, param?: string }
   */
  parseCommand(transcript) {
    if (!transcript || typeof transcript !== 'string') return null;

    // Step 1: lowercase
    let cleaned = transcript.trim().toLowerCase();

    // Step 2: strip filler words
    const words = cleaned.split(/\s+/).filter((w) => !FILLER_WORDS.has(w));
    cleaned = words.join(' ');

    // Step 3: try each pattern
    for (const { pattern, action, paramIdx } of COMMANDS) {
      const match = cleaned.match(pattern);
      if (match) {
        const param = paramIdx !== null ? match[paramIdx].trim() : undefined;
        return { action, param };
      }
    }

    return null;
  }

  /**
   * Execute a parsed command: emit the action and show feedback.
   *
   * @param {object}   command      — { action, param }
   * @param {string}   command.action
   * @param {string}   [command.param]
   * @param {number}   [confidence=1.0]  — Recognition confidence
   * @param {string}   [rawTranscript]   — For toast display
   */
  executeCommand(command, confidence = 1.0, rawTranscript = '') {
    if (!command) return;

    // Confidence check
    if (confidence < this.confidenceThreshold) {
      this._showToast("Didn't catch that — please try again", 'warning');
      return;
    }

    // Build a friendly label for the toast
    const label = command.param
      ? `${this._actionLabel(command.action)}: "${command.param}"`
      : this._actionLabel(command.action);

    // Show toast feedback
    this._showToast(`🎤 ${label}`, 'success');

    // Emit the command
    if (this._onCommand) {
      this._onCommand(command.action, command.param);
    }

    // Start listening for the next command (one-shot mode)
    setTimeout(() => this.start(), 300);
  }

  /**
   * Map action name to a user-facing label.
   */
  _actionLabel(action) {
    const labels = {
      showCluster:    'Showing cluster',
      flyToNode:      'Navigating to',
      flyToOrigin:    'Returning to centre',
      showDeps:       'Showing dependencies',
      showDependents: 'Showing dependents',
      hideTests:      'Hiding tests',
      showTests:      'Showing tests',
      showAll:        'Showing all nodes',
      askAgent:       'Asking agent',
      findSimilar:    'Finding similar files',
      openInEditor:   'Opening in VS Code',
      saveView:       'Saving view',
      help:           'Opening voice help',
    };
    return labels[action] || action;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SPEECH RECOGNITION EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Attach result, error, and end handlers to the recognition instance.
   */
  _attachRecognitionHandlers() {
    if (!this._recognition) return;

    this._recognition.onresult = (event) => {
      this._listening = false;

      if (event.results.length === 0) return;

      const result = event.results[0];
      const transcript = result[0].transcript;
      const confidence = result[0].confidence;

      const command = this.parseCommand(transcript);
      if (command) {
        this.executeCommand(command, confidence, transcript);
      } else {
        // No match — show a hint
        this._showToast("Didn't catch that — try 'help'", 'warning');
        // Still re-start listening
        setTimeout(() => this.start(), 500);
      }
    };

    this._recognition.onerror = (event) => {
      this._listening = false;

      if (event.error === 'no-speech') {
        // Silent — just restart
        setTimeout(() => this.start(), 200);
        return;
      }

      if (event.error === 'aborted' || event.error === 'not-allowed') {
        console.warn(`[VR] Recognition error: ${event.error}`);
        if (this._onError) this._onError(event.error);
        return;
      }

      console.warn(`[VR] Recognition error: ${event.error}`);
      setTimeout(() => this.start(), 500);
    };

    this._recognition.onend = () => {
      this._listening = false;
      // Auto-restart if still enabled
      if (this.enabled) {
        setTimeout(() => this.start(), 100);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  KEYBOARD SHORTCUT FALLBACK
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Register keyboard shortcut listeners.
   */
  _registerKeyboardShortcuts() {
    document.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * Handle keyboard shortcuts.
   * Ctrl+Shift+<key> to match YodaMan conventions.
   */
  _onKeyDown(event) {
    if (!this._keyboardEnabled || !event.ctrlKey || !event.shiftKey) return;

    const shortcut = KEYBOARD_SHORTCUTS[event.code];
    if (!shortcut) return;

    event.preventDefault();

    // Execute like a voice command
    const command = { action: shortcut.action, param: undefined };
    this.executeCommand(command, 1.0, `[keyboard] ${shortcut.label}`);
  }

  /**
   * Fall back to keyboard shortcuts when voice is unavailable.
   */
  _fallbackToKeyboard() {
    this._keyboardEnabled = true;
    this._registerKeyboardShortcuts();
    this._showToast('Voice unavailable. Using keyboard shortcuts (Ctrl+Shift+H/S/R).', 'info');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  TOAST UI FEEDBACK
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Show a toast notification.
   *
   * If an external onToast callback is provided, it is called instead.
   * Otherwise a DOM-based toast is rendered.
   *
   * @param {string} message
   * @param {'success'|'warning'|'error'|'info'} level
   */
  _showToast(message, level = 'info') {
    // External callback
    if (this._onToast) {
      this._onToast(message, level);
      return;
    }

    // DOM-based toast
    this._removeToast();

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: rgba(13, 13, 26, 0.92);
      border: 1px solid ${this._toastBorderColor(level)};
      border-radius: 8px; padding: 10px 20px;
      color: #e8e8f0; font: 13px/1.5 Inter, system-ui, sans-serif;
      backdrop-filter: blur(8px);
      z-index: 10000; pointer-events: none;
      opacity: 0; transition: opacity ${TOAST_FADE_IN}ms ease-out;
    `;

    document.body.appendChild(toast);
    this._toastEl = toast;

    // Fade in
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    // Fade out after duration
    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = `opacity ${TOAST_FADE_OUT}ms ease-in`;
      setTimeout(() => this._removeToast(), TOAST_FADE_OUT);
    }, TOAST_DURATION);
  }

  /**
   * Border colour for toast level.
   */
  _toastBorderColor(level) {
    const colors = {
      success: 'rgba(78, 205, 196, 0.5)',
      warning: 'rgba(255, 140, 66, 0.5)',
      error:   'rgba(255, 68, 68, 0.5)',
      info:    'rgba(124, 106, 247, 0.4)',
    };
    return colors[level] || colors.info;
  }

  /**
   * Remove the toast DOM element.
   */
  _removeToast() {
    if (this._toastTimeout) { clearTimeout(this._toastTimeout); this._toastTimeout = null; }
    if (this._toastEl) {
      if (this._toastEl.parentNode) this._toastEl.parentNode.removeChild(this._toastEl);
      this._toastEl = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CLEANUP
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Stop recognition and clean up.
   */
  dispose() {
    this.stop();
    this._removeToast();
    document.removeEventListener('keydown', this._onKeyDown);
    this._recognition = null;
    this._initialised = false;
    this._listening = false;
    this._onCommand = null;
    this._onToast = null;
    this._onError = null;
  }
}

export default VoiceCommands;
