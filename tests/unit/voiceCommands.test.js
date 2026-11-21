/**
 * voiceCommands.test.js — Voice Command Parser Unit Tests
 *
 * Tests the shipped parser in frontend/voiceCommands.js. This file used to
 * test its own copy of the grammar, so "find similar" and "what can I say"
 * passed here while the real parser could never match them.
 *
 * @see 03-UI-Spec.md §9   — Command grammar
 */
import VoiceCommands from '../../frontend/voiceCommands.js';

const voice = new VoiceCommands({ enabled: false });
const parse = (transcript) => voice.parseCommand(transcript);

// ═════════════════════════════════════════════════════════════════════════
//  TESTS
// ═════════════════════════════════════════════════════════════════════════

describe('Voice Command Parser (§9)', () => {
  // ── Navigation ───────────────────────────────────────────────────────

  test('matches_show_me_command — "show me authentication" → showCluster', () => {
    const result = parse('show me authentication');
    expect(result).toEqual({ action: 'showCluster', param: 'authentication' });
  });

  test('matches_where_is_command — "where is AuthService" → flyToNode', () => {
    const result = parse('where is AuthService');
    expect(result).toEqual({ action: 'flyToNode', param: 'authservice' });
  });

  test('matches_where_is_contraction — "where\'s AuthService" → flyToNode', () => {
    const result = parse("where's AuthService");
    expect(result).toEqual({ action: 'flyToNode', param: 'authservice' });
  });

  test('matches_find_command — "find LoginForm" → flyToNode', () => {
    const result = parse('find LoginForm');
    expect(result).toEqual({ action: 'flyToNode', param: 'loginform' });
  });

  test('matches_go_home_command — "go home" → flyToOrigin', () => {
    const result = parse('go home');
    expect(result).toEqual({ action: 'flyToOrigin', param: undefined });
  });

  test('matches_fly_to_origin — "fly to origin" → flyToOrigin', () => {
    const result = parse('fly to origin');
    expect(result).toEqual({ action: 'flyToOrigin', param: undefined });
  });

  // ── Dependencies ─────────────────────────────────────────────────────

  test('matches_dependencies_command — "dependencies of UserModel" → showDeps', () => {
    const result = parse('dependencies of UserModel');
    expect(result).toEqual({ action: 'showDeps', param: 'usermodel' });
  });

  test('matches_dependents_command — "dependents of AuthService" → showDeps', () => {
    const result = parse('dependents of AuthService');
    expect(result).toEqual({ action: 'showDeps', param: 'authservice' });
  });

  test('matches_deps_short — "deps of Login" → showDeps', () => {
    const result = parse('deps of Login');
    expect(result).toEqual({ action: 'showDeps', param: 'login' });
  });

  test('matches_what_depends_on — "what depends on User" → showDependents', () => {
    const result = parse('what depends on User');
    expect(result).toEqual({ action: 'showDependents', param: 'user' });
  });

  test('matches_what_does_depend_on — "what does AuthService depend on" → showDeps', () => {
    const result = parse('what does AuthService depend on');
    expect(result).toEqual({ action: 'showDeps', param: 'authservice' });
  });

  // ── Filters ──────────────────────────────────────────────────────────

  test('matches_hide_tests_command — "hide tests" → hideTests', () => {
    const result = parse('hide tests');
    expect(result).toEqual({ action: 'hideTests', param: undefined });
  });

  test('matches_hide_test_singular — "hide test" → hideTests', () => {
    const result = parse('hide test');
    expect(result).toEqual({ action: 'hideTests', param: undefined });
  });

  test('matches_show_tests_command — "show tests" → showTests', () => {
    const result = parse('show tests');
    expect(result).toEqual({ action: 'showTests', param: undefined });
  });

  test('matches_show_all_command — "show all" → showAll', () => {
    const result = parse('show all');
    expect(result).toEqual({ action: 'showAll', param: undefined });
  });

  test('matches_reset_command — "reset" → showAll', () => {
    const result = parse('reset');
    expect(result).toEqual({ action: 'showAll', param: undefined });
  });

  // ── Agent / Queries ──────────────────────────────────────────────────

  test('matches_ask_agent_about_this — "ask agent about this" → askAgent', () => {
    const result = parse('ask agent about this');
    expect(result).toEqual({ action: 'askAgent', param: undefined });
  });

  test('matches_ask_agent_short — "ask agent" → askAgent', () => {
    const result = parse('ask agent');
    expect(result).toEqual({ action: 'askAgent', param: undefined });
  });

  test('matches_find_similar — "find similar files" → findSimilar', () => {
    const result = parse('find similar files');
    expect(result).toEqual({ action: 'findSimilar', param: undefined });
  });

  test('matches_find_similar_short — "find similar" → findSimilar', () => {
    const result = parse('find similar');
    expect(result).toEqual({ action: 'findSimilar', param: undefined });
  });

  // ── Desktop / Save ───────────────────────────────────────────────────

  test('matches_open_in_vs_code — "open in vs code" → openInEditor', () => {
    const result = parse('open in vs code');
    expect(result).toEqual({ action: 'openInEditor', param: undefined });
  });

  test('matches_open_in_editor — "open in editor" → openInEditor', () => {
    const result = parse('open in editor');
    expect(result).toEqual({ action: 'openInEditor', param: undefined });
  });

  test('matches_save_view — "save view" → saveView', () => {
    const result = parse('save view');
    expect(result).toEqual({ action: 'saveView', param: undefined });
  });

  // ── Help ─────────────────────────────────────────────────────────────

  test('matches_help — "help" → help', () => {
    const result = parse('help');
    expect(result).toEqual({ action: 'help', param: undefined });
  });

  test('matches_what_can_i_say — "what can I say" → help (even with "can" stripped as a filler)', () => {
    const result = parse('what can I say');
    expect(result).toEqual({ action: 'help', param: undefined });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────

  test('rejects_low_confidence — ignore via app logic (parser accepts all)', () => {
    // The parser itself doesn't check confidence — that's the caller's job
    // This test verifies the parser still returns a result for any input
    const result = parse('show me auth');
    expect(result).not.toBeNull();
    expect(result.action).toBe('showCluster');
  });

  test('strips_filler_words — "um show me auth please" → showCluster(auth)', () => {
    const result = parse('um show me auth please');
    expect(result).toEqual({ action: 'showCluster', param: 'auth' });
  });

  test('strips_multiple_fillers — "hey can you um please show me config" → showCluster(config)', () => {
    const result = parse('hey can you um please show me config');
    expect(result).toEqual({ action: 'showCluster', param: 'config' });
  });

  test('case_insensitive — "WHERE IS AUTHSERVICE" → flyToNode(authservice)', () => {
    const result = parse('WHERE IS AUTHSERVICE');
    expect(result).toEqual({ action: 'flyToNode', param: 'authservice' });
  });

  test('case_insensitive_mixed — "ShoW Me Auth" → showCluster(auth)', () => {
    const result = parse('ShoW Me Auth');
    expect(result).toEqual({ action: 'showCluster', param: 'auth' });
  });

  test('returns_null_for_unknown — "tell me a joke" → null', () => {
    const result = parse('tell me a joke');
    expect(result).toBeNull();
  });

  test('returns_null_for_empty — "" → null', () => {
    expect(parse('')).toBeNull();
  });

  test('returns_null_for_whitespace — "   " → null', () => {
    expect(parse('   ')).toBeNull();
  });

  test('returns_null_for_null', () => {
    expect(parse(null)).toBeNull();
  });

  test('returns_null_for_undefined', () => {
    expect(parse(undefined)).toBeNull();
  });

  test('handles_extra_whitespace — "  show  me   auth  " → showCluster(auth)', () => {
    const result = parse('  show  me   auth  ');
    expect(result).toEqual({ action: 'showCluster', param: 'auth' });
  });

  test('first_match_wins — "find tests" → flyToNode (not hideTests)', () => {
    // "find tests" should match "find (.+)" before "hide tests?"
    const result = parse('find tests');
    expect(result).toEqual({ action: 'flyToNode', param: 'tests' });
  });

  test('strip_filler_preserves_meaningful_words — "so where is the main file" → flyToNode(the main file)', () => {
    // Filler: "so" → removed. "where is" matches. Param: "the main file"
    const result = parse('so where is the main file');
    expect(result).toEqual({ action: 'flyToNode', param: 'the main file' });
  });
});
