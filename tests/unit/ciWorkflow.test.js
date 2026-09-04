/**
 * The CI workflow must be a file GitHub can actually run.
 *
 * WHAT HAPPENED:
 *
 * `.github/workflows/ci.yml` contained this step:
 *
 *     run: node -e "... console.log('plugin.json: valid')"
 *
 * The `: ` inside that JS string sits in an unquoted YAML scalar, so the parser
 * read `plugin.json: valid` as a nested mapping and rejected the file. GitHub
 * could not build a workflow from it, so **every run failed in 0 seconds
 * without executing a single step** — from at least 2026-08-03 until
 * 2026-09-04.
 *
 * The consequence was not a missing green tick. That CI is the only place the
 * WASM engine is compiled: it installs Emscripten and runs `npm run build:wasm`.
 * With the workflow dead, `wasm-src/layout_engine.cpp` stopped compiling at
 * commit 6ec4e12 and nobody found out for weeks, because the built binary is
 * untracked — every release kept shipping an engine built from older source.
 *
 * A broken pipeline is worse than no pipeline: the repository showed a CI
 * badge, runs appeared in the Actions tab, and each one was red for a reason
 * nobody read. This is the same shape as a green check that measured nothing.
 *
 * WHY A UNIT TEST, WHEN CI IS THE THING BEING TESTED:
 *
 * Because CI could not report its own breakage. The check has to live where it
 * runs before the push — `npm run test:unit` on a developer's machine.
 */
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = join(here, '..', '..', '.github', 'workflows');

const workflowFiles = existsSync(WORKFLOW_DIR)
    ? readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))
    : [];

describe('CI workflows are valid', () => {
    it('there are workflow files to check', () => {
        // Guards against this whole suite passing vacuously if the directory
        // is renamed or emptied — the failure it exists to catch is silence.
        expect(workflowFiles.length).toBeGreaterThan(0);
    });

    it.each(workflowFiles)('%s parses as YAML', (file) => {
        const text = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
        // The exact assertion that would have caught the month of dead CI.
        expect(() => yaml.load(text)).not.toThrow();
    });

    it.each(workflowFiles)('%s defines at least one job with steps', (file) => {
        const doc = yaml.load(readFileSync(join(WORKFLOW_DIR, file), 'utf8'));
        const jobs = Object.values(doc.jobs || {});
        expect(jobs.length).toBeGreaterThan(0);
        // A parseable file with no runnable steps is still a dead pipeline.
        for (const job of jobs) {
            const runnable = Array.isArray(job.steps) ? job.steps.length : 0;
            expect(runnable + (job.uses ? 1 : 0)).toBeGreaterThan(0);
        }
    });
});

describe('CI still compiles the WASM engine', () => {
    // The compiled engine is untracked build output, so CI is the only thing
    // standing between a non-compiling .cpp and a release. If these steps are
    // ever removed, the source can rot unnoticed again.
    // Parsed defensively. Loading at describe-scope means a malformed file
    // throws during collection and takes the WHOLE suite down with "0 tests" —
    // which is caught, but names nothing. The YAML tests above are the ones
    // that should report a parse error, so this must not pre-empt them.
    let ci = null;
    try {
        if (workflowFiles.includes('ci.yml')) {
            ci = yaml.load(readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8'));
        }
    } catch (err) {
        // Left null; the assertions below fail with a clear message, and the
        // parse test above reports the real cause.
        ci = null;
    }

    it('ci.yml exists', () => {
        expect(ci).not.toBeNull();
    });

    it('installs Emscripten and builds the module', () => {
        expect(ci).not.toBeNull();
        const text = JSON.stringify(ci);
        expect(text).toMatch(/emsdk|emscripten/i);
        expect(text).toMatch(/build:wasm/);
    });

    it('does not let the WASM build fail silently', () => {
        // continue-on-error here would restore exactly the old situation: a
        // pipeline that runs, goes green, and compiles nothing.
        expect(ci).not.toBeNull();
        for (const job of Object.values((ci && ci.jobs) || {})) {
            for (const step of job.steps || []) {
                if (JSON.stringify(step).includes('build:wasm')) {
                    expect(step['continue-on-error']).toBeFalsy();
                }
            }
        }
    });

    it('runs the build before the tests that depend on it', () => {
        expect(ci).not.toBeNull();
        const steps = ((ci && ci.jobs.validate.steps) || []).map((s) => JSON.stringify(s));
        const build = steps.findIndex((s) => s.includes('build:wasm'));
        const tests = steps.findIndex((s) => s.includes('test:unit'));
        expect(build).toBeGreaterThanOrEqual(0);
        expect(tests).toBeGreaterThan(build);
    });
});

describe('the C++ source is the one that gets compiled', () => {
    const CPP = join(here, '..', '..', 'wasm-src', 'layout_engine.cpp');

    it('exists where the build script points', () => {
        const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));
        expect(pkg.scripts['build:wasm']).toContain('wasm-src/layout_engine.cpp');
        expect(existsSync(CPP)).toBe(true);
    });

    it('actually compiles, where Emscripten is available', () => {
        // A real compile, not a regex approximation. The first version of this
        // test tried to detect use-before-definition structurally and flagged
        // allocate_buffers on a file that compiles cleanly — a false positive.
        // A guard that cries wolf gets switched off, which is how the last one
        // stopped being read.
        //
        // Skipped locally when emcc is absent, and that is safe ONLY because
        // ci.yml installs Emscripten and runs the same build. The tests above
        // are what keep that true: if the workflow stops parsing, or stops
        // building the module, they fail here.
        let emccAvailable = true;
        try {
            execFileSync('emcc', ['--version'], { stdio: 'ignore' });
        } catch (_) {
            // Not installed. Reported, not silently passed.
            emccAvailable = false;
        }

        if (!emccAvailable) {
            console.warn('emcc not installed — compile check deferred to CI (see ci.yml)');
            return;
        }

        const out = join(tmpdir(), `holocron-wasm-check-${process.pid}.o`);
        try {
            execFileSync('emcc', ['-fsyntax-only', '-msimd128', CPP], {
                cwd: join(here, '..', '..'),
                stdio: 'pipe'
            });
        } finally {
            if (existsSync(out)) rmSync(out, { force: true });
        }
    }, 120000);
});
