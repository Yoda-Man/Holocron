/**
 * Guard: every file main.js and plugin.json name exists.
 *
 * They named backend/graphCache.js, UIPanel.jsx#VRExplorerModal,
 * frontend/AgenticChat.jsx and assets/chat-icon.svg, none of which existed.
 * YodaMan core vendors both files, so a dead path ships inside YodaMan too.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainSource = readFileSync(join(root, 'main.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));

const strings = (value) => (typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
const FILE = /^(?:\.\/)?[\w./-]+\.(?:jsx?|mjs|svg|png|json)(?:#\w+)?$/;

const named = [
  ...[...mainSource.matchAll(/['"`](\.\/[^'"`]+)['"`]/g)].map((m) => m[1]),
  ...strings(manifest).filter((s) => FILE.test(s)),
];

test('there are paths to check', () => {
  expect(named).toEqual(expect.arrayContaining(['./frontend/UIPanel.jsx', 'main.js']));
});

test.each(named)('%s exists', (ref) => {
  const [file, exportName] = ref.split('#');
  const path = join(root, file);
  expect(existsSync(path)).toBe(true);
  if (exportName) expect(readFileSync(path, 'utf8')).toMatch(new RegExp(`export\\s+(?:\\{[^}]*\\b${exportName}\\b|(?:function|const|class)\\s+${exportName}\\b)`));
});

test('the manifest declares no UI extensions, which nothing in YodaMan renders', () => {
  expect(manifest).not.toHaveProperty('uiExtensions');
});
