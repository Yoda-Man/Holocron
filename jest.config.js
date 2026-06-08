/**
 * Jest Configuration — Holocron VR Unit Tests
 *
 * Project uses "type": "module" so Jest needs ESM transform support.
 * Tests run against backend/ and frontend/ source files with mocked
 * browser APIs as needed.
 *
 * @see 08-Testing-Spec.md §1 — Unit test scope
 * @see 08-Testing-Spec.md §1.1 — Layout algorithm tests
 */

export default {
  // ESM support — Node-native ESM, no Babel transform
  testEnvironment: 'node',

  // Don't transform anything — we're using native ESM
  transform: {},

  // Extensions to resolve
  moduleFileExtensions: ['js', 'mjs', 'jsx'],

  // Test file discovery
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/unit/**/*.test.mjs',
  ],

  // Coverage configuration (08-Testing-Spec.md §1)
  collectCoverageFrom: [
    '<rootDir>/backend/**/*.js',
    '<rootDir>/backend/**/*.mjs',
    '!<rootDir>/node_modules/**',
  ],

  // Coverage thresholds per 08-Testing-Spec.md §1: ≥ 80% line
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Per-test timeout — layout tests may involve async computation
  testTimeout: 10_000,

  // Verbose output for CI
  verbose: true,

  // Report coverage in terminal
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
