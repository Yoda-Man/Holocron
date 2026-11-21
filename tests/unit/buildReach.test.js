/**
 * Guard: every module under frontend/ and backend/ ships.
 *
 * VRController, voiceCommands, InfoPanel, SettingsPanel and the backend
 * clients were reached by no build entry: the .jsx panels shipped only as
 * source no host could load, and broken imports went unnoticed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = readFileSync(join(root, 'vite.config.js'), 'utf8');

/** Shipped as source in the release zip, loaded from beside the worker. */
const SOURCE_ONLY = ['frontend/layoutWorker.js', 'frontend/bindLayoutEngine.js', 'frontend/layout_engine.mjs'];

const inputBlock = config.slice(config.indexOf('input:'), config.indexOf('].map('));
const entries = [...inputBlock.matchAll(/'((?:frontend|backend)\/[\w.]+|main\.js)'/g)].map((m) => m[1]);

function reached(start) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of readFileSync(join(root, file), 'utf8').matchAll(/^(?:import|export)\s[^;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      visit(normalize(join(dirname(file), spec)));
    }
  };
  start.forEach(visit);
  return seen;
}

test('the build has entries to follow', () => {
  expect(entries).toEqual(expect.arrayContaining(['main.js', 'frontend/VRViewer.js']));
});

test('every frontend and backend module is reached by a build entry or ships as source', () => {
  const shipped = reached([...entries, ...SOURCE_ONLY]);
  const modules = ['frontend', 'backend'].flatMap((dir) => readdirSync(join(root, dir))
    .filter((f) => /\.(m?js|jsx)$/.test(f)).map((f) => `${dir}/${f}`));
  expect(modules.filter((m) => !shipped.has(m))).toEqual([]);
});
