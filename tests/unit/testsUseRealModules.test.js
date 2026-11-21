/**
 * Guard: unit tests check the shipped modules, never copies of them.
 *
 * voiceCommands.test.js once tested its own copy of the grammar. The copy
 * passed while the real parser could never match "find similar" or
 * "what can I say". A copy keeps passing after the original breaks.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UNIT = join(root, 'tests', 'unit');
const read = (dir) => readdirSync(dir).filter((f) => /\.(m?js|jsx)$/.test(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);

/** Tests that check repository files rather than a module's behaviour. */
const FILE_CHECKS = new Set(['ciWorkflow.test.js', 'testsUseRealModules.test.js', 'manifestPaths.test.js', 'buildReach.test.js']);

const sources = [...read(join(root, 'frontend')), ...read(join(root, 'backend'))];
const sourceNames = new Set(sources.flatMap(([, code]) => [
  ...[...code.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  ...[...code.matchAll(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]),
]));
const tests = readdirSync(UNIT).filter((f) => /\.test\.m?js$/.test(f)).map((f) => [f, readFileSync(join(UNIT, f), 'utf8')]);

test.each(tests.filter(([f]) => !FILE_CHECKS.has(f)))('%s imports a module under frontend/ or backend/', (_f, code) => {
  // .jsx modules come in through helpers/loadJsx.js.
  expect(code).toMatch(/(?:from|import\()\s*['"`]\.\.\/\.\.\/(?:frontend|backend)\/|loadJsx\(['"`](?:frontend|backend)\//);
});

test.each(tests)('%s redeclares nothing a shipped module declares', (_f, code) => {
  // Functions, classes, and constants holding a literal or a function: the shapes a copy takes.
  const declared = [...code.matchAll(/^(?:(?:async\s+)?function\s+|class\s+|(?:const|let)\s+(?=[\w$]+\s*=\s*(?:[[{'"`\d/]|new\s|Object\.|(?:async\s*)?\()))([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  expect(declared.filter((name) => sourceNames.has(name))).toEqual([]);
});
