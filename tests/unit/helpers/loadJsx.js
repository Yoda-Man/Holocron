/**
 * Import a shipped `.jsx` module in Jest: compile it with Vite's own JSX
 * transform and point `react` at the hook runtime in hooks.js.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const hooks = join(here, 'hooks.js');

export async function loadJsx(relativeToRepo) {
  const file = join(here, '..', '..', '..', relativeToRepo);
  const { code } = await transformWithOxc(readFileSync(file, 'utf8'), file, { jsx: { runtime: 'automatic' } });
  const out = join(mkdtempSync(join(tmpdir(), 'holocron-jsx-')), basename(file).replace(/\.jsx$/, '.mjs'));
  writeFileSync(out, code.replace(/(['"])react(?:\/jsx-runtime)?\1/g, JSON.stringify(hooks)));
  return import(out);
}
