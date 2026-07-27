/**
 * @file eslint.config.js
 * Flat config. Three environments live in this repo: extension code that runs
 * in the browser with the chrome.* APIs, the MAIN-world inject script which
 * must stay ES5-ish because it runs before anything else on the page, and
 * Node-based tests and scripts.
 */

'use strict';

const js = require('@eslint/js');

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  chrome: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  CustomEvent: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  getComputedStyle: 'readonly',
  scheduler: 'readonly',
  globalThis: 'readonly',
  HTMLFormElement: 'readonly',
};

const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  Buffer: 'readonly',
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'store-assets/**'] },

  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: BROWSER_GLOBALS,
    },
    rules: {
      ...js.configs.recommended.rules,
      // `catch (_)` is used throughout inject.js, which must never throw into
      // the page it is observing.
      'no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      // MV3's CSP blocks both outright.
      'no-eval': 'error',
      'no-new-func': 'error',
      // The pattern that caused the 0.2.0 XSS fix.
      'no-implied-eval': 'error',
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    // markdown-report.js declares generateMarkdownReport and sidepanel.html
    // loads it in its own <script> tag beforehand — there are no modules here,
    // so the reference is only resolvable at runtime.
    files: ['extension/sidepanel.js'],
    languageOptions: {
      globals: { generateMarkdownReport: 'readonly' },
    },
  },

  {
    files: ['test/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: NODE_GLOBALS,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: js.configs.recommended.rules,
  },
];
