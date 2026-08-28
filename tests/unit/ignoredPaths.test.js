/**
 * The constellation should show the user's code, not their dependencies.
 *
 * Holocron renders whatever Graphify put in the graph, and Graphify walks
 * vendored trees. On one real workspace the graph was 435MB and its
 * highest-centrality nodes — the biggest, brightest stars in the view — were
 * `third_party` Flutter tests and node_modules. Filtering happens at render
 * time, so no reindex is needed and no existing graph is invalidated.
 *
 * The second test is the one that matters long-term. This list is a deliberate
 * copy of `core/shared/ignoredPaths.js`, because Holocron ships as a standalone
 * plugin and cannot require across the package boundary. Copies drift: four of
 * them did exactly that inside the runtime and cost a file-descriptor leak that
 * silently disabled every agent tool. This fails the moment they diverge.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IGNORED_DIRECTORIES, isIgnoredPath } from '../../backend/ignoredPaths.js';
import { normalizeNodes } from '../../backend/graphProcessor.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORE_LIST = join(here, '..', '..', '..', 'core', 'shared', 'ignoredPaths.js');

describe('ignored paths', () => {
  it('matches whole path segments, never substrings', () => {
    expect(isIgnoredPath('app/node_modules/react/index.js')).toBe(true);
    expect(isIgnoredPath('vendor/lib.go')).toBe(true);
    expect(isIgnoredPath('tv/third_party/player/Test.java')).toBe(true);

    // Hiding the user's own code is the worse failure of the two.
    expect(isIgnoredPath('src/buildTools/compile.js')).toBe(false);
    expect(isIgnoredPath('src/distribution/index.js')).toBe(false);
    expect(isIgnoredPath('packages/app/src/index.ts')).toBe(false);
  });

  it('handles missing and malformed paths without throwing', () => {
    expect(isIgnoredPath('')).toBe(false);
    expect(isIgnoredPath(undefined)).toBe(false);
    expect(isIgnoredPath(null)).toBe(false);
    expect(isIgnoredPath(42)).toBe(false);
  });

  it('stays in step with the runtime list it was copied from', () => {
    // Skipped when Holocron is checked out on its own, rather than failing for
    // a reason the developer cannot act on.
    if (!existsSync(CORE_LIST)) return;

    const source = readFileSync(CORE_LIST, 'utf8');
    const block = source.slice(
      source.indexOf('IGNORED_DIRECTORIES = ['),
      source.indexOf('];', source.indexOf('IGNORED_DIRECTORIES = ['))
    );
    const coreEntries = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(coreEntries.length).toBeGreaterThan(0);
    expect([...IGNORED_DIRECTORIES].sort()).toEqual([...coreEntries].sort());
  });
});

describe('normalizeNodes drops vendored code', () => {
  it('keeps the user\'s files and removes dependencies', () => {
    const nodes = normalizeNodes([
      { id: 'a', path: 'src/app.js' },
      { id: 'b', path: 'node_modules/react/index.js' },
      { id: 'c', path: 'tv/third_party/player/Test.java' },
      { id: 'd', path: 'lib/util.ts' },
      { id: 'e', path: 'graphify-out/graph.json' },
    ]);

    expect(nodes.map((n) => n.id)).toEqual(['a', 'd']);
  });

  it('still tolerates null entries rather than crashing', () => {
    // Graceful degradation was already the contract here; filtering must not
    // quietly remove the placeholder path that behaviour depends on.
    const nodes = normalizeNodes([null, { id: 'a', path: 'src/app.js' }]);
    expect(nodes).toHaveLength(2);
    expect(nodes[1].id).toBe('a');
  });

  it('falls back to the node id when no path is given', () => {
    const nodes = normalizeNodes([
      { id: 'node_modules/left-pad/index.js' },
      { id: 'src/real.js' },
    ]);
    expect(nodes.map((n) => n.id)).toEqual(['src/real.js']);
  });
});
