/**
 * Guard: every count the README and user manual state matches the repository.
 * The README once claimed 173 unit tests, 52 intrinsics and a 601-line manual
 * long after all three had changed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const countIn = (dir, re) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.test.js'))
  .reduce((n, f) => n + (read(join(dir, f)).match(re) || []).length, 0);
const run = (args) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const OWN_TESTS = 1; // this file's own test() calls, excluded from the nested run below
// Jest expands test.each at run time, so the unit total comes from a real run.
const unit = JSON.parse(run(['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config=jest.config.js',
  '--json', '--silent', '--testPathIgnorePatterns', 'readmeCounts'])).numTotalTests + OWN_TESTS;
const integration = countIn('tests/integration', /^\s*test\(/gm);
const privacy = countIn('tests/privacy', /^\s*test\(/gm);
const wasmSuite = Number(run(['scripts/test-wasm.mjs']).match(/(\d+)\/\d+ tests passed/)[1]);

const actual = {
  'unit tests': unit,
  'Jest tests': unit,
  'integration tests': integration,
  'Playwright tests \\(API': integration,
  'Playwright tests \\(network': privacy,
  'privacy validation tests': privacy,
  'automated tests': unit + integration + privacy,
  '-test suite': wasmSuite,
  'intrinsic calls': (read('wasm-src/layout_engine.cpp').match(/\bwasm_[a-z0-9_]+\(/g) || []).length,
  '`wasm_simd128.h` intrinsics': (read('wasm-src/layout_engine.cpp').match(/\bwasm_[a-z0-9_]+\(/g) || []).length,
  '-command grammar': (read('frontend/voiceCommands.js').match(/^\s*\{\s*pattern:/gm) || []).length,
  'audit actions': new Set(read('backend/auditLogger.js').match(/auditLog\('[a-z_]+'/g)).size,
  'action types': new Set(read('backend/auditLogger.js').match(/auditLog\('[a-z_]+'/g)).size,
  '-line user manual': read('USER_MANUAL.md').split('\n').length - 1,
};

test('README and USER_MANUAL counts match the repository', () => {
  const stated = [];
  for (const doc of ['README.md', 'USER_MANUAL.md']) {
    const text = read(doc);
    for (const [label, n] of Object.entries(actual)) {
      for (const m of text.matchAll(new RegExp(`(\\d[\\d,]*)\\**\\s?${label}`, 'g'))) {
        stated.push({ doc, label, stated: Number(m[1].replace(/,/g, '')), actual: n });
      }
    }
  }
  expect(stated.length).toBeGreaterThanOrEqual(15); // the check found the counts it guards
  expect(stated.filter((s) => s.stated !== s.actual)).toEqual([]);
});
