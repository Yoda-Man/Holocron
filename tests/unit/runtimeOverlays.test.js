import { readFileSync } from 'node:fs';
/**
 * Holocron's use of the YodaMan runtime, beyond the graph itself.
 *
 * Two gaps this covers:
 *
 * 1. `changeFrequency` was fabricated — a hash of the file name mapped to 0–10 —
 *    and the documented "Only changed in 30 days" filter ran on it. The files it
 *    showed were the ones whose PATH hashed high. Real counts were always one
 *    call away: the git heatmap overlay already fetched them from
 *    /api/git/heatmap.
 *
 * 2. Spec coverage never reached the constellation at all. It is the one thing
 *    YodaMan knows that a model reading the repository cannot work out, and a
 *    3D view is the right shape for it — "which stars are dark" reads instantly
 *    where a list of forty paths does not.
 *
 * These borrow the real prototype methods rather than reimplementing their
 * logic, so a copy cannot keep passing after the original stops working.
 */
import { jest } from '@jest/globals';

const VRViewerModule = await import('../../frontend/VRViewer.js');
const VRViewer = VRViewerModule.default;

/** A viewer stub carrying only what these methods touch. */
function viewer({ nodes, fetchImpl }) {
    const nodeData = nodes.map((n) => ({ ...n, color: 0x111111 }));
    const byPath = new Map(nodes.map((n, i) => [n.path, i]));
    const colours = new Map();

    return {
        nodeData,
        nodeIdMap: new Map(nodes.map((n, i) => [n.path, i])),
        _gitHeatmapOriginalColors: new Map(),
        _specCoverageOriginalColors: new Map(),
        _impactOriginalColors: new Map(),
        _impactActive: false,
        _hasRealChangeData: false,
        _specCoverageActive: false,
        events: [],
        colours,
        _apiUrl: (p, q) => `${p}?${new URLSearchParams(q)}`,
        _workspacePath: () => '/ws',
        _findNodeIndexByPath: (p) => byPath.get(p),
        updateNodeColor: (idx, colour) => colours.set(idx, colour),
        _emit(name, payload) { this.events.push({ name, payload }); },
        __fetch: fetchImpl
    };
}

/** Run a prototype method with fetch stubbed for the duration. */
async function withFetch(target, method, impl) {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
        return await VRViewer.prototype[method].call(target);
    } finally {
        globalThis.fetch = original;
    }
}

const ok = (body) => async () => ({ ok: true, json: async () => body });

describe('real change frequency replaces the fabricated value', () => {
    const NODES = [
        { path: 'src/app.js', changeFrequency: null },
        { path: 'src/util.js', changeFrequency: null },
        { path: 'src/cold.js', changeFrequency: null }
    ];

    it('fills counts in from the git heatmap', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await withFetch(v, 'loadChangeFrequency', ok([
            { filePath: 'src/app.js', changeCount: 12 },
            { filePath: 'src/util.js', changeCount: 2 }
        ]));

        expect(applied).toBe(true);
        expect(v.nodeData[0].changeFrequency).toBe(12);
        expect(v.nodeData[1].changeFrequency).toBe(2);
        // A file git returned nothing for has genuinely not changed — that is a
        // real zero, not the "unknown" it started as.
        expect(v.nodeData[2].changeFrequency).toBe(0);
        expect(v._hasRealChangeData).toBe(true);
    });

    it('leaves everything unknown when the workspace is not a repository', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await withFetch(v, 'loadChangeFrequency', async () => ({ ok: false, status: 404 }));

        expect(applied).toBe(false);
        // Crucially NOT zero: claiming every file has never changed would be
        // the same class of lie as hashing the path.
        expect(v.nodeData.every((n) => n.changeFrequency === null)).toBe(true);
        expect(v._hasRealChangeData).toBe(false);
    });

    it('survives a git failure without breaking the view', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await withFetch(v, 'loadChangeFrequency', async () => { throw new Error('git exploded'); });
        expect(applied).toBe(false);
    });
});

describe('the recent filter is honest about unknown data', () => {
    const passes = (data) => VRViewer.prototype._passesFilter.call(
        { nodeData: [data], _recentThreshold: 3 }, 0, 'recent'
    );

    it('hides a file below the threshold and keeps one above', () => {
        expect(passes({ changeFrequency: 1 })).toBe(false);
        expect(passes({ changeFrequency: 9 })).toBe(true);
    });

    it('shows everything rather than nothing when the data is unknown', () => {
        // Without git data every node would score 0 and this filter would hide
        // the entire graph — which reads as a broken view, not as missing
        // information.
        expect(passes({ changeFrequency: null })).toBe(true);
        expect(passes({})).toBe(true);
    });
});

describe('spec coverage reaches the constellation', () => {
    const NODES = [
        { path: 'server/entities.py' },
        { path: 'shared/messages.py' },
        { path: 'src/documented.js' }
    ];

    const REPORT = {
        available: true,
        covered: false,
        undocumentedCount: 2,
        staleCount: 0,
        undocumented: [
            { file: 'server/entities.py', dependents: 7 },
            { file: 'shared/messages.py', dependents: 3 }
        ]
    };

    it('marks undocumented modules and weights them by blast radius', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await withFetch(v, 'applySpecCoverage', ok(REPORT));

        expect(applied).toBe(true);
        // More dependents on an undescribed module means it matters more.
        expect(v.colours.get(0)).toBe(0xff3b30);
        expect(v.colours.get(1)).toBe(0xff9500);
        // A module nothing flagged is left alone.
        expect(v.colours.has(2)).toBe(false);
    });

    it('works for a workspace with no specs, which is the common case', async () => {
        // Since 0.5.4 drift answers with zero specs: "nothing here is
        // documented" is the strongest coverage answer, not an absence of one.
        const v = viewer({ nodes: NODES });
        await withFetch(v, 'applySpecCoverage', ok({ ...REPORT, covered: false, specCount: 0 }));

        const event = v.events.find((e) => e.name === 'spec-coverage-change');
        expect(event.payload.enabled).toBe(true);
        expect(event.payload.covered).toBe(false);
        expect(event.payload.undocumentedCount).toBe(2);
    });

    it('says why rather than silently doing nothing when drift is unavailable', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await withFetch(v, 'applySpecCoverage', ok({
            available: false, reason: 'no knowledge graph has been built for this workspace yet'
        }));

        expect(applied).toBe(false);
        const event = v.events.find((e) => e.name === 'spec-coverage-change');
        expect(event.payload.enabled).toBe(false);
        expect(event.payload.reason).toMatch(/knowledge graph/);
    });

    it('restores the original colours when switched off', async () => {
        const v = viewer({ nodes: NODES });
        await withFetch(v, 'applySpecCoverage', ok(REPORT));
        VRViewer.prototype.clearSpecCoverage.call(v);

        expect(v._specCoverageActive).toBe(false);
        expect(v._specCoverageOriginalColors.size).toBe(0);
        // Both marked nodes are back to what they were.
        expect(v.colours.get(0)).toBe(0x111111);
        expect(v.colours.get(1)).toBe(0x111111);
    });

    it('keeps its own colour memory separate from the git heatmap', async () => {
        // A node can be both a churn hotspot and undescribed. If the two
        // overlays shared one map, turning either off would restore the wrong
        // colour.
        const v = viewer({ nodes: NODES });
        await withFetch(v, 'applySpecCoverage', ok(REPORT));
        expect(v._specCoverageOriginalColors.size).toBeGreaterThan(0);
        expect(v._gitHeatmapOriginalColors.size).toBe(0);
    });
});

describe('blast radius reaches the constellation', () => {
    const NODES = [
        { path: 'src/core.js' },
        { path: 'src/a.js' },
        { path: 'src/b.js' },
        { path: 'src/unrelated.js' }
    ];

    const okPost = (body) => async () => ({ ok: true, json: async () => body });

    async function runImpact(target, impl, node = 'src/core.js') {
        const original = globalThis.fetch;
        globalThis.fetch = impl;
        try {
            return await VRViewer.prototype.showImpact.call(target, node);
        } finally {
            globalThis.fetch = original;
        }
    }

    it('lights what a change reaches, and marks the origin differently', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await runImpact(v, okPost({ affected: ['src/a.js', 'src/b.js'] }));

        expect(applied).toBe(true);
        expect(v.colours.get(1)).toBe(0xff9500);
        expect(v.colours.get(2)).toBe(0xff9500);
        // The file being changed is not the same thing as what it reaches.
        expect(v.colours.get(0)).toBe(0xff3b30);
        // Nothing outside the reachable set is touched.
        expect(v.colours.get(3)).toBeUndefined();
    });

    it('accepts the shapes the runtime actually returns', async () => {
        // affected entries may be strings or objects keyed by file/id/node.
        for (const body of [
            { affected: ['src/a.js'] },
            { affected: [{ file: 'src/a.js' }] },
            { nodes: [{ id: 'src/a.js' }] }
        ]) {
            const v = viewer({ nodes: NODES });
            expect(await runImpact(v, okPost(body))).toBe(true);
            expect(v.colours.get(1)).toBe(0xff9500);
        }
    });

    it('says nothing was reachable rather than pretending it lit something', async () => {
        const v = viewer({ nodes: NODES });
        const applied = await runImpact(v, okPost({ affected: [] }));

        expect(applied).toBe(false);
        const event = v.events.find((e) => e.name === 'impact-change');
        expect(event.payload.enabled).toBe(false);
        expect(event.payload.reason).toMatch(/nothing reachable/);
    });

    it('survives a runtime failure without breaking the view', async () => {
        const v = viewer({ nodes: NODES });
        expect(await runImpact(v, async () => { throw new Error('down'); })).toBe(false);
        expect(await runImpact(v, async () => ({ ok: false, status: 500 }))).toBe(false);
    });

    it('restores every colour it changed', async () => {
        const v = viewer({ nodes: NODES });
        await runImpact(v, okPost({ affected: ['src/a.js', 'src/b.js'] }));
        VRViewer.prototype.clearImpact.call(v);

        expect(v._impactActive).toBe(false);
        expect(v._impactOriginalColors.size).toBe(0);
        expect(v.colours.get(0)).toBe(0x111111);
        expect(v.colours.get(1)).toBe(0x111111);
    });

    it('keeps its colour memory separate from the other two overlays', async () => {
        // Three overlays can be on at once; sharing one map would restore the
        // wrong colour when any of them is switched off.
        const v = viewer({ nodes: NODES });
        await runImpact(v, okPost({ affected: ['src/a.js'] }));
        expect(v._impactOriginalColors.size).toBeGreaterThan(0);
        expect(v._specCoverageOriginalColors.size).toBe(0);
        expect(v._gitHeatmapOriginalColors.size).toBe(0);
    });
});

/**
 * Every capability must be reachable.
 *
 * All three of these were written as methods with no caller — dead code that
 * looked finished and tested. That is the same shape as the MCP server shipping
 * with nothing in the UI mentioning it existed: a capability nobody can find is
 * not a capability.
 */
describe('the overlays are reachable from the interface', () => {
    const src = readFileSync(new URL('../../frontend/VRViewer.js', import.meta.url), 'utf8');

    it.each([
        ['toggleSpecCoverage', 'coverageButton'],
        ['showImpactForSelection', 'impactButton'],
        ['toggleGitHeatmap', 'heatmapButton']
    ])('%s is bound to a control', (method, button) => {
        expect(src).toMatch(new RegExp(`${button}\\.addEventListener\\('click'`));
        expect(src).toMatch(new RegExp(`this\\.${method}\\(`));
    });

    it('loads real change counts when a scene is rendered', () => {
        // Not a button: the "recent" filter is useless until this has run, so
        // it must happen without the user knowing to ask.
        expect(src).toMatch(/this\.loadChangeFrequency\(\)/);
    });

    it('each control is actually added to the container', () => {
        for (const button of ['heatmapButton', 'coverageButton', 'impactButton']) {
            expect(src).toMatch(new RegExp(`controls\\.appendChild\\(${button}\\)`));
        }
    });
});

