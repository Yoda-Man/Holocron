/**
 * Holocron VR — Vite Build Configuration
 *
 * Builds the plugin bundle compatible with YodaMan's module system.
 *
 * Build pipeline:
 *   1. Compile main.js  (CommonJS → ESM → bundled CJS)
 *   2. Compile frontend/*.jsx (React JSX → JS)
 *   3. Copy plugin.json, assets/ → dist/ (preserving source structure)
 *
 * Output: dist/ — mirrors the source directory layout so the built plugin
 * folder can be symlinked or copied into YodaMan's plugins/ directory.
 *
 * External dependencies (provided by YodaMan host):
 *   - react, react-dom
 *   - three (runtime dep, bundled separately via node_modules)
 *
 * @see 02-TSD.md §2  — Technology stack
 * @see 05-YodaMan-Integration.md §1 — Lifecycle hooks
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

/**
 * Rewrite .jsx → .js in compiled chunk string literals.
 *
 * YodaMan references component paths like "./frontend/UIPanel.jsx" in
 * its API calls (registerPluginCard, openModal). The build compiles
 * these to .js, so the string references must be updated to match.
 */
function rewriteJsxPaths() {
  return {
    name: 'rewrite-jsx-paths',
    generateBundle(_, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && typeof chunk.code === 'string') {
          // Match .jsx followed by a quote (" or ') or a hash fragment (#)
          chunk.code = chunk.code.replace(/\.jsx(["'#])/g, '.js$1');
        }
      }
    },
  };
}

export default defineConfig({
  // ─── Plugins ──────────────────────────────────────────────────────────
  plugins: [
    // Rewrite .jsx → .js in compiled output strings (must run first)
    rewriteJsxPaths(),

    // JSX transform for React components in frontend/
    react({
      // YodaMan provides its own React instance; use the automatic JSX
      // runtime to avoid injecting a second copy.
      jsxRuntime: 'automatic',
    }),

    // Copy static assets to dist/ with the same relative paths.
    // plugin.json is transformed to reference compiled .js files.
    viteStaticCopy({
      targets: [
        {
          src: 'plugin.json',
          dest: '.',
          // Transform .jsx references in uiExtensions → .js (the compiled output)
          transform: (contents) => {
            const raw = contents.toString();
            const updated = raw.replace(/\.jsx"/g, '.js"');
            return updated;
          },
        },
        {
          src: 'assets/*',
          dest: 'assets',
        },
      ],
    }),
  ],

  // ─── Build ────────────────────────────────────────────────────────────
  build: {
    // Output directory — mirrors source layout
    outDir: 'dist',

    // Don't emit separate CSS files (no CSS source files yet)
    cssCodeSplit: false,

    // Don't emit strict CSP-incompatible styles
    cssMinify: false,

    // Generate package.json for the dist — tells YodaMan's loader this
    // is the built output (not the source tree)
    emitAssets: true,

    // ─── Rollup Configuration ──────────────────────────────────────────
    rollupOptions: {
      // Three entry points matching the YodaMan plugin contract:
      //   main.js          — lifecycle hooks (module.exports)
      //   frontend/UIPanel  — React card component (JSX)
      //   frontend/VRViewer — Three.js scene manager (ESM)
      input: {
        main: path.resolve(__dirname, 'main.js'),
        'frontend/UIPanel': path.resolve(__dirname, 'frontend/UIPanel.jsx'),
        'frontend/VRViewer': path.resolve(__dirname, 'frontend/VRViewer.js'),
      },

      // Mark host-provided dependencies as external — YodaMan supplies
      // these at runtime and bundling duplicates would break the host.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        /^three\//,
        'three',
      ],

      output: {
        // CJS output for YodaMan's module system (plugin loader uses
        // `require()` / `module.exports` to load plugins).
        format: 'cjs',

        // Preserve the directory structure so YodaMan's path resolution
        // matches what plugin.json references.
        //
        //   source                      →  dist
        //   main.js                     →  dist/main.js
        //   frontend/UIPanel.jsx        →  dist/frontend/UIPanel.js
        //   frontend/VRViewer.js        →  dist/frontend/VRViewer.js
        entryFileNames: '[name].js',

        // Interop: handle mixed CJS/ESM imports so `module.exports` in
        // main.js and `export default` in frontend/ files both work.
        interop: 'auto',

        // Preserve modules to avoid Rollup tree-shaking the export names
        // that YodaMan's plugin loader relies on.
        exports: 'named',

        // Minimise for production — the plugin is loaded from disk, so
        // bundle size directly impacts YodaMan startup time.
        compact: true,
      },

      // ─── Custom external resolver ────────────────────────────────────
      // Ensure `import React from 'react'` and similar stay external
      // even if Vite's pre-bundling tries to inline them.
      onLog(level, log) {
        if (log.code === 'MISSING_NAME_OPTION_FOR_IIFE') {
          return; // Suppress harmless IIFE-related warnings in CJS output
        }
      },
    },

    // ─── Target ────────────────────────────────────────────────────────
    // YodaMan runs on Electron's Chromium — modern ES features are safe.
    target: 'es2020',

    // Sourcemaps aid debugging when YodaMan reports plugin errors with
    // line numbers. Inline sources keep the dist/ self-contained.
    sourcemap: true,
  },

  // ─── Global Definitions ─────────────────────────────────────────────
  // __DEV__ = true in development; false in production (strips perf logs)
  define: {
    __DEV__: process.env.NODE_ENV !== 'production' ? 'true' : 'false',
  },

  // ─── Dependency Resolution ───────────────────────────────────────────
  resolve: {
    // Ensure React resolves to the same instance YodaMan provides
    dedupe: ['react', 'react-dom', 'three'],
  },
});
