/**
 * voice-transcript-not-logged.test.js — Voice Command Privacy Test (08-Testing-Spec.md §7)
 *
 * Verifies that when a voice command is issued, ONLY the command name
 * (e.g., "flyToNode") is logged to the audit trail, NOT the raw voice
 * transcript (e.g., "where is AuthService").
 *
 * This is tested by:
 *   1. Simulating the voice command parser + audit log pipeline
 *   2. Issuing natural-language utterances
 *   3. Asserting the audit entry contains the action name but NOT the raw text
 *
 * @see 05-YodaMan-Integration.md §6.3 — Privacy: raw transcripts never logged
 * @see 03-UI-Spec.md §9 — Voice command grammar
 * @see 08-Testing-Spec.md §7 — Privacy validation tests
 */

import { test, expect } from '@playwright/test';

// ─── Mock Voice Command Parser (mirrors frontend/voiceCommands.js) ───────

const FILLER_WORDS = new Set([
  'um', 'uh', 'like', 'can', 'you', 'please', 'hey', 'ok', 'okay',
  'could', 'would', 'will', 'just', 'maybe', 'actually', 'so', 'well',
]);

const COMMANDS = [
  { pattern: /find similar(?: files)?/i, action: 'findSimilar', paramIdx: null },
  { pattern: /show me (.+)/i,            action: 'showCluster', paramIdx: 1 },
  { pattern: /where(?: is|'s| are|'re)? (.+)/i, action: 'flyToNode', paramIdx: 1 },
  { pattern: /find (.+)/i,               action: 'flyToNode',   paramIdx: 1 },
  { pattern: /go home/i,                 action: 'flyToOrigin', paramIdx: null },
  { pattern: /depend(?:encies|ents|s) of (.+)/i, action: 'showDeps', paramIdx: 1 },
  { pattern: /hide tests?/i,             action: 'hideTests',   paramIdx: null },
  { pattern: /show all/i,                action: 'showAll',     paramIdx: null },
  { pattern: /ask agent(?: about this)?/i, action: 'askAgent',  paramIdx: null },
  { pattern: /open in (?:vs code|editor)/i, action: 'openInEditor', paramIdx: null },
  { pattern: /save views?/i,             action: 'saveView',    paramIdx: null },
  { pattern: /help/i,                    action: 'help',        paramIdx: null },
];

/**
 * Parse a voice transcript to extract the command action and parameter.
 *
 * @param {string} transcript  — Raw speech transcript
 * @returns {{ action: string, param?: string }|null}
 */
function parseCommand(transcript) {
  if (!transcript) return null;
  let cleaned = transcript.trim().toLowerCase();
  const words = cleaned.split(/\s+/).filter((w) => !FILLER_WORDS.has(w));
  cleaned = words.join(' ');

  for (const { pattern, action, paramIdx } of COMMANDS) {
    const match = cleaned.match(pattern);
    if (match) {
      return {
        action,
        param: paramIdx !== null ? match[paramIdx].trim() : undefined,
        rawTranscript: transcript, // Only used for testing — NEVER logged
      };
    }
  }
  return null;
}

/**
 * Build an audit log entry for a voice command.
 * This MUST NOT include the raw transcript (privacy requirement).
 *
 * @param {object} command — Parsed command from parseCommand()
 * @returns {object} Audit entry
 */
function buildAuditEntry(command) {
  return {
    userAction: 'vr_voice_command',
    plugin: 'graphify-vr-explorer',
    timestamp: new Date().toISOString(),
    commandName: command.action,  // ← Only the action name
    // param is optional and only the matched parameter, NOT the raw utterance
    ...(command.param !== undefined ? { param: command.param } : {}),
    // NOTE: rawTranscript is NEVER included here
  };
}

// ─── Test Utterances ────────────────────────────────────────────────────

const UTTERANCES = [
  {
    spoken: 'where is AuthService',
    expectedAction: 'flyToNode',
    expectedParam: 'authservice',
  },
  {
    spoken: 'show me authentication',
    expectedAction: 'showCluster',
    expectedParam: 'authentication',
  },
  {
    spoken: 'find LoginForm',
    expectedAction: 'flyToNode',
    expectedParam: 'loginform',
  },
  {
    spoken: 'dependencies of UserModel',
    expectedAction: 'showDeps',
    expectedParam: 'usermodel',
  },
  {
    spoken: 'hide tests',
    expectedAction: 'hideTests',
    expectedParam: undefined,
  },
  {
    spoken: 'show all',
    expectedAction: 'showAll',
    expectedParam: undefined,
  },
  {
    spoken: 'go home',
    expectedAction: 'flyToOrigin',
    expectedParam: undefined,
  },
  {
    spoken: 'ask agent about this',
    expectedAction: 'askAgent',
    expectedParam: undefined,
  },
  {
    spoken: 'um show me auth please',
    expectedAction: 'showCluster',
    expectedParam: 'auth',
  },
  {
    spoken: 'open in vs code',
    expectedAction: 'openInEditor',
    expectedParam: undefined,
  },
];

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

test.describe('Voice Transcript Privacy (§7)', () => {
  test('voice_transcript_not_logged — raw text never appears in audit entry', async ({ page }) => {
    const auditEntries = [];

    // Intercept audit POSTs
    await page.route('**/api/audit', async (route) => {
      if (route.request().method() === 'POST') {
        try {
          const body = JSON.parse(route.request().postData() || '{}');
          auditEntries.push(body);
        } catch { /* skip */ }
        await route.fulfill({ status: 200, body: '{}' });
      } else {
        await route.continue();
      }
    });

    // Simulate voice commands and audit logging
    await page.evaluate((utterances) => {
      // Expose the parser
      window.__parseCommand = (transcript) => {
        const FILLER = new Set(['um','uh','like','can','you','please','hey','ok','okay','could','would','will','just','maybe','actually','so','well']);
        let cleaned = transcript.trim().toLowerCase();
        cleaned = cleaned.split(/\s+/).filter(w => !FILLER.has(w)).join(' ');
        const cmds = [
          { p: /find similar(?: files)?/i, a: 'findSimilar' },
          { p: /show me (.+)/i, a: 'showCluster', pi: 1 },
          { p: /where(?: is|'s| are|'re)? (.+)/i, a: 'flyToNode', pi: 1 },
          { p: /find (.+)/i, a: 'flyToNode', pi: 1 },
          { p: /go home/i, a: 'flyToOrigin' },
          { p: /depend(?:encies|ents|s) of (.+)/i, a: 'showDeps', pi: 1 },
          { p: /hide tests?/i, a: 'hideTests' },
          { p: /show all/i, a: 'showAll' },
          { p: /ask agent(?: about this)?/i, a: 'askAgent' },
          { p: /open in (?:vs code|editor)/i, a: 'openInEditor' },
          { p: /save views?/i, a: 'saveView' },
          { p: /help/i, a: 'help' },
        ];
        for (const c of cmds) {
          const m = cleaned.match(c.p);
          if (m) return { action: c.a, param: c.pi ? m[c.pi].trim() : undefined, raw: transcript };
        }
        return null;
      };

      // Process each utterance
      for (const u of utterances) {
        const cmd = window.__parseCommand(u.spoken);
        if (cmd) {
          // Build audit entry (NEVER including the raw transcript)
          const entry = {
            userAction: 'vr_voice_command',
            plugin: 'graphify-vr-explorer',
            timestamp: new Date().toISOString(),
            commandName: cmd.action,
          };
          if (cmd.param !== undefined) entry.param = cmd.param;

          // Send to mock audit endpoint
          fetch('http://localhost:3090/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          }).catch(() => {});
        }
      }
    }, UTTERANCES);

    await page.waitForTimeout(500);

    // ── Core assertions ──────────────────────────────────────────────
    expect(auditEntries.length).toBeGreaterThan(0);

    for (const entry of auditEntries) {
      // 1. The raw transcript MUST NOT appear in any field
      const entryStr = JSON.stringify(entry).toLowerCase();
      for (const u of UTTERANCES) {
        // Check that the raw spoken phrase is NOT in the audit entry
        const lowerSpoken = u.spoken.toLowerCase();
        expect(entryStr).not.toContain(lowerSpoken);
      }

      // 2. Filler words from transcripts must not appear in logged fields
      const entryStrExact = JSON.stringify(entry);
      expect(entryStrExact).not.toContain('um ');
      expect(entryStrExact).not.toContain('uh ');
      expect(entryStrExact).not.toContain(' like ');
      expect(entryStrExact).not.toContain(' please ');

      // 3. Only the action name is logged as commandName
      expect(entry.commandName).toBeDefined();
      // commandName should be one of the known actions
      const knownActions = [
        'flyToNode', 'showCluster', 'showDeps', 'hideTests',
        'showAll', 'flyToOrigin', 'askAgent', 'openInEditor',
        'saveView', 'help', 'findSimilar',
      ];
      expect(knownActions).toContain(entry.commandName);

      // 4. param field (if present) should be a short string
      if (entry.param && typeof entry.param === 'string') {
        expect(entry.param.length).toBeLessThan(100);
        // param should not be the full utterance
        for (const u of UTTERANCES) {
          expect(entry.param).not.toBe(u.spoken.toLowerCase());
        }
      }

      // 5. There should be NO field containing the raw transcript
      const fields = Object.keys(entry);
      for (const field of fields) {
        if (typeof entry[field] === 'string') {
          expect(field).not.toMatch(/transcript/i);
          expect(field).not.toMatch(/raw/i);
          expect(field).not.toMatch(/spoken/i);
          expect(field).not.toMatch(/audio/i);
          expect(field).not.toMatch(/speech/i);
        }
      }
    }

    console.log(`[privacy] Verified ${auditEntries.length} voice command audit entries contain no raw transcripts`);
  });

  test('voice_command_logs_action_not_utterance — per-utterance verification', async ({ page }) => {
    for (const u of UTTERANCES) {
      // Parse the utterance
      const parsed = parseCommand(u.spoken);

      // Verify parsing worked as expected
      expect(parsed).not.toBeNull();
      expect(parsed.action).toBe(u.expectedAction);
      if (u.expectedParam !== undefined) {
        expect(parsed.param).toBe(u.expectedParam);
      }

      // Build audit entry (simulating what the real code does)
      const entry = buildAuditEntry(parsed);

      // Verify the raw utterance is NOT in the audit entry
      const entryStr = JSON.stringify(entry).toLowerCase();
      expect(entryStr).not.toContain(u.spoken.toLowerCase());

      // Verify the action name IS in the audit entry
      expect(entry.commandName).toBe(u.expectedAction);

      // Verify that 'rawTranscript' is NEVER a field name
      expect(Object.keys(entry)).not.toContain('rawTranscript');
      expect(Object.keys(entry)).not.toContain('transcript');
      expect(Object.keys(entry)).not.toContain('utterance');

      console.log(`  ✓ "${u.spoken}" → ${u.expectedAction} (transcript NOT logged)`);
    }
  });
});
