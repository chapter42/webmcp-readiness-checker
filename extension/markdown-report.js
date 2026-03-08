/**
 * @file markdown-report.js
 * Pure function that converts scanData into a downloadable markdown report.
 * No dependencies — loaded as a <script> tag before sidepanel.js.
 */
'use strict';

// ---------------------------------------------------------------------------
// Documentation links — single source of truth, easy to update when specs move
// ---------------------------------------------------------------------------

// WebMCP spec base URL — W3C Draft Community Group Report
const WEBMCP_SPEC = 'https://webmachinelearning.github.io/webmcp/';
const WEBMCP_REPO = 'https://github.com/webmachinelearning/webmcp';
const WEBMCP_BLOG = 'https://developer.chrome.com/blog/webmcp-epp';

/**
 * @type {Record<string, {label: string, url: string}>}
 * Keyed by signal/snippet key (lowercase, underscored). Matched against signal
 * names via keyword lookup — same pattern as fixSnippetKey().
 *
 * All URLs verified as of March 2026. If a URL goes stale, update here.
 */
const DOC_LINKS = {
  toolname: {
    label: 'WebMCP Spec — Declarative API',
    url: `${WEBMCP_SPEC}#declarative-api`,
  },
  tooldescription: {
    label: 'WebMCP Spec — Declarative API',
    url: `${WEBMCP_SPEC}#declarative-api`,
  },
  toolautosubmit: {
    label: 'WebMCP Spec — Declarative API',
    url: `${WEBMCP_SPEC}#declarative-api`,
  },
  toolparamdescription: {
    label: 'WebMCP Spec — Declarative API',
    url: `${WEBMCP_SPEC}#declarative-api`,
  },
  model_context_api: {
    label: 'WebMCP Spec — ModelContext Interface',
    url: `${WEBMCP_SPEC}#model-context-container`,
  },
  jsonld: {
    label: 'Schema.org — Getting Started with Structured Data',
    url: 'https://schema.org/docs/gs.html',
  },
  search_action: {
    label: 'Schema.org — SearchAction',
    url: 'https://schema.org/SearchAction',
  },
  potential_action: {
    label: 'Schema.org — potentialAction',
    url: 'https://schema.org/potentialAction',
  },
  organization: {
    label: 'Schema.org — Organization',
    url: 'https://schema.org/Organization',
  },
  website: {
    label: 'Schema.org — WebSite',
    url: 'https://schema.org/WebSite',
  },
  llms_txt: {
    label: 'llms.txt Specification',
    url: 'https://llmstxt.org/',
  },
  webmcp_manifest: {
    label: 'WebMCP Spec — Supporting Concepts',
    url: `${WEBMCP_SPEC}#supporting-concepts`,
  },
  robots_txt: {
    label: 'Google — Introduction to robots.txt',
    url: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  },
  semantic_html: {
    label: 'MDN — Semantics in HTML',
    url: 'https://developer.mozilla.org/en-US/docs/Glossary/Semantics#semantics_in_html',
  },
  aria_labels: {
    label: 'MDN — aria-label',
    url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-label',
  },
  meta_description: {
    label: 'Google — Meta Description Best Practices',
    url: 'https://developers.google.com/search/docs/appearance/snippet#meta-descriptions',
  },
  https: {
    label: 'Google — Secure Your Site with HTTPS',
    url: 'https://web.dev/enable-https/',
  },
  stable_ids: {
    label: 'WebMCP Spec — Declarative API',
    url: `${WEBMCP_SPEC}#declarative-api`,
  },
};

/**
 * Generate a full markdown audit report from scan data.
 * @param {object} scanData - The scan result object from content.js
 * @param {Record<string, {desc: string, code: string}>} fixSnippets - Code examples keyed by signal
 * @returns {string} Markdown string
 */
// eslint-disable-next-line no-unused-vars
function generateMarkdownReport(scanData, fixSnippets) {
  if (!scanData) return '# No scan data available';

  const url = scanData.url || '(unknown)';
  const domain = scanData.domain || '(unknown)';
  const date = scanData.timestamp
    ? new Date(scanData.timestamp).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const totalScore = typeof scanData.score === 'object'
    ? (scanData.score.total ?? 0)
    : (scanData.score ?? 0);
  const maxScore = typeof scanData.score === 'object'
    ? (scanData.score.max ?? 100)
    : 100;

  const readiness = totalScore >= 70
    ? 'Good Readiness'
    : totalScore >= 40
      ? 'Partial Readiness'
      : 'Not Agent-Ready';

  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────
  lines.push(`# WebMCP Agent-Readiness Report`);
  lines.push(`**URL:** ${url}`);
  lines.push(`**Scanned:** ${date}`);
  lines.push(`**Overall Score:** ${totalScore}/${maxScore} (${readiness})`);
  lines.push('');
  lines.push('> Based on WebMCP spec as of March 2026 (W3C Draft Community Group Report).');
  lines.push('');

  // ── Score Breakdown ─────────────────────────────────────────────────
  const LABELS = {
    webmcpCore: 'WebMCP Core',
    declarativeForms: 'Declarative Forms',
    structuredData: 'Structured Data',
    discovery: 'Discovery & Crawling',
    technicalFoundation: 'Technical Foundation',
    security: 'Security & Consent',
  };

  const cats = scanData.categories || {};

  lines.push('## Score Breakdown');
  lines.push('| Category | Score | Status |');
  lines.push('|----------|-------|--------|');

  for (const [key, label] of Object.entries(LABELS)) {
    const cat = cats[key];
    if (!cat) continue;
    const score = cat.score ?? 0;
    const max = cat.max ?? 10;
    const summary = catSummary(key, cat);
    lines.push(`| ${label} | ${score}/${max} | ${summary} |`);
  }
  lines.push('');

  // ── Detected Signals ────────────────────────────────────────────────
  lines.push('## Detected Signals');
  lines.push('');

  for (const [key, label] of Object.entries(LABELS)) {
    const cat = cats[key];
    if (!cat) continue;
    const signals = cat.signals || cat.warnings || [];
    if (signals.length === 0) continue;

    lines.push(`### ${label}`);
    for (const sig of signals) {
      const icon = signalIcon(sig);
      const name = sig.name || sig.key || '';
      const val = sig.value ?? sig.rawValue ?? '';
      const valStr = val !== '' && val !== true && val !== false ? ` — ${val}` : '';
      const doc = docLinkForSignal(name);
      const docStr = doc ? ` ([${doc.label}](${doc.url}))` : '';
      lines.push(`- ${icon} ${name}${valStr}${docStr}`);
    }
    lines.push('');
  }

  // ── Forms Analysis ──────────────────────────────────────────────────
  const forms = scanData.forms || [];
  lines.push('## Forms Analysis');

  if (forms.length === 0) {
    lines.push('No forms found on this page.');
  } else {
    lines.push(`**${forms.length} form(s)** found on page.`);
    lines.push('');
    lines.push('| # | toolname | Status | Action | Method | Inputs |');
    lines.push('|---|----------|--------|--------|--------|--------|');
    forms.forEach((form, i) => {
      const tn = form.toolname
        ? `\`${form.toolname}\``
        : form.suggestedToolname
          ? `_(suggest: ${form.suggestedToolname})_`
          : '_(none)_';
      const status = form.toolname ? 'Configured' : 'Missing toolname';
      const action = form.action || '—';
      const method = form.method || 'GET';
      const inputCount = (form.inputs || []).length;
      lines.push(`| ${i + 1} | ${tn} | ${status} | ${action} | ${method} | ${inputCount} |`);
    });
  }
  lines.push('');

  // ── Discovered Tools ────────────────────────────────────────────────
  const tools = scanData.tools || [];
  lines.push('## Discovered Tools');

  if (tools.length === 0) {
    lines.push('No WebMCP tools discovered on this page.');
  } else {
    lines.push('| Tool | Source | Description | Quality |');
    lines.push('|------|--------|-------------|---------|');
    for (const tool of tools) {
      const src = tool.source === 'form' ? 'Form' : tool.source === 'js' ? 'JS API' : tool.source || '—';
      const desc = tool.description || '_(none)_';
      const quality = Array.isArray(tool.quality) ? tool.quality.join(', ') : 'unknown';
      lines.push(`| \`${tool.name || '(unnamed)'}\` | ${src} | ${desc} | ${quality} |`);
    }
  }
  lines.push('');

  // ── Discovery Files ─────────────────────────────────────────────────
  const disc = cats.discovery;
  if (disc) {
    lines.push('## Discovery Files');
    const discSignals = disc.signals || [];
    for (const sig of discSignals) {
      const icon = signalIcon(sig);
      const name = sig.name || sig.key || '';
      const val = sig.value ?? sig.rawValue ?? '';
      const valStr = val !== '' && val !== true && val !== false ? ` — ${val}` : '';
      lines.push(`- ${icon} \`${name}\`${valStr}`);
    }
    lines.push('');
  }

  // ── Recommendations ─────────────────────────────────────────────────
  const recs = scanData.recommendations || [];
  if (recs.length > 0) {
    lines.push('## Priority Recommendations');
    lines.push('');

    const doNow = [];
    const doWhenReady = [];
    const future = [];

    for (const rec of recs) {
      const lower = rec.toLowerCase();
      if (lower.includes('toolname') || lower.includes('tooldescription')
          || lower.includes('registertool') || lower.includes('manifest')
          || lower.includes('webmcp') || lower.includes('imperative')) {
        doWhenReady.push(rec);
      } else if (lower.includes('analytics') || lower.includes('a/b')
          || lower.includes('requestuserinteraction') || lower.includes('agent-specific')) {
        future.push(rec);
      } else {
        doNow.push(rec);
      }
    }

    if (doNow.length > 0) {
      lines.push('### Do Now (no WebMCP dependency)');
      doNow.forEach((r, i) => lines.push(`${i + 1}. ${r}${recDocLink(r)}`));
      lines.push('');
    }

    if (doWhenReady.length > 0) {
      lines.push('### Do When Ready (WebMCP implementation)');
      doWhenReady.forEach((r, i) => lines.push(`${i + 1}. ${r}${recDocLink(r)}`));
      lines.push('');
    }

    if (future.length > 0) {
      lines.push('### Future (when spec stabilizes)');
      future.forEach((r, i) => lines.push(`${i + 1}. ${r}${recDocLink(r)}`));
      lines.push('');
    }
  }

  // ── Code Examples ───────────────────────────────────────────────────
  if (fixSnippets && Object.keys(fixSnippets).length > 0) {
    // Only include snippets relevant to failing signals
    const failingKeys = collectFailingSnippetKeys(scanData, fixSnippets);

    if (failingKeys.length > 0) {
      lines.push('## Code Examples');
      lines.push('> Examples are adapted to your domain. Adjust paths and values to match your actual site structure.');
      lines.push('');

      for (const key of failingKeys) {
        const snippet = fixSnippets[key];
        if (!snippet) continue;
        const doc = DOC_LINKS[key];
        const docRef = doc ? ` — [${doc.label}](${doc.url})` : '';
        lines.push(`### ${key.replace(/_/g, ' ')}`);
        lines.push(snippet.desc + docRef);
        lines.push('```html');
        lines.push(adaptSnippet(snippet.code, url, domain));
        lines.push('```');
        lines.push('');
      }
    }
  }

  // ── Documentation ──────────────────────────────────────────────────
  // Collect all unique doc links that were referenced in the report
  const referencedDocs = collectReferencedDocs(scanData, recs);
  if (referencedDocs.length > 0) {
    lines.push('## Documentation & Resources');
    lines.push('');
    for (const doc of referencedDocs) {
      lines.push(`- [${doc.label}](${doc.url})`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`_Generated by [WebMCP Readiness Checker](${WEBMCP_REPO}) v0.1.4_`);

  return lines.join('\n');
}


// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Return a status icon for a signal.
 * @param {object} sig
 * @returns {string}
 */
function signalIcon(sig) {
  const passed = sig.pass === true || sig.status === 'pass' || sig.status === true;
  const warn = sig.status === 'warn' || sig.status === 'warning' || sig.status === 'partial';
  if (passed) return 'PASS:';
  if (warn) return 'WARN:';
  return 'FAIL:';
}

/**
 * Build a short summary string for a category row.
 * @param {string} key
 * @param {object} cat
 * @returns {string}
 */
function catSummary(key, cat) {
  const signals = cat.signals || cat.warnings || [];
  const passing = signals.filter(
    (s) => s.pass === true || s.status === 'pass' || s.status === true
  ).length;
  const failing = signals.filter(
    (s) => s.status === 'fail' || s.pass === false
  ).length;

  if (key === 'security') {
    return failing === 0 ? 'OK' : `${failing} issue(s)`;
  }

  if (cat.score === 0 && failing > 0) {
    return `${failing} failing signal(s)`;
  }

  const parts = [];
  if (passing > 0) parts.push(`${passing} passing`);
  if (failing > 0) parts.push(`${failing} failing`);
  return parts.join(', ') || '—';
}

/**
 * Collect fix snippet keys that are relevant (signal is failing).
 * @param {object} scanData
 * @param {Record<string, object>} fixSnippets
 * @returns {string[]}
 */
function collectFailingSnippetKeys(scanData, fixSnippets) {
  const matched = new Set();
  const cats = scanData.categories || {};

  for (const cat of Object.values(cats)) {
    const signals = cat.signals || cat.warnings || [];
    for (const sig of signals) {
      const passed = sig.pass === true || sig.status === 'pass' || sig.status === true;
      if (passed) continue;

      const sigKey = (sig.name || sig.key || '').toLowerCase().replace(/[\s-]/g, '_');
      // Try direct and partial matches (same logic as fixSnippetKey in sidepanel.js)
      for (const fk of Object.keys(fixSnippets)) {
        if (sigKey.includes(fk) || fk.includes(sigKey)) {
          matched.add(fk);
        }
      }
      // Keyword-based matching
      if (sigKey.includes('toolname')) matched.add('toolname');
      if (sigKey.includes('tooldescription')) matched.add('tooldescription');
      if (sigKey.includes('json_ld') || sigKey.includes('jsonld') || sigKey.includes('structured_data')) matched.add('jsonld');
      if (sigKey.includes('llms')) matched.add('llms_txt');
      if (sigKey.includes('webmcp') || sigKey.includes('manifest')) matched.add('webmcp_manifest');
      if (sigKey.includes('robots')) matched.add('robots_txt');
      if (sigKey.includes('model_context') || sigKey.includes('imperative')) matched.add('model_context_api');
      if (sigKey.includes('semantic') || sigKey.includes('landmark')) matched.add('semantic_html');
      if (sigKey.includes('aria')) matched.add('aria_labels');
      if (sigKey.includes('meta_desc') || sigKey.includes('description')) matched.add('meta_description');
    }
  }

  // Only return keys that exist in fixSnippets
  return [...matched].filter((k) => fixSnippets[k]);
}

/**
 * Find the best matching doc link for a signal name.
 * @param {string} signalName
 * @returns {{label: string, url: string}|null}
 */
function docLinkForSignal(signalName) {
  const key = signalName.toLowerCase().replace(/[\s-]/g, '_');

  // Direct match
  if (DOC_LINKS[key]) return DOC_LINKS[key];

  // Keyword matching
  if (key.includes('toolname')) return DOC_LINKS.toolname;
  if (key.includes('tooldescription')) return DOC_LINKS.tooldescription;
  if (key.includes('toolautosubmit')) return DOC_LINKS.toolautosubmit;
  if (key.includes('toolparam')) return DOC_LINKS.toolparamdescription;
  if (key.includes('json_ld') || key.includes('jsonld') || key.includes('structured_data')) return DOC_LINKS.jsonld;
  if (key.includes('potentialaction') || key.includes('searchaction')) return DOC_LINKS.potential_action;
  if (key.includes('organization')) return DOC_LINKS.organization;
  if (key.includes('website') && !key.includes('webmcp')) return DOC_LINKS.website;
  if (key.includes('llms')) return DOC_LINKS.llms_txt;
  if (key.includes('webmcp') || key.includes('manifest')) return DOC_LINKS.webmcp_manifest;
  if (key.includes('robots')) return DOC_LINKS.robots_txt;
  if (key.includes('model_context') || key.includes('imperative') || key.includes('registertool')) return DOC_LINKS.model_context_api;
  if (key.includes('semantic') || key.includes('landmark')) return DOC_LINKS.semantic_html;
  if (key.includes('aria')) return DOC_LINKS.aria_labels;
  if (key.includes('meta_desc') || (key.includes('description') && !key.includes('tool'))) return DOC_LINKS.meta_description;
  if (key.includes('https')) return DOC_LINKS.https;
  if (key.includes('stable') && key.includes('id')) return DOC_LINKS.stable_ids;
  return null;
}

/**
 * Find the best matching doc link for a recommendation string.
 * @param {string} rec
 * @returns {string} Formatted markdown link suffix, or empty string
 */
function recDocLink(rec) {
  const lower = rec.toLowerCase();
  const keywords = [
    ['toolname', 'toolname'],
    ['tooldescription', 'tooldescription'],
    ['toolautosubmit', 'toolautosubmit'],
    ['json-ld', 'jsonld'],
    ['structured data', 'jsonld'],
    ['potentialaction', 'potential_action'],
    ['searchaction', 'search_action'],
    ['organization', 'organization'],
    ['llms.txt', 'llms_txt'],
    ['llms txt', 'llms_txt'],
    ['webmcp', 'webmcp_manifest'],
    ['manifest', 'webmcp_manifest'],
    ['robots', 'robots_txt'],
    ['navigator.modelcontext', 'model_context_api'],
    ['registertool', 'model_context_api'],
    ['imperative', 'model_context_api'],
    ['semantic', 'semantic_html'],
    ['aria', 'aria_labels'],
    ['meta description', 'meta_description'],
    ['https', 'https'],
  ];

  for (const [kw, docKey] of keywords) {
    if (lower.includes(kw) && DOC_LINKS[docKey]) {
      const doc = DOC_LINKS[docKey];
      return ` — [${doc.label}](${doc.url})`;
    }
  }
  return '';
}

/**
 * Collect all unique doc links referenced in the report for a summary section.
 * @param {object} scanData
 * @param {Array<string>} recs
 * @returns {Array<{label: string, url: string}>}
 */
function collectReferencedDocs(scanData, recs) {
  const seen = new Set();
  const docs = [];

  function add(doc) {
    if (!doc || seen.has(doc.url)) return;
    seen.add(doc.url);
    docs.push(doc);
  }

  // From signals
  const cats = scanData.categories || {};
  for (const cat of Object.values(cats)) {
    for (const sig of (cat.signals || cat.warnings || [])) {
      add(docLinkForSignal(sig.name || sig.key || ''));
    }
  }

  // From recommendations
  for (const rec of recs) {
    const lower = rec.toLowerCase();
    for (const [, docObj] of Object.entries(DOC_LINKS)) {
      // Check if any keyword from the label appears in the rec
      const labelWords = docObj.label.toLowerCase().split(/[\s—-]+/);
      if (labelWords.some((w) => w.length > 3 && lower.includes(w))) {
        add(docObj);
      }
    }
  }

  return docs;
}

/**
 * Replace generic example.com placeholders in a code snippet with the actual
 * scanned domain so the output feels tailored. Paths remain illustrative.
 * @param {string} code - Original snippet code
 * @param {string} url  - Full URL of the scanned page
 * @param {string} domain - Hostname (e.g. "bol.com")
 * @returns {string}
 */
function adaptSnippet(code, url, domain) {
  const shortName = domain
    .replace(/^www\./, '')
    .split('.')[0];                           // "bol.com" → "bol"
  const capitalized = shortName.charAt(0).toUpperCase() + shortName.slice(1);
  const origin = url ? new URL(url).origin : `https://${domain}`;

  return code
    .replace(/https:\/\/example\.com/g, origin)
    .replace(/example\.com/g, domain)
    .replace(/"Example Site"/g, `"${capitalized}"`)
    .replace(/"Example"/g, `"${capitalized}"`)
    .replace(/# Example Site/g, `# ${capitalized}`)
    .replace(/"example_site"/g, `"${shortName.replace(/[^a-z0-9]/g, '_')}"`)
    .replace(/"example"/g, `"${shortName}"`);
}
