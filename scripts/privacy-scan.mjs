#!/usr/bin/env node
/**
 * Privacy scan: fail when source fetches anything but YodaMan's local API.
 *
 * Usage: node scripts/privacy-scan.mjs [path ...]   (default: frontend backend main.js)
 * Exits 1 and lists each finding; exits 0 when every literal fetch URL starts
 * with /api/, http://localhost or file://.
 *
 * CI used to run this as `grep ... && echo FAIL || echo PASS`, which exits 0
 * either way, so the scan could never fail a build.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXTERNAL = /fetch\(\s*(['"`])(?!\/api\/|http:\/\/localhost|file:\/\/)([^'"`]*)/g;

function files(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => (name === 'node_modules' ? [] : files(join(path, name))));
}

const roots = process.argv.length > 2 ? process.argv.slice(2) : ['frontend', 'backend', 'main.js'];
const findings = roots.flatMap(files).filter((f) => /\.(m?js|jsx)$/.test(f)).flatMap((file) =>
  readFileSync(file, 'utf8').split('\n').flatMap((line, i) =>
    [...line.matchAll(EXTERNAL)].map((m) => `${file}:${i + 1}: fetch(${m[1]}${m[2]}`)));

if (findings.length) {
  console.error(`FAIL: external URL detected\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('PASS: All fetch URLs are localhost or /api/');
