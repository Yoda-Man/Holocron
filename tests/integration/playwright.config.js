/**
 * Playwright Test Configuration — Holocron VR Integration Tests
 *
 * Runs integration tests against mocked API endpoints.
 * No real YodaMan backend needed — all graphify/* routes are intercepted
 * via page.route() and return deterministic fixtures from mock-data.js.
 *
 * @see 08-Testing-Spec.md §2 — Integration test scope
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  // ─── Test Discovery ──────────────────────────────────────────────────
  testDir: '.',
  testMatch: '**/*.test.js',
  // Don't run the mock-data helper as a test
  testIgnore: 'mock-data.js',

  // ─── Timeouts ────────────────────────────────────────────────────────
  timeout: 30_000,             // Per-test timeout (§2: testTimeout=30000)
  expect: { timeout: 5_000 },  // Per-assertion timeout

  // ─── Reporter ────────────────────────────────────────────────────────
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/graphify-int-results.json' }],
  ],

  // ─── Browser ─────────────────────────────────────────────────────────
  use: {
    // Chromium is the primary browser (Electron uses Chromium)
    browserName: 'chromium',
    // Headless by default for CI; set HEADFUL=1 for visual debugging
    headless: !process.env.HEADFUL,
    // Ignore HTTPS errors (mocked routes, no real server)
    ignoreHTTPSErrors: true,
    // Capture a screenshot and trace on failure
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  // ─── Projects ────────────────────────────────────────────────────────
  projects: [
    {
      name: 'graphify-api',
      testMatch: 'graphify.test.js',
    },
    {
      name: 'lifecycle',
      testMatch: 'lifecycle.test.js',
    },
    {
      name: 'wasm',
      testMatch: 'wasm.test.js',
    },
    {
      name: 'privacy',
      testDir: '../privacy',
      testMatch: '*.test.js',
    },
  ],

  // ─── Global Setup ────────────────────────────────────────────────────
  // No global setup needed — each test registers its own mock routes
  // via registerMockRoutes() from mock-data.js.

  // ─── Retries ─────────────────────────────────────────────────────────
  // Flaky network-interception tests get one retry in CI
  retries: process.env.CI ? 1 : 0,

  // ─── Workers ─────────────────────────────────────────────────────────
  // Run integration tests serially to avoid route-interception conflicts
  workers: 1,
});
