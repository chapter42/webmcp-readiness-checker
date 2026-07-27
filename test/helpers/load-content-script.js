/**
 * @file test/helpers/load-content-script.js
 * Loads extension/content.js into a sandboxed VM with a stubbed DOM so the
 * scoring functions can be called directly from tests.
 *
 * content.js is wrapped in a double-injection guard (`if (window._webmcpCheckerLoaded)
 * {...} else {...}`) which would otherwise keep its functions out of reach.
 * The guard is stripped before evaluation.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CONTENT_JS = path.join(__dirname, '..', '..', 'extension', 'content.js');

const GUARD_OPEN = /if \(window\._webmcpCheckerLoaded\)[\s\S]*?\} else \{/;
const GUARD_CLOSE = /\}\s*\/\/ end double-injection guard\s*$/;

/**
 * Build a stub element.
 * @param {Record<string, string>} attrs
 * @param {Array<object>} kids
 */
function el(attrs = {}, kids = []) {
  return {
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    hasAttribute: (n) => n in attrs,
    querySelector: () => null,
    querySelectorAll: () => kids,
    closest: () => null,
    id: attrs.id || '',
    name: attrs.name || '',
    tagName: (attrs._tag || 'INPUT').toUpperCase(),
    textContent: attrs._text || '',
    style: {},
  };
}

/**
 * A document stub where every selector either matches a rich element
 * (`populated: true`) or nothing at all (`populated: false`).
 * @param {boolean} populated
 */
function makeDocument(populated) {
  const input = el({ name: 'q', id: 'q', type: 'text', toolparamdescription: 'desc' });
  const form = el({ toolname: 't', tooldescription: 'd', toolautosubmit: '', id: 'f' }, [input]);
  const ldSingle = el({
    _text: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'x',
      potentialAction: { '@type': 'SearchAction' },
    }),
  });
  const ldGraph = el({
    _text: JSON.stringify([
      { '@type': 'Product', offers: { price: 1, availability: 'InStock' } },
      { '@type': 'FAQPage' },
    ]),
  });
  const script = el({
    _text: 'document.modelContext.registerTool({}); respondWith(p); "toolactivated"',
  });

  return {
    querySelectorAll: (sel) => {
      if (!populated) return [];
      if (sel.includes('ld+json')) return [ldSingle, ldGraph];
      if (sel.includes('script:not([src])')) return [script];
      if (sel.startsWith('form')) return [form];
      if (sel.includes('h1')) return [el(), el()];
      if (sel.includes('label[for]')) return [el()];
      if (sel.includes('role=') || sel.includes('header')) return [el(), el(), el()];
      return [input];
    },
    querySelector: () => (populated ? el() : null),
    styleSheets: [],
    body: populated
      ? { children: { length: 5 }, innerText: 'x'.repeat(500) }
      : { children: { length: 0 }, innerText: '' },
    head: {},
  };
}

/**
 * Evaluate content.js in a sandbox and return the sandbox context.
 * @param {{ populated?: boolean, secure?: boolean, mainWorldResults?: object|null }} opts
 * @returns {object} vm context exposing the scan functions
 */
function loadContentScript(opts = {}) {
  const { populated = true, secure = true, mainWorldResults = null } = opts;

  let src = fs.readFileSync(CONTENT_JS, 'utf8');
  if (!GUARD_OPEN.test(src)) {
    throw new Error('content.js double-injection guard not found — update the test helper');
  }
  src = src.replace(GUARD_OPEN, '').replace(GUARD_CLOSE, '');

  const sandbox = {
    console,
    chrome: {
      runtime: {
        sendMessage: async () => {},
        onMessage: { addListener() {} },
      },
    },
    document: makeDocument(populated),
    window: { isSecureContext: secure, addEventListener() {}, dispatchEvent() {} },
    location: {
      protocol: secure ? 'https:' : 'http:',
      href: 'https://example.com/',
      hostname: 'example.com',
      origin: 'https://example.com',
    },
    getComputedStyle: () => ({ position: 'static' }),
    requestAnimationFrame: (fn) => fn(),
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  vm.runInContext(`mainWorldResults = ${JSON.stringify(mainWorldResults)};`, sandbox);
  return sandbox;
}

/**
 * Discovery payload shaped like what background.js returns.
 * @param {boolean} found
 */
function discoveryFixture(found) {
  const ok = (content) => ({ status: found ? 200 : 404, content: found ? content : null });
  return {
    webmcp: ok('{}'),
    webmcpJson: ok('{}'),
    llms: ok('# site'),
    robots: ok('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml'),
  };
}

/**
 * Run every scoring category and return {categories, total, max}.
 * @param {object} sandbox
 * @param {boolean} discoveryFound
 */
function scoreAll(sandbox, discoveryFound) {
  const run = (expr) => vm.runInContext(expr, sandbox);
  const categories = {
    webmcpCore: run('scanWebMCPCore()'),
    declarativeForms: run('scanDeclarativeForms()'),
    structuredData: run('scanStructuredData()'),
    discovery: run(`fillDiscovery(${JSON.stringify(discoveryFixture(discoveryFound))})`),
    technicalFoundation: run('scanTechnicalFoundation()'),
  };
  const total = Object.values(categories).reduce((sum, c) => sum + c.score, 0);
  const max = Object.values(categories).reduce((sum, c) => sum + c.max, 0);
  return { categories, total, max };
}

module.exports = { loadContentScript, scoreAll, discoveryFixture };
