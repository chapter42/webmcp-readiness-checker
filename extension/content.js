/**
 * @file content.js
 * Chrome Extension content script (ISOLATED world) for WebMCP Readiness Checker.
 *
 * Scans the page DOM for WebMCP agent-readiness signals and calculates a
 * score out of 100 across six categories. Sends structured results to the
 * background service worker via chrome.runtime.sendMessage.
 */

// Prevent double injection when executeScript re-injects on an already-loaded tab
if (window._webmcpCheckerLoaded) {
  // Already injected — do nothing
} else {
window._webmcpCheckerLoaded = true;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERLAY_CLASS = 'webmcp-checker-overlay';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Create a signal object for the results payload.
 * @param {string} name   - Human-readable signal name.
 * @param {'pass'|'warning'|'fail'} status
 * @param {string} value  - Short description of the finding.
 * @param {number} points - Points awarded for this signal.
 * @returns {{ name: string, status: string, value: string, points: number }}
 */
function signal(name, status, value, points) {
  return { name, status, value, points };
}

/**
 * Safely parse a JSON string, returning null on failure.
 * @param {string} text
 * @returns {*|null}
 */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Flatten JSON-LD data into an array of schema objects, handling both flat
 * schemas and @graph arrays.
 * @param {*} parsed - The parsed JSON-LD value.
 * @returns {Array<object>}
 */
function flattenJsonLd(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(flattenJsonLd);
  if (typeof parsed !== 'object') return [];
  if (Array.isArray(parsed['@graph'])) {
    return parsed['@graph'].flatMap(flattenJsonLd);
  }
  return [parsed];
}

/**
 * Derive a suggested toolname from a form element based on its action URL,
 * input names, id, surrounding headings, or aria-label.
 * @param {HTMLFormElement} form
 * @returns {string}
 */
function suggestToolName(form) {
  // Try aria-label or title first
  const label = form.getAttribute('aria-label') || form.getAttribute('title');
  if (label) return label.replace(/\s+/g, '-').toLowerCase();

  // Try action URL path
  const action = form.getAttribute('action') || '';
  if (action && action !== '#') {
    try {
      const path = new URL(action, location.href).pathname;
      const segments = path.split('/').filter(Boolean);
      if (segments.length) return segments.join('-');
    } catch { /* ignore */ }
  }

  // Try form id
  if (form.id) return form.id;

  // Try surrounding heading
  const heading = form.closest('section, article, div')?.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading?.textContent?.trim()) {
    return heading.textContent.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  }

  // Try first input names
  const inputs = [...form.querySelectorAll('input[name], select[name], textarea[name]')];
  if (inputs.length) {
    const names = inputs.slice(0, 3).map((i) => i.name).filter(Boolean);
    if (names.length) return `form-${names.join('-')}`;
  }

  return 'unnamed-form';
}

// ---------------------------------------------------------------------------
// Category 1: WebMCP Core (max 30 pts)
// ---------------------------------------------------------------------------

/**
 * @returns {{ score: number, max: number, signals: Array }}
 */
function scanWebMCPCore() {
  const signals = [];
  let score = 0;

  const imperativeTools = mainWorldResults?.tools || [];
  const hasImperative = !!mainWorldResults?.methodDetected || imperativeTools.length > 0;

  // ── Tools exposed at all (12 pts) ──────────────────────────────────────
  // Either declarative (form[toolname]) or imperative (registerTool observed).
  const toolForms = document.querySelectorAll('form[toolname]');
  if (toolForms.length > 0 || hasImperative) {
    score += 12;
    const parts = [];
    if (toolForms.length > 0) parts.push(`${toolForms.length} declarative form(s)`);
    if (imperativeTools.length > 0) parts.push(`${imperativeTools.length} imperative tool(s)`);
    else if (hasImperative) parts.push('registerTool available');
    signals.push(signal('tools exposed', 'pass', parts.join(', '), 12));
  } else {
    signals.push(signal('tools exposed', 'fail', 'No declarative or imperative tools found', 0));
  }

  // ── Tool descriptions (8 pts) ──────────────────────────────────────────
  const describedForms = document.querySelectorAll('form[toolname][tooldescription]');
  const describedImperative = imperativeTools.filter((t) => t.description).length;
  if (describedForms.length > 0 || describedImperative > 0) {
    score += 8;
    const parts = [];
    if (describedForms.length > 0) parts.push(`${describedForms.length} form(s)`);
    if (describedImperative > 0) parts.push(`${describedImperative} JS tool(s)`);
    signals.push(signal('tool descriptions', 'pass', parts.join(', '), 8));
  } else if (toolForms.length > 0 || imperativeTools.length > 0) {
    signals.push(signal('tool descriptions', 'warning', 'Tools found but none carry a description', 0));
  } else {
    signals.push(signal('tool descriptions', 'fail', 'No tool descriptions found', 0));
  }

  // ── Annotations (5 pts) ────────────────────────────────────────────────
  // Annotations are an imperative-API concept only: `annotations: { readOnlyHint }`
  // on the tool definition. The declarative API defines no annotation
  // attributes — earlier versions of this extension scored attributes like
  // `toolreadonly` / `tooldestructive` that have never existed in any draft.
  const annotated = imperativeTools.filter(
    (t) => t.annotations && Object.keys(t.annotations).length > 0
  );
  if (annotated.length > 0) {
    score += 5;
    const hints = [...new Set(annotated.flatMap((t) => Object.keys(t.annotations)))];
    signals.push(signal('annotations', 'pass',
      `${annotated.length} tool(s): ${hints.join(', ')}`, 5));
  } else if (imperativeTools.length > 0) {
    signals.push(signal('annotations', 'warning',
      'Imperative tools present but none declare annotations (e.g. readOnlyHint)', 0));
  } else {
    signals.push(signal('annotations', 'fail', 'No tool annotations found', 0));
  }

  // ── API surface / modernity (5 pts) ────────────────────────────────────
  // `document.modelContext` is the current location; `navigator.modelContext`
  // was deprecated in Chromium 150. Award full points for the current surface,
  // partial credit for the deprecated one, and fall back to a static keyword
  // scan for pages we could not observe at runtime.
  if (mainWorldResults?.documentSurface) {
    score += 5;
    signals.push(signal('modelContext API', 'pass',
      `document.modelContext in use${mainWorldResults.toolsAreLive ? ' (getTools verified)' : ''}`, 5));
  } else if (mainWorldResults?.navigatorSurface || hasImperative) {
    score += 3;
    signals.push(signal('modelContext API', 'warning',
      'Only navigator.modelContext observed — deprecated since Chromium 150, migrate to document.modelContext', 3));
  } else {
    const inlineScripts = [...document.querySelectorAll('script:not([src])')];
    const modern = ['document.modelContext'];
    const legacy = ['navigator.modelContext', 'modelContextTesting'];
    const generic = ['registerTool'];
    const text = inlineScripts.map((s) => s.textContent || '');
    const found = (list) => list.filter((kw) => text.some((t) => t.includes(kw)));

    const foundModern = found(modern);
    const foundLegacy = found(legacy);
    const foundGeneric = found(generic);

    if (foundModern.length > 0) {
      score += 5;
      signals.push(signal('modelContext API', 'pass', `Found in scripts: ${foundModern.join(', ')}`, 5));
    } else if (foundLegacy.length > 0 || foundGeneric.length > 0) {
      score += 3;
      signals.push(signal('modelContext API', 'warning',
        `Found: ${[...foundLegacy, ...foundGeneric].join(', ')} — deprecated surface, migrate to document.modelContext`, 3));
    } else {
      signals.push(signal('modelContext API', 'fail',
        'No modelContext / registerTool references found', 0));
    }
  }

  return { score, max: 30, signals };
}

// ---------------------------------------------------------------------------
// Category 2: Declarative Forms (max 25 pts)
// ---------------------------------------------------------------------------

/**
 * @returns {{ score: number, max: number, signals: Array }}
 */
function scanDeclarativeForms() {
  const signals = [];
  let score = 0;

  const allForms = document.querySelectorAll('form');
  const toolNameForms = document.querySelectorAll('form[toolname]');
  const toolDescForms = document.querySelectorAll('form[tooldescription]');
  const paramDescInputs = document.querySelectorAll('[toolparamdescription]');
  const autosubmitForms = document.querySelectorAll('form[toolautosubmit]');

  // forms with toolname (7 pts)
  if (toolNameForms.length > 0) {
    score += 7;
    signals.push(signal('toolname count', 'pass', `${toolNameForms.length} form(s)`, 7));
  } else {
    signals.push(signal('toolname count', 'fail', 'No forms with toolname', 0));
  }

  // forms with tooldescription (6 pts)
  if (toolDescForms.length > 0) {
    score += 6;
    signals.push(signal('tooldescription count', 'pass', `${toolDescForms.length} form(s)`, 6));
  } else {
    signals.push(signal('tooldescription count', 'fail', 'No forms with tooldescription', 0));
  }

  // inputs with toolparamdescription (4 pts)
  if (paramDescInputs.length > 0) {
    score += 4;
    signals.push(signal('toolparamdescription', 'pass', `${paramDescInputs.length} input(s)`, 4));
  } else {
    signals.push(signal('toolparamdescription', 'fail', 'No inputs with toolparamdescription', 0));
  }

  // toolautosubmit on non-sensitive forms (3 pts)
  const safeAutosubmit = [...autosubmitForms].filter((f) => {
    const hasSensitive = f.querySelector(
      'input[type="password"], input[autocomplete*="cc-"], input[autocomplete="credit-card"]'
    );
    return !hasSensitive;
  });
  if (safeAutosubmit.length > 0) {
    score += 3;
    signals.push(signal('toolautosubmit', 'pass', `${safeAutosubmit.length} safe form(s)`, 3));
  } else {
    signals.push(signal('toolautosubmit', 'fail', 'No safe toolautosubmit forms', 0));
  }

  // Coverage ratio (2 pts)
  if (allForms.length > 0) {
    const ratio = toolNameForms.length / allForms.length;
    if (ratio > 0) {
      const pts = ratio >= 1 ? 2 : Math.round(ratio * 2 * 10) / 10;
      const awarded = Math.min(2, Math.round(pts * 10) / 10);
      score += awarded;
      signals.push(signal('coverage ratio', ratio >= 1 ? 'pass' : 'warning',
        `${toolNameForms.length}/${allForms.length} forms (${(ratio * 100).toFixed(0)}%)`, awarded));
    } else {
      signals.push(signal('coverage ratio', 'fail', `0/${allForms.length} forms`, 0));
    }
  } else {
    signals.push(signal('coverage ratio', 'warning', 'No forms on page', 0));
  }

  // Agent submission handling (3 pts). The declarative API gives an
  // agent-invoked submit three integration points, all added to the draft in
  // 2026: SubmitEvent.agentInvoked / respondWith() to return a result instead
  // of navigating, the toolactivated / toolcanceled lifecycle events, and the
  // :tool-form-active / :tool-submit-active pseudo-classes for user feedback.
  const agentHandling = detectAgentSubmitHandling();
  if (agentHandling.found.length > 0) {
    score += 3;
    signals.push(signal('agent submit handling', 'pass', agentHandling.found.join(', '), 3));
  } else {
    signals.push(signal('agent submit handling', 'fail',
      'No respondWith / lifecycle events / :tool-form-active found'
      + (agentHandling.inlineOnly ? ' (inline scripts only — external bundles not scanned)' : ''),
      0));
  }

  return { score, max: 25, signals };
}

/**
 * Look for the current spec's agent-submission integration points. Only
 * inline scripts and readable stylesheets can be inspected — code inside
 * external bundles is invisible to a DOM scan, so a negative result here is
 * "not detected" rather than "not implemented".
 * @returns {{ found: string[], inlineOnly: boolean }}
 */
function detectAgentSubmitHandling() {
  const found = [];

  const scriptText = [...document.querySelectorAll('script:not([src])')]
    .map((s) => s.textContent || '')
    .join('\n');

  if (/\bagentInvoked\b/.test(scriptText) || /\brespondWith\s*\(/.test(scriptText)) {
    found.push('respondWith / agentInvoked');
  }
  if (/['"`]tool(activated|canceled|cancel)['"`]/.test(scriptText)) {
    found.push('tool lifecycle events');
  }

  // Same-origin stylesheets expose cssRules; cross-origin ones throw on
  // access, so treat those as simply unreadable.
  let cssText = '';
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) cssText += rule.cssText;
      } catch { /* cross-origin stylesheet — not readable */ }
    }
  } catch { /* ignore */ }

  if (/:tool-form-active|:tool-submit-active/.test(cssText + scriptText)) {
    found.push(':tool-form-active styling');
  }

  return { found, inlineOnly: true };
}

// ---------------------------------------------------------------------------
// Category 3: Structured Data (max 20 pts)
// ---------------------------------------------------------------------------

/**
 * @returns {{ score: number, max: number, signals: Array }}
 */
function scanStructuredData() {
  const signals = [];
  let score = 0;

  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');

  // JSON-LD presence (3 pts)
  if (ldScripts.length > 0) {
    score += 3;
    signals.push(signal('JSON-LD blocks', 'pass', `${ldScripts.length} block(s) found`, 3));
  } else {
    signals.push(signal('JSON-LD blocks', 'fail', 'No JSON-LD found', 0));
    return { score, max: 20, signals };
  }

  // Collect all schema objects
  const schemas = [];
  for (const el of ldScripts) {
    const parsed = safeParse(el.textContent);
    schemas.push(...flattenJsonLd(parsed));
  }

  const types = schemas.map((s) => s['@type']).flat().filter(Boolean);

  // potentialAction (7 pts)
  const actionSchemas = schemas.filter((s) => s.potentialAction);
  const actionTypes = actionSchemas.flatMap((s) => {
    const pa = Array.isArray(s.potentialAction) ? s.potentialAction : [s.potentialAction];
    return pa.map((a) => a?.['@type']).filter(Boolean);
  });
  if (actionTypes.length > 0) {
    score += 7;
    signals.push(signal('potentialAction', 'pass', `Actions: ${[...new Set(actionTypes)].join(', ')}`, 7));
  } else {
    signals.push(signal('potentialAction', 'fail', 'No potentialAction found', 0));
  }

  // Product / Offer with price & availability (5 pts)
  const productTypes = ['Product', 'Offer', 'AggregateOffer'];
  const hasProduct = schemas.some((s) => {
    const t = Array.isArray(s['@type']) ? s['@type'] : [s['@type']];
    if (!t.some((v) => productTypes.includes(v))) return false;
    const offers = s.offers
      ? (Array.isArray(s.offers) ? s.offers : [s.offers])
      : [s];
    return offers.some((o) => o.price != null || o.availability != null);
  });
  if (hasProduct) {
    score += 5;
    signals.push(signal('Product/Offer schema', 'pass', 'Product or Offer with price/availability', 5));
  } else {
    signals.push(signal('Product/Offer schema', 'fail', 'No Product/Offer schema with price/availability', 0));
  }

  // Organization / WebSite (3 pts)
  const orgTypes = ['Organization', 'WebSite', 'LocalBusiness', 'Corporation'];
  const hasOrg = types.some((t) => orgTypes.includes(t));
  if (hasOrg) {
    score += 3;
    signals.push(signal('Organization/WebSite', 'pass', 'Organization or WebSite schema found', 3));
  } else {
    signals.push(signal('Organization/WebSite', 'fail', 'No Organization or WebSite schema', 0));
  }

  // FAQPage (2 pts)
  const hasFaq = types.includes('FAQPage');
  if (hasFaq) {
    score += 2;
    signals.push(signal('FAQPage', 'pass', 'FAQPage schema found', 2));
  } else {
    signals.push(signal('FAQPage', 'fail', 'No FAQPage schema', 0));
  }

  return { score, max: 20, signals };
}

// ---------------------------------------------------------------------------
// Category 4: Discovery (max 15 pts) -- placeholder, filled by background
// ---------------------------------------------------------------------------

/**
 * Build the discovery category with default (unfilled) values.
 * @returns {{ score: number, max: number, signals: Array }}
 */
function buildDiscoveryPlaceholder() {
  return {
    score: 0,
    max: 15,
    signals: [
      signal('webmcp manifest', 'fail', 'Awaiting background check', 0),
      signal('llms.txt', 'fail', 'Awaiting background check', 0),
      signal('robots.txt AI crawlers', 'fail', 'Awaiting background check', 0),
      signal('sitemap directive', 'fail', 'Awaiting background check', 0),
    ],
  };
}

/**
 * Fill discovery category with data returned from the background script.
 * @param {{ robots: object, llms: object, webmcp: object, webmcpJson: object }} discovery
 * @returns {{ score: number, max: number, signals: Array }}
 */
function fillDiscovery(discovery) {
  const signals = [];
  let score = 0;

  // webmcp manifest (5 pts) — check .well-known/webmcp or .well-known/webmcp.json
  const hasWebmcp = discovery.webmcp?.status === 200 && discovery.webmcp.content;
  const hasWebmcpJson = discovery.webmcpJson?.status === 200 && discovery.webmcpJson.content;
  if (hasWebmcp || hasWebmcpJson) {
    const found = [hasWebmcp && '.well-known/webmcp', hasWebmcpJson && '.well-known/webmcp.json'].filter(Boolean).join(' and ');
    score += 5;
    signals.push(signal('webmcp manifest', 'pass', `${found} found`, 5));
  } else {
    signals.push(signal('webmcp manifest', 'fail', 'No .well-known/webmcp or .well-known/webmcp.json', 0));
  }

  // llms.txt (4 pts)
  if (discovery.llms?.status === 200 && discovery.llms.content) {
    score += 4;
    signals.push(signal('llms.txt', 'pass', 'llms.txt found', 4));
  } else {
    signals.push(signal('llms.txt', 'fail', 'No llms.txt', 0));
  }

  // robots.txt AI crawlers allowed (4 pts)
  if (discovery.robots?.status === 200 && discovery.robots.content) {
    // Check that common AI bots are NOT disallowed. `claudebot` is Anthropic's
    // current crawler; `claude-web` and `anthropic-ai` are the older names and
    // are kept so sites that still block those are flagged.
    const aiBots = [
      'gptbot', 'chatgpt-user', 'oai-searchbot',
      'claudebot', 'claude-web', 'anthropic-ai',
      'google-extended', 'perplexitybot', 'ccbot',
    ];
    const disallowed = aiBots.filter((bot) => {
      const pattern = new RegExp(`user-agent:\\s*${bot}[\\s\\S]*?disallow:\\s*/`, 'i');
      return pattern.test(discovery.robots.content);
    });
    if (disallowed.length === 0) {
      score += 4;
      signals.push(signal('robots.txt AI crawlers', 'pass', 'AI crawlers not blocked', 4));
    } else {
      signals.push(signal('robots.txt AI crawlers', 'warning',
        `Blocked: ${disallowed.join(', ')}`, 0));
    }

    // sitemap directive (2 pts)
    if (/^sitemap:\s*http/im.test(discovery.robots.content)) {
      score += 2;
      signals.push(signal('sitemap directive', 'pass', 'Sitemap directive found in robots.txt', 2));
    } else {
      signals.push(signal('sitemap directive', 'fail', 'No sitemap directive in robots.txt', 0));
    }
  } else {
    signals.push(signal('robots.txt AI crawlers', 'fail', 'robots.txt not accessible', 0));
    signals.push(signal('sitemap directive', 'fail', 'robots.txt not accessible', 0));
  }

  return { score, max: 15, signals };
}

// ---------------------------------------------------------------------------
// Category 5: Technical Foundation (max 10 pts)
// ---------------------------------------------------------------------------

/**
 * @returns {{ score: number, max: number, signals: Array }}
 */
function scanTechnicalFoundation() {
  const signals = [];
  let score = 0;

  // HTTPS / secure context (3 pts). WebMCP is not merely "better" over HTTPS —
  // it is gated on a secure context, so without one no tool can ever be
  // registered regardless of how well the page is annotated.
  if (window.isSecureContext) {
    score += 3;
    signals.push(signal('HTTPS', 'pass', 'Secure context — WebMCP can run', 3));
  } else {
    signals.push(signal('HTTPS', 'fail',
      `Not a secure context (${location.protocol}) — WebMCP is unavailable entirely`, 0));
  }

  // Semantic HTML (3 pts) -- check heading hierarchy, label[for], ARIA landmarks
  let semanticScore = 0;
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const hasHeadingHierarchy = headings.length > 0;
  if (hasHeadingHierarchy) semanticScore += 1;

  const labelsWithFor = document.querySelectorAll('label[for]');
  if (labelsWithFor.length > 0) semanticScore += 1;

  const ariaLandmarks = document.querySelectorAll(
    '[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], ' +
    'header, nav, main, footer, aside, [role="complementary"], [role="search"]'
  );
  if (ariaLandmarks.length >= 2) semanticScore += 1;

  score += semanticScore;
  const semanticDetails = [
    `headings: ${headings.length}`,
    `label[for]: ${labelsWithFor.length}`,
    `landmarks: ${ariaLandmarks.length}`,
  ].join(', ');
  signals.push(signal('semantic HTML', semanticScore >= 2 ? 'pass' : 'warning',
    `${semanticDetails} (${semanticScore}/3)`, semanticScore));

  // SSR (2 pts) -- body has more than 2 children and meaningful text
  const bodyChildren = document.body ? document.body.children.length : 0;
  const bodyText = document.body ? document.body.innerText?.trim() || '' : '';
  const hasSSR = bodyChildren > 2 && bodyText.length > 100;
  if (hasSSR) {
    score += 2;
    signals.push(signal('SSR / content', 'pass', `${bodyChildren} body children, ${bodyText.length} chars text`, 2));
  } else {
    signals.push(signal('SSR / content', 'warning',
      `${bodyChildren} body children, ${bodyText.length} chars text`, 0));
  }

  // Stable form IDs (2 pts) -- forms and key inputs have id attributes
  const allForms = document.querySelectorAll('form');
  const formsWithId = [...allForms].filter((f) => f.id).length;
  const keyInputs = document.querySelectorAll('input[name], select[name], textarea[name]');
  const inputsWithId = [...keyInputs].filter((i) => i.id).length;
  const totalElements = allForms.length + keyInputs.length;
  const elementsWithId = formsWithId + inputsWithId;

  if (totalElements === 0) {
    signals.push(signal('stable IDs', 'warning', 'No forms or named inputs on page', 0));
  } else {
    const ratio = elementsWithId / totalElements;
    const idPts = ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0;
    score += idPts;
    signals.push(signal('stable IDs', idPts >= 2 ? 'pass' : 'warning',
      `${elementsWithId}/${totalElements} elements have id (${(ratio * 100).toFixed(0)}%)`, idPts));
  }

  return { score, max: 10, signals };
}

// ---------------------------------------------------------------------------
// Category 6: Security (flags only, no points)
// ---------------------------------------------------------------------------

/**
 * @returns {{ warnings: Array }}
 */
function scanSecurity() {
  const warnings = [];

  // Password fields in autosubmit forms
  const autosubmitWithPassword = document.querySelectorAll(
    'form[toolautosubmit] input[type="password"]'
  );
  if (autosubmitWithPassword.length > 0) {
    warnings.push(signal('autosubmit + password', 'warning',
      'toolautosubmit form contains a password field', 0));
  }

  // Credit card autocomplete in autosubmit forms
  const ccSelectors = [
    'form[toolautosubmit] input[autocomplete*="cc-"]',
    'form[toolautosubmit] input[autocomplete="credit-card"]',
  ];
  const autosubmitWithCC = document.querySelectorAll(ccSelectors.join(', '));
  if (autosubmitWithCC.length > 0) {
    warnings.push(signal('autosubmit + credit card', 'warning',
      'toolautosubmit form contains credit card fields', 0));
  }

  return { warnings };
}

// ---------------------------------------------------------------------------
// Forms inventory
// ---------------------------------------------------------------------------

/**
 * Collect detailed inventory for every form on the page.
 * @returns {Array<object>}
 */
function collectForms() {
  const allForms = document.querySelectorAll('form');
  return [...allForms].map((form) => {
    // Collect all attributes
    const attributes = {};
    for (const attr of form.attributes) {
      attributes[attr.name] = attr.value;
    }

    // Collect child inputs
    const inputs = [...form.querySelectorAll('input, select, textarea')].map((el) => {
      const inputAttrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('tool')) {
          inputAttrs[attr.name] = attr.value;
        }
      }
      return {
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute('name') || null,
        type: el.getAttribute('type') || (el.tagName === 'SELECT' ? 'select' : 'textarea'),
        id: el.id || null,
        placeholder: el.getAttribute('placeholder') || null,
        required: el.hasAttribute('required'),
        toolAttributes: Object.keys(inputAttrs).length > 0 ? inputAttrs : undefined,
      };
    });

    const hasToolname = form.hasAttribute('toolname');

    return {
      toolname: form.getAttribute('toolname') || null,
      suggestedToolname: hasToolname ? undefined : suggestToolName(form),
      tooldescription: form.getAttribute('tooldescription') || null,
      action: form.getAttribute('action') || null,
      method: (form.getAttribute('method') || 'GET').toUpperCase(),
      id: form.id || null,
      attributes,
      inputs,
    };
  });
}

// ---------------------------------------------------------------------------
// Tools inventory
// ---------------------------------------------------------------------------

/**
 * Build an inventory of all discovered WebMCP tools (from declarative forms
 * and/or MAIN world injection results).
 * @param {Array<object>} forms     - Forms inventory from collectForms().
 * @param {Array<object>|null} mainWorldTools - Tools detected from MAIN world.
 * @returns {Array<object>}
 */
function collectTools(forms, mainWorldTools) {
  const tools = [];

  // Declarative tools (from forms with toolname)
  for (const form of forms) {
    if (!form.toolname) continue;

    const params = (form.inputs || []).filter((i) => i.name).map((i) => ({
      name: i.name,
      type: i.type || 'text',
      required: i.required,
      description: i.toolAttributes?.toolparamdescription || null,
    }));

    const qualityIssues = [];
    if (!form.tooldescription) qualityIssues.push('missing tooldescription');
    const untypedParams = params.filter((p) => !p.type || p.type === 'text');
    if (untypedParams.length > 0) {
      qualityIssues.push(`${untypedParams.length} untyped parameter(s)`);
    }
    const undescribedParams = params.filter((p) => !p.description);
    if (undescribedParams.length > 0) {
      qualityIssues.push(`${undescribedParams.length} parameter(s) without description`);
    }

    tools.push({
      name: form.toolname,
      description: form.tooldescription || null,
      source: 'form',
      inputSchema: params,
      quality: qualityIssues.length > 0 ? qualityIssues : ['good'],
    });
  }

  // MAIN world tools (from inject.js results)
  if (Array.isArray(mainWorldTools)) {
    for (const tool of mainWorldTools) {
      tools.push({
        name: tool.name || 'unknown',
        description: tool.description || null,
        source: 'js',
        inputSchema: tool.inputSchema || tool.params || [],
        quality: tool.description ? ['good'] : ['missing description'],
      });
    }
  }

  return tools;
}

// ---------------------------------------------------------------------------
// Recommendations generator
// ---------------------------------------------------------------------------

/**
 * Generate actionable recommendations based on scan findings.
 * @param {object} categories
 * @param {Array<object>} forms
 * @param {Array<object>} tools
 * @returns {Array<string>}
 */
function generateRecommendations(categories, forms, tools) {
  const recs = [];

  // Forms without toolname
  const untooledForms = forms.filter((f) => !f.toolname);
  for (const form of untooledForms) {
    const suggested = form.suggestedToolname || 'unnamed-form';
    const identifier = form.id ? `form#${form.id}` : `form[action="${form.action || ''}"]`;
    recs.push(
      `Add toolname to ${identifier}: <form toolname="${suggested}" tooldescription="...">`
    );
  }

  // No JSON-LD
  if (categories.structuredData.score === 0) {
    recs.push(
      'Add JSON-LD structured data with at minimum WebSite and Organization schemas.'
    );
  } else {
    const sdSignals = categories.structuredData.signals || [];
    const noOrg = sdSignals.find((s) => s.name === 'Organization/WebSite' && s.status === 'fail');
    if (noOrg) {
      recs.push('Add Organization or WebSite JSON-LD schema to improve discovery.');
    }
    const noAction = sdSignals.find((s) => s.name === 'potentialAction' && s.status === 'fail');
    if (noAction) {
      recs.push(
        'Add potentialAction (e.g. SearchAction) to your JSON-LD to expose actionable endpoints.'
      );
    }
  }

  // Discovery recommendations
  const disc = categories.discovery.signals || [];
  const noLlms = disc.find((s) => s.name === 'llms.txt' && s.status === 'fail');
  if (noLlms) {
    recs.push('Create an /llms.txt file describing your site for AI agents.');
  }
  const noManifest = disc.find((s) => s.name === 'webmcp manifest' && s.status === 'fail');
  if (noManifest) {
    recs.push('Create a /.well-known/webmcp or /.well-known/webmcp.json manifest listing your agent-accessible tools.');
  }

  // Missing tooldescription on tools
  const missingDesc = tools.filter((t) => !t.description);
  if (missingDesc.length > 0) {
    recs.push(
      `Add tooldescription to ${missingDesc.length} tool(s): ${missingDesc.map((t) => t.name).join(', ')}`
    );
  }

  // Secure context — a hard prerequisite, so surface it first.
  if (!window.isSecureContext) {
    recs.unshift(
      'Serve this page over HTTPS. WebMCP requires a secure context; without one '
      + 'no tools can be registered at all, whatever else the page does.'
    );
  }

  // Deprecated API surface — actionable migration step.
  if (mainWorldResults?.navigatorSurface && !mainWorldResults?.documentSurface) {
    recs.push(
      'Migrate tool registration from navigator.modelContext to document.modelContext '
      + '(deprecated in Chromium 150). Feature-detect both during the origin trial: '
      + 'const modelContext = document.modelContext ?? navigator.modelContext;'
    );
  }

  // Imperative tools without annotations.
  const unannotated = (mainWorldResults?.tools || []).filter(
    (t) => !t.annotations || Object.keys(t.annotations).length === 0
  );
  if (unannotated.length > 0) {
    recs.push(
      `Add annotations to ${unannotated.length} imperative tool(s) — at minimum `
      + 'annotations: { readOnlyHint: true } on tools that do not modify state, '
      + 'so agents know which calls are safe to make.'
    );
  }

  // Dedupe: multiple form instances (e.g. Gravity Forms rendering #gform_1
  // twice in the live DOM) would otherwise produce identical recommendation
  // strings. Preserve first-occurrence order.
  return [...new Set(recs)];
}

// ---------------------------------------------------------------------------
// Main scanning function
// ---------------------------------------------------------------------------

/** @type {object|null} Cached MAIN world injection results. */
let mainWorldResults = null;

/** @type {object|null} Cached discovery results from background. */
let discoveryResults = null;

/**
 * @type {boolean} Whether the MAIN-world results listener is already attached.
 * Every scan calls requestMainWorldInjection(); without this guard each
 * re-scan stacked another listener, so a single tool registration ended up
 * firing one full re-scan per historical scan.
 */
let mainWorldListenerAttached = false;


/**
 * Scan the current page for WebMCP agent-readiness signals.
 * @returns {object} Full scan results object.
 */
function scanPage() {
  const webmcpCore = scanWebMCPCore();
  const declarativeForms = scanDeclarativeForms();
  const structuredData = scanStructuredData();
  const discovery = discoveryResults
    ? fillDiscovery(discoveryResults)
    : buildDiscoveryPlaceholder();
  const technicalFoundation = scanTechnicalFoundation();
  const security = scanSecurity();

  const forms = collectForms();
  const tools = collectTools(forms, mainWorldResults?.tools || null);

  const categories = {
    webmcpCore,
    declarativeForms,
    structuredData,
    discovery,
    technicalFoundation,
    security,
  };

  const total = webmcpCore.score
    + declarativeForms.score
    + structuredData.score
    + discovery.score
    + technicalFoundation.score;

  const recommendations = generateRecommendations(categories, forms, tools);

  return {
    url: location.href,
    domain: location.hostname,
    timestamp: new Date().toISOString(),
    score: { total, max: 100 },
    categories,
    forms,
    tools,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Send results to background
// ---------------------------------------------------------------------------

/**
 * Run a full scan and send results to the background service worker.
 */
async function runScanAndReport() {
  const data = scanPage();
  try {
    await chrome.runtime.sendMessage({ type: 'SCAN_RESULTS', data });
  } catch (err) {
    // The service worker may be asleep or the panel closed — not fatal.
    console.warn('[webMCP] Failed to send scan results:', err);
  }
}

// ---------------------------------------------------------------------------
// Discovery data fetching
// ---------------------------------------------------------------------------

/**
 * Request discovery files from the background script and re-scan once received.
 */
async function requestDiscoveryData() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_DISCOVERY',
      origin: location.origin,
    });
    if (response?.data) {
      discoveryResults = response.data;
      await runScanAndReport();
    }
  } catch (err) {
    console.warn('[webMCP] Failed to request discovery data:', err);
  }
}

// ---------------------------------------------------------------------------
// MAIN world injection
// ---------------------------------------------------------------------------

/**
 * Ask the MAIN-world inject.js for a fresh snapshot of the page's model
 * context state and its tool registry. inject.js is normally already
 * running as a declared MAIN-world content script from document_start. If
 * this is a pre-existing tab that loaded before the extension was installed,
 * we also ask background to dynamically inject it as a fallback.
 */
async function requestMainWorldInjection() {
  // Listen for results dispatched by inject.js. Not `once` — inject.js
  // re-dispatches whenever a tool is registered or the browser fires
  // `toolchange`, so a late-mounting React component that calls
  // registerTool() after our initial snapshot still updates the side panel.
  // Registered only once: repeated scans must not stack duplicate listeners.
  if (!mainWorldListenerAttached) {
    mainWorldListenerAttached = true;
    window.addEventListener('webmcp-checker-main-results', (event) => {
      if (event.detail) {
        mainWorldResults = event.detail;
        runScanAndReport();
      }
    });
  }

  // Dispatch a request event — if the declared content script is running,
  // inject.js will respond immediately.
  try {
    window.dispatchEvent(new CustomEvent('webmcp-checker-main-request'));
  } catch { /* ignore */ }

  // Fallback: ask background to executeScript inject.js into MAIN world
  // for tabs where the declared content_script never got a chance to run
  // (extension installed/reloaded after this page loaded). The double-load
  // guard in inject.js makes this a no-op if the declared script is already
  // running.
  try {
    await chrome.runtime.sendMessage({ type: 'INJECT_MAIN_WORLD' });
  } catch (err) {
    console.warn('[webMCP] Main world injection fallback failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Overlay toggle
// ---------------------------------------------------------------------------

/** @type {boolean} Whether the overlay is currently active. */
let overlayActive = false;

/**
 * Apply a callback to elements in small batches, yielding to the browser
 * between each batch so a form-heavy page never freezes while the overlay
 * is drawn.
 * @param {Array<Element>} elements
 * @param {(el: Element) => void} fn
 * @param {number} batchSize
 */
async function batchApply(elements, fn, batchSize = 20) {
  for (let i = 0; i < elements.length; i += batchSize) {
    const slice = elements.slice(i, i + batchSize);
    await new Promise((resolve) => requestAnimationFrame(() => {
      slice.forEach(fn);
      resolve();
    }));
    if (globalThis.scheduler?.yield) await scheduler.yield();
  }
}

/**
 * Toggle the visual overlay that highlights forms and JSON-LD on the page.
 * @returns {Promise<void>}
 */
async function toggleOverlay() {
  if (overlayActive) {
    // Remove all overlay elements
    const overlayEls = document.querySelectorAll(`.${OVERLAY_CLASS}`);
    overlayEls.forEach((el) => el.remove());

    // Remove inline styles added to forms
    document.querySelectorAll('[data-webmcp-overlay-styled]').forEach((el) => {
      el.style.outline = '';
      el.style.position = '';
      el.removeAttribute('data-webmcp-overlay-styled');
    });

    overlayActive = false;
    return;
  }

  // Activate overlay
  overlayActive = true;

  const allForms = [...document.querySelectorAll('form')];
  await batchApply(allForms, (form) => {
    const hasToolname = form.hasAttribute('toolname');

    // Style the form
    form.style.outline = hasToolname
      ? '3px solid #22c55e'
      : '3px dashed #ef4444';
    form.style.position = form.style.position || 'relative';
    form.setAttribute('data-webmcp-overlay-styled', '');

    // Create floating label
    const label = document.createElement('div');
    label.className = OVERLAY_CLASS;
    label.textContent = hasToolname
      ? `WebMCP Tool: ${form.getAttribute('toolname')}`
      : 'No tool defined';
    Object.assign(label.style, {
      position: 'absolute',
      top: '-24px',
      left: '0',
      padding: '2px 8px',
      fontSize: '11px',
      fontWeight: '600',
      fontFamily: 'system-ui, sans-serif',
      color: '#ffffff',
      backgroundColor: hasToolname ? '#22c55e' : '#ef4444',
      borderRadius: '4px 4px 0 0',
      zIndex: '999999',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });

    // Ensure form has relative positioning for absolute child
    if (getComputedStyle(form).position === 'static') {
      form.style.position = 'relative';
    }
    form.appendChild(label);
  });

  // Highlight JSON-LD script tags' parent elements
  const ldScripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  await batchApply(ldScripts, (script) => {
    const parent = script.parentElement;
    if (parent && parent !== document.head) {
      const highlight = document.createElement('div');
      highlight.className = OVERLAY_CLASS;
      Object.assign(highlight.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        border: '2px solid #3b82f6',
        zIndex: '999999',
        pointerEvents: 'none',
        borderRadius: '4px',
      });

      const parentPos = getComputedStyle(parent).position;
      if (parentPos === 'static') {
        parent.style.position = 'relative';
        parent.setAttribute('data-webmcp-overlay-styled', '');
      }
      parent.appendChild(highlight);
    }
  });
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REQUEST_SCAN') {
    // Run DOM scan immediately and return results directly
    const data = scanPage();
    sendResponse({ data });

    // Then fetch async data (discovery + main world) and send updates
    discoveryResults = null;
    mainWorldResults = null;
    requestDiscoveryData();
    requestMainWorldInjection();
    return false;
  }

  if (message.type === 'TOGGLE_OVERLAY') {
    // toggleOverlay() flips `overlayActive` synchronously before its first
    // await, so the response below already reflects the new state while the
    // batched DOM work continues in the background.
    toggleOverlay().catch((err) => console.error('[webMCP] Overlay failed:', err));
    sendResponse({ overlayActive });
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Auto-scan on load
// ---------------------------------------------------------------------------

// No auto-scan on load — user triggers scans via the side panel Re-scan button.

} // end double-injection guard
