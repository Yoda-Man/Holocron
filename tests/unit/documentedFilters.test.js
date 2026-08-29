/**
 * Every filter the manual promises must actually change what you see.
 *
 * This exists because of a specific mistake. Looking at a real workspace's
 * graph, dependencies were the highest-centrality nodes — the brightest stars
 * in the constellation were other people's code. So a filter was added in
 * `normalizeNodes` to drop them before layout.
 *
 * Holocron already did that. `_passesFilter` has a `thirdParty` case, off by
 * default, that a user can turn ON to reveal dependencies. Dropping the nodes
 * upstream hid exactly the same things while making that toggle inert: the
 * same view, less control, and a manual documenting a control that could no
 * longer do anything.
 *
 * All 193 tests passed either way, because they checked that filtering
 * happened, never that the toggle could still reverse it.
 *
 * The guard is therefore behavioural, not structural. Asserting the `case`
 * exists would not have caught it — the case was still there. What catches it
 * is asserting that each filter can both hide and keep, on data that reaches
 * the viewer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeNodes } from '../../backend/graphProcessor.js';

const here = dirname(fileURLToPath(import.meta.url));
const MANUAL = join(here, '..', '..', 'USER_MANUAL.md');
const VIEWER = join(here, '..', '..', 'frontend', 'VRViewer.js');

/**
 * Call the real predicate without building a WebGL scene.
 *
 * It reads only `this.nodeData`, so the prototype method can be borrowed. This
 * tests the shipped implementation rather than a copy of its logic — a copy
 * would keep passing after the original stopped working, which is the failure
 * this file is about.
 */
async function passesFilter(nodeData, type) {
    const { default: VRViewer } = await import('../../frontend/VRViewer.js');
    return VRViewer.prototype._passesFilter.call({ nodeData: [nodeData] }, 0, type);
}

describe('documented filters are implemented', () => {
    const manual = readFileSync(MANUAL, 'utf8');
    const viewer = readFileSync(VIEWER, 'utf8');

    /** Manual wording → the filter type the viewer switches on. */
    const DOCUMENTED = [
        ['Show test files', 'tests'],
        ['Show third-party code', 'thirdParty'],
        ['Show generated files', 'generated'],
        ['Only changed in 30 days', 'recent'],
    ];

    it.each(DOCUMENTED)('the manual promises "%s", and the viewer handles %s', (promise, type) => {
        expect(manual).toContain(promise);
        expect(viewer).toMatch(new RegExp(`case '${type}':`));
    });

    it('documents every filter the viewer implements', () => {
        // Catches the other direction: a filter shipped but never described, so
        // nobody knows it is there.
        const implemented = [...viewer.matchAll(/case '([a-zA-Z]+)':/g)]
            .map((m) => m[1])
            .filter((t) => !['dart', 'json', 'yaml', 'markdown', 'javascript', 'python', 'go', 'rust', 'typescript'].includes(t));
        const documented = DOCUMENTED.map(([, type]) => type);
        for (const type of implemented) {
            expect(documented).toContain(type);
        }
    });
});

describe('each filter can both hide and keep', () => {
    /**
     * [type, a node it must hide, a node it must keep]
     *
     * A filter that hides everything, or nothing, is broken in a way a
     * presence check cannot see.
     */
    const CASES = [
        ['tests', { path: 'src/__tests__/app.test.js', isTest: true }, { path: 'src/app.js', isTest: false }],
        ['thirdParty', { path: 'node_modules/react/index.js', isThirdParty: true }, { path: 'src/app.js', isThirdParty: false }],
        ['generated', { path: 'lib/model.g.dart', isGenerated: true }, { path: 'lib/model.dart', isGenerated: false }],
    ];

    it.each(CASES)('%s hides what it should', async (type, hidden) => {
        expect(await passesFilter(hidden, type)).toBe(false);
    });

    it.each(CASES)('%s keeps what it should', async (type, _hidden, kept) => {
        expect(await passesFilter(kept, type)).toBe(true);
    });
});

describe('the toggles still have something to act on', () => {
    /**
     * The actual bug. Filtering upstream of the viewer makes every downstream
     * toggle inert while leaving it looking implemented, so this asserts the
     * nodes survive the pipeline and reach the point where the user decides.
     */
    it('normalizeNodes keeps vendored nodes for the viewer to hide or show', () => {
        const nodes = normalizeNodes([
            { id: 'a', path: 'src/app.js' },
            { id: 'b', path: 'node_modules/react/index.js' },
            { id: 'c', path: 'tv/third_party/player/Test.java' },
            { id: 'd', path: 'src/__tests__/app.test.js' },
        ]);

        // All four reach the viewer. Hiding is the viewer's decision, taken
        // per-frame from the user's toggles — not the pipeline's decision,
        // taken once and permanently.
        expect(nodes).toHaveLength(4);
        expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('does not filter by any ignore list before the viewer sees the graph', () => {
        // Named directly, because the tempting fix is to reach for the shared
        // ignore list here — where it silently removes a user's control rather
        // than widening it.
        const processor = readFileSync(join(here, '..', '..', 'backend', 'graphProcessor.js'), 'utf8');
        expect(processor).not.toMatch(/isIgnoredPath/);
    });
});
