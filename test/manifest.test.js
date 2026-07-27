/**
 * @file test/manifest.test.js
 * Manifest V3 and Chrome Web Store hygiene checks.
 *
 * These encode the rules that most often cause a rejected submission or a
 * silently broken extension: permissions declared but never used, icons that
 * point at files which do not exist, inline handlers that MV3's CSP blocks,
 * and version numbers that drift between the manifest and the docs.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const jsFiles = fs.readdirSync(EXT).filter((f) => f.endsWith('.js'));
const allJs = jsFiles.map((f) => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n');
const sidepanelHtml = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8');

/** Read width/height straight out of a PNG's IHDR chunk. */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.ok(buf.slice(1, 4).toString() === 'PNG', `${file} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('uses Manifest V3', () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.background?.service_worker, 'MV3 requires background.service_worker');
  assert.ok(!manifest.background?.scripts, 'background.scripts is MV2');
});

test('no Manifest V2 APIs are referenced', () => {
  const v2 = ['chrome.browserAction', 'chrome.pageAction', 'chrome.tabs.executeScript',
    'chrome.extension.getURL'];
  for (const api of v2) {
    assert.ok(!allJs.includes(api), `${api} is a Manifest V2 API`);
  }
});

test('every declared permission is actually used', () => {
  // A permission declared but never called is a standard rejection reason and
  // was exactly the 0.1.7 state (webNavigation, storage, activeTab).
  const USAGE = {
    sidePanel: () => allJs.includes('chrome.sidePanel.'),
    scripting: () => allJs.includes('chrome.scripting.'),
    storage: () => allJs.includes('chrome.storage.'),
    webNavigation: () => allJs.includes('chrome.webNavigation.'),
    tabs: () => /\btab\.(url|title|favIconUrl)\b/.test(allJs),
    notifications: () => allJs.includes('chrome.notifications.'),
    alarms: () => allJs.includes('chrome.alarms.'),
    contextMenus: () => allJs.includes('chrome.contextMenus.'),
    downloads: () => allJs.includes('chrome.downloads.'),
  };
  for (const perm of manifest.permissions || []) {
    const check = USAGE[perm];
    assert.ok(check, `no usage rule defined for permission "${perm}" — add one to this test`);
    assert.ok(check(), `permission "${perm}" is declared but never used`);
  }
});

test('activeTab is not relied on from the side panel', () => {
  // activeTab only applies to a direct gesture on the action icon, a context
  // menu item, a command, or an omnibox suggestion — never a panel button.
  if (manifest.permissions?.includes('activeTab')) {
    assert.ok(
      (manifest.host_permissions || []).length > 0,
      'a side-panel-triggered extension needs host_permissions, not activeTab'
    );
  }
});

test('chrome.action APIs require an "action" key', () => {
  if (allJs.includes('chrome.action.')) {
    assert.ok(manifest.action, 'chrome.action.* used but no "action" key in the manifest');
  }
});

test('the side panel has an explicit open trigger', () => {
  if (manifest.side_panel) {
    const hasClick = allJs.includes('chrome.action.onClicked');
    const hasBehavior = allJs.includes('setPanelBehavior');
    assert.ok(hasClick || hasBehavior, 'side_panel declared with no way to open it');
    if (hasClick) {
      assert.ok(
        !manifest.action?.default_popup,
        'chrome.action.onClicked never fires while a default_popup is set'
      );
    }
    assert.ok(
      !allJs.includes('openPanelOnActionIconClick'),
      'the property is openPanelOnActionClick — the "Icon" variant throws and kills the worker'
    );
  }
});

test('all referenced icons exist at the declared size', () => {
  for (const [size, rel] of Object.entries(manifest.icons || {})) {
    const file = path.join(EXT, rel);
    assert.ok(fs.existsSync(file), `manifest references a missing icon: ${rel}`);
    const { width, height } = pngSize(file);
    assert.strictEqual(width, Number(size), `${rel} is ${width}px wide, declared as ${size}`);
    assert.strictEqual(height, Number(size), `${rel} is ${height}px tall, declared as ${size}`);
  }
});

test('every file the manifest references exists', () => {
  const refs = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.action?.default_popup,
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ].filter(Boolean);
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(EXT, rel)), `manifest references a missing file: ${rel}`);
  }
});

test('no CSP violations in extension pages', () => {
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(sidepanelHtml), 'inline <script> is blocked by MV3 CSP');
  assert.ok(!/\son[a-z]+\s*=/i.test(sidepanelHtml), 'inline event handlers are blocked by MV3 CSP');
  assert.ok(!/\beval\s*\(/.test(allJs), 'eval() is blocked by MV3 CSP');
  assert.ok(!/new Function\s*\(/.test(allJs), 'new Function() is blocked by MV3 CSP');
});

test('the service worker keeps no mutable module-level state', () => {
  // MV3 workers terminate after ~30s idle; globals do not survive.
  const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  const mutable = bg.match(/^(let|var)\s+\w+/gm) || [];
  assert.deepStrictEqual(
    mutable, [],
    `service worker holds mutable global state (${mutable.join(', ')}) — use chrome.storage`
  );
});

test('async onMessage handlers keep the channel open', () => {
  const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  if (bg.includes('sendResponse')) {
    assert.ok(
      bg.includes('return true'),
      'an onMessage listener that responds asynchronously must return true'
    );
  }
});

test('the manifest version matches the documented version', () => {
  const changelog = fs.readFileSync(path.join(EXT, 'CHANGELOG.md'), 'utf8');
  const latest = changelog.match(/^##\s*([0-9]+\.[0-9]+\.[0-9]+)/m);
  assert.ok(latest, 'no version heading found in CHANGELOG.md');
  assert.strictEqual(
    manifest.version, latest[1],
    `manifest is ${manifest.version} but the newest CHANGELOG entry is ${latest[1]}`
  );

  const store = path.join(ROOT, 'CHROMEWEBSTORE.md');
  if (fs.existsSync(store)) {
    const text = fs.readFileSync(store, 'utf8');
    assert.ok(
      text.includes(manifest.version),
      `CHROMEWEBSTORE.md does not mention the current version ${manifest.version}`
    );
  }
});

test('a privacy policy exists, since <all_urls> requires one', () => {
  if ((manifest.host_permissions || []).includes('<all_urls>')) {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'PRIVACY.md')),
      '<all_urls> requires a published privacy policy'
    );
  }
});
