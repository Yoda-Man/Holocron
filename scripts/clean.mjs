/**
 * Remove build output. Replaces the `rimraf` dependency.
 *
 * WHY A FILE AND NOT `node -e`:
 *
 * The first replacement inlined this into package.json:
 *
 *     node -e "for (const f of ['a','b']) fs.rmSync(f, { force: true })"
 *
 * That works in a POSIX shell and fails on Windows, where cmd.exe does not
 * treat the single quotes as quoting — CI reported
 * `SyntaxError: missing ) after argument list` on the windows-latest runner.
 * rimraf was cross-platform; the thing that replaced it has to be too.
 *
 * A script file takes its arguments as argv, so no shell quoting is involved
 * on any platform.
 *
 *   node scripts/clean.mjs dist
 *   node scripts/clean.mjs frontend/layout_engine.mjs frontend/layout_engine.wasm
 */
import { rmSync, existsSync } from 'node:fs';

const targets = process.argv.slice(2);

if (targets.length === 0) {
    console.error('usage: node scripts/clean.mjs <path> [<path> ...]');
    process.exit(1);
}

let removed = 0;
for (const target of targets) {
    // Report what was actually there. `force: true` makes a missing path a
    // no-op, which is the behaviour we want but hides whether anything
    // happened — and "clean did nothing" is worth being able to see.
    const existed = existsSync(target);
    rmSync(target, { recursive: true, force: true });
    if (existed) removed += 1;
}

console.log(`clean: removed ${removed} of ${targets.length} target(s)`);
