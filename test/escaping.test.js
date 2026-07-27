/**
 * @file test/escaping.test.js
 * Regression guard for the side panel's HTML escaping.
 *
 * Through 0.1.7, escapeHtml() was `div.textContent = str; return div.innerHTML`,
 * which escapes & < > but leaves quotes intact. Two call sites interpolate into
 * attribute values (`title="${escapeHtml(...)}"`), and everything rendered
 * there comes from the scanned page — so a crafted tool description could break
 * out of the attribute and execute script inside the extension's privileged
 * side panel.
 *
 * If someone reintroduces the textContent/innerHTML trick, these tests fail.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SIDEPANEL_JS = path.join(__dirname, '..', 'extension', 'sidepanel.js');
const src = fs.readFileSync(SIDEPANEL_JS, 'utf8');

/**
 * Extract escapeHtml from the shipped source and evaluate it in an isolated
 * context, so the test always exercises the real implementation rather than a
 * copy that could drift. The evaluated text comes from a file in this repo,
 * never from user input.
 */
function loadEscapeHtml() {
  const match = src.match(/function escapeHtml\(str\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'escapeHtml() not found in sidepanel.js');
  return vm.runInNewContext(`${match[0]}; escapeHtml`);
}

const escapeHtml = loadEscapeHtml();

/** Nothing that could terminate an attribute or open a tag may survive. */
const DANGEROUS = /["'<>]/;

test('attribute-breakout payloads are neutralised', () => {
  const payloads = [
    'x" onmouseover="alert(1)',
    "x' onfocus='alert(1)",
    '" autofocus onfocus="alert(document.cookie)',
    '"><script>alert(1)</script>',
    "'><img src=x onerror=alert(1)>",
  ];
  for (const payload of payloads) {
    const out = escapeHtml(payload);
    assert.ok(
      !DANGEROUS.test(out),
      `payload survived escaping and could break out of an attribute: ${payload} -> ${out}`
    );
  }
});

test('tag-injection payloads are neutralised', () => {
  const out = escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<'), 'angle brackets must be escaped');
  assert.ok(!out.includes('>'), 'angle brackets must be escaped');
});

test('ampersands are escaped exactly once', () => {
  assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  assert.strictEqual(escapeHtml('&amp;'), '&amp;amp;');
});

test('benign text round-trips unchanged', () => {
  const plain = 'Search the product catalogue by keyword';
  assert.strictEqual(escapeHtml(plain), plain);
});

test('null and undefined do not throw', () => {
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(null), '');
});

test('escapeHtml does not use the textContent/innerHTML trick', () => {
  const body = src.match(/function escapeHtml\(str\) \{[\s\S]*?\n\}/)[0];
  assert.ok(
    !/innerHTML/.test(body),
    'escapeHtml must not round-trip through innerHTML — that leaves quotes unescaped'
  );
});

test('values interpolated into attributes go through escapeHtml', () => {
  // Catch a raw `${...}` inside a quoted attribute in a template literal.
  const unescapedAttr = /\b(title|alt|href|value|data-[a-z-]+)="\$\{(?!escapeHtml)[^}]*\}/g;
  const hits = [...src.matchAll(unescapedAttr)]
    .map((m) => m[0])
    // Locally-computed ids are not page-derived.
    .filter((h) => !/\$\{fixId\}|\$\{id\}/.test(h));
  assert.deepStrictEqual(hits, [], `attribute interpolation without escapeHtml: ${hits.join(', ')}`);
});
