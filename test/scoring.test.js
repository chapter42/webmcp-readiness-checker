/**
 * @file test/scoring.test.js
 * Guards the scoring rubric's arithmetic.
 *
 * Regression: through 0.1.7, scanWebMCPCore() awarded 15 + 10 + 5 + 5 = 35
 * points against a declared max of 30, so a fully-featured page could total
 * 105/100. Static inspection missed it because the branches look mutually
 * exclusive; only executing the functions reveals the real ceiling.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadContentScript, scoreAll } = require('./helpers/load-content-script.js');

/** A page doing everything right, on the current API surface. */
const BEST_CASE = {
  documentSurface: true,
  navigatorSurface: false,
  getToolsAvailable: true,
  toolsAreLive: true,
  methodDetected: true,
  tools: [{ name: 'a', description: 'd', annotations: { readOnlyHint: true } }],
};

/** A page still on the surface deprecated in Chromium 150. */
const LEGACY_CASE = {
  documentSurface: false,
  navigatorSurface: true,
  methodDetected: true,
  tools: [{ name: 'a', description: 'd', annotations: {} }],
};

test('no category can score above its declared max', () => {
  for (const [label, mwr] of [['best', BEST_CASE], ['legacy', LEGACY_CASE], ['bare', null]]) {
    const sandbox = loadContentScript({ populated: mwr !== null, mainWorldResults: mwr });
    const { categories } = scoreAll(sandbox, mwr !== null);
    for (const [name, cat] of Object.entries(categories)) {
      assert.ok(
        cat.score <= cat.max,
        `${label}: ${name} scored ${cat.score}/${cat.max} — exceeds its declared max`
      );
    }
  }
});

test('declared category maxima sum to exactly 100', () => {
  const sandbox = loadContentScript({ mainWorldResults: BEST_CASE });
  const { max } = scoreAll(sandbox, true);
  assert.strictEqual(max, 100, `category maxima sum to ${max}, expected 100`);
});

test('a fully-featured page reaches exactly 100, never more', () => {
  const sandbox = loadContentScript({ mainWorldResults: BEST_CASE });
  const { total } = scoreAll(sandbox, true);
  assert.strictEqual(total, 100, `best case totalled ${total}, expected exactly 100`);
});

test('the deprecated navigator surface scores below the current one', () => {
  const modern = scoreAll(loadContentScript({ mainWorldResults: BEST_CASE }), true);
  const legacy = scoreAll(loadContentScript({ mainWorldResults: LEGACY_CASE }), true);
  assert.ok(
    legacy.total < modern.total,
    'navigator.modelContext must not score the same as document.modelContext'
  );
});

test('every signal reports a status the side panel can render', () => {
  // content.js emits 'warning'; the side panel used to recognise only
  // 'warn'/'partial' and rendered warnings as red failures.
  const RENDERABLE = new Set(['pass', 'warning', 'warn', 'partial', 'fail']);
  for (const mwr of [BEST_CASE, LEGACY_CASE, null]) {
    const sandbox = loadContentScript({ populated: mwr !== null, mainWorldResults: mwr });
    const { categories } = scoreAll(sandbox, mwr !== null);
    for (const [name, cat] of Object.entries(categories)) {
      for (const sig of cat.signals || []) {
        assert.ok(
          RENDERABLE.has(sig.status),
          `${name}/${sig.name} has unrenderable status "${sig.status}"`
        );
      }
    }
  }
});

test('an insecure page cannot earn the secure-context points', () => {
  const sandbox = loadContentScript({ secure: false, mainWorldResults: BEST_CASE });
  const tech = require('node:vm').runInContext('scanTechnicalFoundation()', sandbox);
  const https = (tech.signals || []).find((s) => s.name === 'HTTPS');
  assert.ok(https, 'HTTPS signal missing');
  assert.strictEqual(https.status, 'fail');
  assert.strictEqual(https.points, 0);
});

test('discovery accepts either .well-known/webmcp or .well-known/webmcp.json', () => {
  const vmMod = require('node:vm');
  const sandbox = loadContentScript({ mainWorldResults: BEST_CASE });
  const base = {
    llms: { status: 404, content: null },
    robots: { status: 404, content: null },
  };
  const only = (key) => vmMod.runInContext(
    `fillDiscovery(${JSON.stringify({
      ...base,
      webmcp: { status: 404, content: null },
      webmcpJson: { status: 404, content: null },
      [key]: { status: 200, content: '{}' },
    })})`,
    sandbox
  );
  for (const key of ['webmcp', 'webmcpJson']) {
    const manifest = (only(key).signals || []).find((s) => s.name === 'webmcp manifest');
    assert.strictEqual(manifest.status, 'pass', `${key} alone should satisfy the manifest signal`);
  }
});
