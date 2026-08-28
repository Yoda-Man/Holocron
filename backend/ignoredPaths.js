/**
 * Directories that never belong in the VR constellation.
 *
 * Holocron renders whatever Graphify put in the graph, and Graphify walks
 * vendored and generated trees. On one real workspace the graph was 435MB and
 * its highest-centrality nodes — the biggest, brightest stars in the
 * constellation — were `third_party` Flutter tests and node_modules. The view
 * was dominated by code the user never wrote.
 *
 * Filtering at render time rather than at graph-build time is deliberate: it
 * needs no reindex, invalidates no existing graph, and is reversible by
 * changing one list.
 *
 * KEEP IN SYNC with `core/shared/ignoredPaths.js`. This is a deliberate copy,
 * because Holocron ships as a standalone plugin zip and cannot require across
 * the package boundary at runtime. `tests/unit/ignoredPaths.test.js` fails if
 * the two lists drift — which is exactly how four copies of this list silently
 * diverged in the runtime and cost a descriptor leak.
 */
export const IGNORED_DIRECTORIES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
  'graphify-out',
  '.yodaman-doc-chunks',
  '.yodaman-approval-smoke',
  'obj',
  '.vs',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'vendor',
  'third_party',
  'bower_components',
  'Pods',
  '.gradle',
  '.terraform',
];

/**
 * True when any path segment names an ignored directory.
 *
 * Segment-wise, never substring: `src/buildTools/compile.js` is source, and
 * matching "build" inside it would hide the user's own code — the failure this
 * filter exists to prevent, inverted.
 *
 * @param {string} candidatePath — Node path, workspace-relative or absolute.
 * @returns {boolean}
 */
export function isIgnoredPath(candidatePath) {
  if (typeof candidatePath !== 'string' || candidatePath === '') return false;
  return candidatePath
    .split(/[\\/]/)
    .some((segment) => IGNORED_DIRECTORIES.includes(segment));
}
