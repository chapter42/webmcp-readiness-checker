/**
 * @file content.js
 * Chrome Extension content script (ISOLATED world) for WebMCP Readiness Checker.
 *
 * Scans the page DOM for WebMCP agent-readiness signals and calculates a
 * score out of 100 across six categories. Sends structured results to the
 * background service worker via chrome.runtime.sendMessage.
 */

/* eslint-env browser */
/* global chrome */

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

  // Check for form[toolname]
  const toolForms = document.querySelectorAll('form[toolname]');
  if (toolForms.length > 0) {
    score += 15;
    signals.push(signal('form[toolname]', 'pass', `${toolForms.length} form(s) with toolname`, 15));
  } else {
    signals.push(signal('form[toolname]', 'fail', 'No forms with toolname attribute', 0));
  }

  // Check for tooldescription on those forms
  const describedForms = document.querySelectorAll('form[toolname][tooldescription]');
  if (describedForms.length > 0) {
    score += 10;
    signals.push(signal('tooldescription', 'pass', `${describedForms.length} form(s) with tooldescription`, 10));
  } else if (toolForms.length > 0) {
    signals.push(signal('tooldescription', 'warning', 'Tool forms found but missing tooldescription', 0));
  } else {
    signals.push(signal('tooldescription', 'fail', 'No tooldescription attributes found', 0));
  }

  // Check for annotation-related attributes
  const annotationAttrs = [
    'toolannotation', 'toolreadonly', 'tooldestructive', 'toolidempotent', 'toolopenworldhint'
  ];
  const annotationFound = annotationAttrs.some(
    (attr) => document.querySelector(`[${attr}]`) !== null
  );
  if (annotationFound) {
    score += 5;
    signals.push(signal('annotations', 'pass', 'Annotation attributes found on elements', 5));
  } else {
    signals.push(signal('annotations', 'fail', 'No annotation attributes found', 0));
  }

  // Check inline scripts for navigator.modelContext / registerTool / modelContextTesting
  const inlineScripts = [...document.querySelectorAll('script:not([src])')];
  const mcpKeywords = ['navigator.modelContext', 'registerTool', 'modelContextTesting'];
  const foundKeywords = mcpKeywords.filter((kw) =>
    inlineScripts.some((s) => s.textContent.includes(kw))
  );
  if (foundKeywords.length > 0) {
    score += 5;
    signals.push(signal('script references', 'pass', `Found: ${foundKeywords.join(', ')}`, 5));
  } else {
    signals.push(signal('script references', 'fail', 'No modelContext / registerTool references in scripts', 0));
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

  // forms with toolname (8 pts)
  if (toolNameForms.length > 0) {
    score += 8;
    signals.push(signal('toolname count', 'pass', `${toolNameForms.length} form(s)`, 8));
  } else {
    signals.push(signal('toolname count', 'fail', 'No forms with toolname', 0));
  }

  // forms with tooldescription (7 pts)
  if (toolDescForms.length > 0) {
    score += 7;
    signals.push(signal('tooldescription count', 'pass', `${toolDescForms.length} form(s)`, 7));
  } else {
    signals.push(signal('tooldescription count', 'fail', 'No forms with tooldescription', 0));
  }

  // inputs with toolparamdescription (5 pts)
  if (paramDescInputs.length > 0) {
    score += 5;
    signals.push(signal('toolparamdescription', 'pass', `${paramDescInputs.length} input(s)`, 5));
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

  return { score, max: 25, signals };
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
 * @param {{ robots: object, llms: object, webmcp: object }} discovery
 * @returns {{ score: number, max: number, signals: Array }}
 */
function fillDiscovery(discovery) {
  const signals = [];
  let score = 0;

  // webmcp manifest (5 pts)
  if (discovery.webmcp?.status === 200 && discovery.webmcp.content) {
    score += 5;
    signals.push(signal('webmcp manifest', 'pass', '.well-known/webmcp found', 5));
  } else {
    signals.push(signal('webmcp manifest', 'fail', 'No .well-known/webmcp', 0));
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
    const content = discovery.robots.content.toLowerCase();
    // Check that common AI bots are NOT disallowed
    const aiBots = ['gptbot', 'chatgpt-user', 'anthropic-ai', 'claude-web', 'google-extended'];
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

  // HTTPS (3 pts)
  if (location.protocol === 'https:') {
    score += 3;
    signals.push(signal('HTTPS', 'pass', 'Page served over HTTPS', 3));
  } else {
    signals.push(signal('HTTPS', 'fail', `Protocol: ${location.protocol}`, 0));
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
    recs.push('Create a /.well-known/webmcp manifest listing your agent-accessible tools.');
  }

  // Missing tooldescription on tools
  const missingDesc = tools.filter((t) => !t.description);
  if (missingDesc.length > 0) {
    recs.push(
      `Add tooldescription to ${missingDesc.length} tool(s): ${missingDesc.map((t) => t.name).join(', ')}`
    );
  }

  // HTTPS
  if (location.protocol !== 'https:') {
    recs.push('Serve the page over HTTPS for secure agent interactions.');
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Main scanning function
// ---------------------------------------------------------------------------

/** @type {object|null} Cached MAIN world injection results. */
let mainWorldResults = null;

/** @type {object|null} Cached discovery results from background. */
let discoveryResults = null;


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
function runScanAndReport() {
  const data = scanPage();
  try {
    chrome.runtime.sendMessage({ type: 'SCAN_RESULTS', data });
  } catch (err) {
    console.error('[webMCP] Failed to send scan results:', err);
  }
}

// ---------------------------------------------------------------------------
// Discovery data fetching
// ---------------------------------------------------------------------------

/**
 * Request discovery files from the background script and re-scan once received.
 */
function requestDiscoveryData() {
  try {
    chrome.runtime.sendMessage(
      { type: 'FETCH_DISCOVERY', origin: location.origin },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[webMCP] Discovery fetch error:', chrome.runtime.lastError.message);
          return;
        }
        if (response?.data) {
          discoveryResults = response.data;
          runScanAndReport();
        }
      }
    );
  } catch (err) {
    console.warn('[webMCP] Failed to request discovery data:', err);
  }
}

// ---------------------------------------------------------------------------
// MAIN world injection
// ---------------------------------------------------------------------------

/**
 * Request the background to inject the MAIN world script, then listen for
 * results dispatched by inject.js via a custom window event.
 */
function requestMainWorldInjection() {
  // Listen for results from the injected MAIN world script
  window.addEventListener('webmcp-checker-main-results', (event) => {
    if (event.detail) {
      mainWorldResults = event.detail;
      runScanAndReport();
    }
  }, { once: true });

  try {
    chrome.runtime.sendMessage({ type: 'INJECT_MAIN_WORLD' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[webMCP] Main world injection error:', chrome.runtime.lastError.message);
      }
    });
  } catch (err) {
    console.warn('[webMCP] Failed to request main world injection:', err);
  }
}

// ---------------------------------------------------------------------------
// Overlay toggle
// ---------------------------------------------------------------------------

/** @type {boolean} Whether the overlay is currently active. */
let overlayActive = false;

/**
 * Toggle the visual overlay that highlights forms and JSON-LD on the page.
 */
function toggleOverlay() {
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

  const allForms = document.querySelectorAll('form');
  for (const form of allForms) {
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
  }

  // Highlight JSON-LD script tags' parent elements
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldScripts) {
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
  }
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
    toggleOverlay();
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
