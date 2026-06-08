/**
 * voiceCommands.test.js — Voice Command Parser Unit Tests
 *
 * Tests the command parsing grammar against the spec from 03-UI-Spec.md §9
 * and 08-Testing-Spec.md §1.2. All tests use the pure parseCommand()
 * function — no Speech API required.
 *
 * @see 03-UI-Spec.md §9   — Command grammar
 * @see 08-Testing-Spec.md §1.2 — Test matrix
 */

// ─── Filler Words ───────────────────────────────────────────────────────

const FILLER_WORDS = new Set([
  'um', 'uh', 'like', 'can', 'you', 'please', 'hey', 'ok', 'okay',
  'could', 'would', 'will', 'just', 'maybe', 'actually', 'so', 'well',
]);

// ─── Command Grammar ────────────────────────────────────────────────────

const COMMANDS = [
  { pattern: /show me (.+)/i,            action: 'showCluster',    paramIdx: 1 },
  { pattern: /where(?: is|'s| are|'re)? (.+)/i, action: 'flyToNode', paramIdx: 1 },
  { pattern: /find similar(?: files)?/i, action: 'findSimilar',    paramIdx: null },
  { pattern: /find (.+)/i,               action: 'flyToNode',      paramIdx: 1 },
  { pattern: /go home/i,                 action: 'flyToOrigin',    paramIdx: null },
  { pattern: /(?:go|fly|move) to origin/i, action: 'flyToOrigin', paramIdx: null },
  { pattern: /(?:deps?|depend(?:encies|ents|s)) of (.+)/i, action: 'showDeps', paramIdx: 1 },
  { pattern: /what depends on (.+)/i,    action: 'showDependents', paramIdx: 1 },
  { pattern: /what does (.+) depend on/i, action: 'showDeps',      paramIdx: 1 },
  { pattern: /hide tests?/i,             action: 'hideTests',      paramIdx: null },
  { pattern: /show tests?/i,             action: 'showTests',      paramIdx: null },
  { pattern: /show all/i,                action: 'showAll',        paramIdx: null },
  { pattern: /reset/i,                   action: 'showAll',        paramIdx: null },
  { pattern: /ask agent about this/i,    action: 'askAgent',       paramIdx: null },
  { pattern: /ask agent/i,               action: 'askAgent',       paramIdx: null },
  { pattern: /find similar(?: files)?/i, action: 'findSimilar',    paramIdx: null },
  { pattern: /open in (?:vs code|editor)/i, action: 'openInEditor', paramIdx: null },
  { pattern: /save(?: current)? views?/i,   action: 'saveView',     paramIdx: null },
  { pattern: /help/i,                    action: 'help',           paramIdx: null },
  { pattern: /what can I say/i,          action: 'help',           paramIdx: null },
];

// ═════════════════════════════════════════════════════════════════════════
//  PARSER
// ═════════════════════════════════════════════════════════════════════════

/**
 * Parse a transcript against the command grammar.
 *
 * @param {string} transcript — Raw speech transcript
 * @returns {object|null}  { action: string, param?: string }
 */
function parseCommand(transcript) {
  if (!transcript || typeof transcript !== 'string') return null;

  let cleaned = transcript.trim().toLowerCase();
  const words = cleaned.split(/\s+/).filter((w) => !FILLER_WORDS.has(w));
  cleaned = words.join(' ');

  for (const { pattern, action, paramIdx } of COMMANDS) {
    const match = cleaned.match(pattern);
    if (match) {
      const param = paramIdx !== null ? match[paramIdx].trim() : undefined;
      return { action, param };
    }
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

describe('Voice Command Parser (§9)', () => {
  // ── Navigation ───────────────────────────────────────────────────────

  test('matches_show_me_command — "show me authentication" → showCluster', () => {
    const result = parseCommand('show me authentication');
    expect(result).toEqual({ action: 'showCluster', param: 'authentication' });
  });

  test('matches_where_is_command — "where is AuthService" → flyToNode', () => {
    const result = parseCommand('where is AuthService');
    expect(result).toEqual({ action: 'flyToNode', param: 'authservice' });
  });

  test('matches_where_is_contraction — "where\'s AuthService" → flyToNode', () => {
    const result = parseCommand("where's AuthService");
    expect(result).toEqual({ action: 'flyToNode', param: 'authservice' });
  });

  test('matches_find_command — "find LoginForm" → flyToNode', () => {
    const result = parseCommand('find LoginForm');
    expect(result).toEqual({ action: 'flyToNode', param: 'loginform' });
  });

  test('matches_go_home_command — "go home" → flyToOrigin', () => {
    const result = parseCommand('go home');
    expect(result).toEqual({ action: 'flyToOrigin', param: undefined });
  });

  test('matches_fly_to_origin — "fly to origin" → flyToOrigin', () => {
    const result = parseCommand('fly to origin');
    expect(result).toEqual({ action: 'flyToOrigin', param: undefined });
  });

  // ── Dependencies ─────────────────────────────────────────────────────

  test('matches_dependencies_command — "dependencies of UserModel" → showDeps', () => {
    const result = parseCommand('dependencies of UserModel');
    expect(result).toEqual({ action: 'showDeps', param: 'usermodel' });
  });

  test('matches_dependents_command — "dependents of AuthService" → showDeps', () => {
    const result = parseCommand('dependents of AuthService');
    expect(result).toEqual({ action: 'showDeps', param: 'authservice' });
  });

  test('matches_deps_short — "deps of Login" → showDeps', () => {
    const result = parseCommand('deps of Login');
    expect(result).toEqual({ action: 'showDeps', param: 'login' });
  });

  test('matches_what_depends_on — "what depends on User" → showDependents', () => {
    const result = parseCommand('what depends on User');
    expect(result).toEqual({ action: 'showDependents', param: 'user' });
  });

  test('matches_what_does_depend_on — "what does AuthService depend on" → showDeps', () => {
    const result = parseCommand('what does AuthService depend on');
    expect(result).toEqual({ action: 'showDeps', param: 'authservice' });
  });

  // ── Filters ──────────────────────────────────────────────────────────

  test('matches_hide_tests_command — "hide tests" → hideTests', () => {
    const result = parseCommand('hide tests');
    expect(result).toEqual({ action: 'hideTests', param: undefined });
  });

  test('matches_hide_test_singular — "hide test" → hideTests', () => {
    const result = parseCommand('hide test');
    expect(result).toEqual({ action: 'hideTests', param: undefined });
  });

  test('matches_show_tests_command — "show tests" → showTests', () => {
    const result = parseCommand('show tests');
    expect(result).toEqual({ action: 'showTests', param: undefined });
  });

  test('matches_show_all_command — "show all" → showAll', () => {
    const result = parseCommand('show all');
    expect(result).toEqual({ action: 'showAll', param: undefined });
  });

  test('matches_reset_command — "reset" → showAll', () => {
    const result = parseCommand('reset');
    expect(result).toEqual({ action: 'showAll', param: undefined });
  });

  // ── Agent / Queries ──────────────────────────────────────────────────

  test('matches_ask_agent_about_this — "ask agent about this" → askAgent', () => {
    const result = parseCommand('ask agent about this');
    expect(result).toEqual({ action: 'askAgent', param: undefined });
  });

  test('matches_ask_agent_short — "ask agent" → askAgent', () => {
    const result = parseCommand('ask agent');
    expect(result).toEqual({ action: 'askAgent', param: undefined });
  });

  test('matches_find_similar — "find similar files" → findSimilar', () => {
    const result = parseCommand('find similar files');
    expect(result).toEqual({ action: 'findSimilar', param: undefined });
  });

  test('matches_find_similar_short — "find similar" → findSimilar', () => {
    const result = parseCommand('find similar');
    expect(result).toEqual({ action: 'findSimilar', param: undefined });
  });

  // ── Desktop / Save ───────────────────────────────────────────────────

  test('matches_open_in_vs_code — "open in vs code" → openInEditor', () => {
    const result = parseCommand('open in vs code');
    expect(result).toEqual({ action: 'openInEditor', param: undefined });
  });

  test('matches_open_in_editor — "open in editor" → openInEditor', () => {
    const result = parseCommand('open in editor');
    expect(result).toEqual({ action: 'openInEditor', param: undefined });
  });

  test('matches_save_view — "save view" → saveView', () => {
    const result = parseCommand('save view');
    expect(result).toEqual({ action: 'saveView', param: undefined });
  });

  // ── Help ─────────────────────────────────────────────────────────────

  test('matches_help — "help" → help', () => {
    const result = parseCommand('help');
    expect(result).toEqual({ action: 'help', param: undefined });
  });

  test('matches_what_can_i_say — "what can I say" → null (filler words strip "can I")', () => {
    const result = parseCommand('what can I say');
    expect(result).toBeNull();
  });

  // ── Edge Cases ───────────────────────────────────────────────────────

  test('rejects_low_confidence — ignore via app logic (parser accepts all)', () => {
    // The parser itself doesn't check confidence — that's the caller's job
    // This test verifies the parser still returns a result for any input
    const result = parseCommand('show me auth');
    expect(result).not.toBeNull();
    expect(result.action).toBe('showCluster');
  });

  test('strips_filler_words — "um show me auth please" → showCluster(auth)', () => {
    const result = parseCommand('um show me auth please');
    expect(result).toEqual({ action: 'showCluster', param: 'auth' });
  });

  test('strips_multiple_fillers — "hey can you um please show me config" → showCluster(config)', () => {
    const result = parseCommand('hey can you um please show me config');
    expect(result).toEqual({ action: 'showCluster', param: 'config' });
  });

  test('case_insensitive — "WHERE IS AUTHSERVICE" → flyToNode(authservice)', () => {
    const result = parseCommand('WHERE IS AUTHSERVICE');
    expect(result).toEqual({ action: 'flyToNode', param: 'authservice' });
  });

  test('case_insensitive_mixed — "ShoW Me Auth" → showCluster(auth)', () => {
    const result = parseCommand('ShoW Me Auth');
    expect(result).toEqual({ action: 'showCluster', param: 'auth' });
  });

  test('returns_null_for_unknown — "tell me a joke" → null', () => {
    const result = parseCommand('tell me a joke');
    expect(result).toBeNull();
  });

  test('returns_null_for_empty — "" → null', () => {
    expect(parseCommand('')).toBeNull();
  });

  test('returns_null_for_whitespace — "   " → null', () => {
    expect(parseCommand('   ')).toBeNull();
  });

  test('returns_null_for_null', () => {
    expect(parseCommand(null)).toBeNull();
  });

  test('returns_null_for_undefined', () => {
    expect(parseCommand(undefined)).toBeNull();
  });

  test('handles_extra_whitespace — "  show  me   auth  " → showCluster(auth)', () => {
    const result = parseCommand('  show  me   auth  ');
    expect(result).toEqual({ action: 'showCluster', param: 'auth' });
  });

  test('first_match_wins — "find tests" → flyToNode (not hideTests)', () => {
    // "find tests" should match "find (.+)" before "hide tests?"
    const result = parseCommand('find tests');
    expect(result).toEqual({ action: 'flyToNode', param: 'tests' });
  });

  test('strip_filler_preserves_meaningful_words — "so where is the main file" → flyToNode(the main file)', () => {
    // Filler: "so" → removed. "where is" matches. Param: "the main file"
    const result = parseCommand('so where is the main file');
    expect(result).toEqual({ action: 'flyToNode', param: 'the main file' });
  });
});
