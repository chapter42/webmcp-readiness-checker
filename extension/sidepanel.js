/**
 * @file sidepanel.js
 * Renders WebMCP readiness scan results in the Chrome extension side panel.
 * Vanilla JS, no frameworks. Listens for SCAN_RESULTS messages from the
 * background service worker and incrementally builds the UI.
 */
'use strict';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $emptyState = document.getElementById('empty-state');
const $results = document.getElementById('results');
const $timestamp = document.getElementById('scan-timestamp');
const $scoreSection = document.getElementById('score-section');
const $categories = document.getElementById('categories');
const $toolsList = document.getElementById('tools-list');
const $btnOverlay = document.getElementById('btn-overlay');
const $btnExport = document.getElementById('btn-export');
const $btnExportMd = document.getElementById('btn-export-md');
const $btnRescan = document.getElementById('btn-rescan');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {object|null} Most recent full scan result payload */
let scanData = null;

/** @type {number|null} The tab ID we are displaying results for */
let activeTabId = null;

/** @type {boolean} Whether the page overlay is currently toggled on */
let overlayActive = false;

// ---------------------------------------------------------------------------
// Constants — fix card snippets
// ---------------------------------------------------------------------------

/** @type {Record<string, {desc: string, code: string}>} */
const FIX_SNIPPETS = {
  toolname: {
    desc: 'Add a toolname attribute to identify the form as an agent-callable tool.',
    code: `<form toolname="search-products"
      tooldescription="Search the product catalog"
      action="/api/search" method="GET">
  <input name="query" type="text" />
  <button type="submit">Search</button>
</form>`,
  },
  tooldescription: {
    desc: 'Add a tooldescription attribute so agents understand what the tool does.',
    code: `<form toolname="search-products"
      tooldescription="Search the product catalog by keyword">
  ...
</form>`,
  },
  jsonld: {
    desc: 'Add a JSON-LD WebSite schema with a SearchAction so agents can discover search.',
    code: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Example",
  "url": "https://example.com",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://example.com/search?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
</script>`,
  },
  llms_txt: {
    desc: 'Create an /llms.txt file at your site root describing your site for LLMs.',
    code: `# Example Site

> Brief description of what your site offers.

## Docs
- [API Reference](https://example.com/docs/api)
- [Getting Started](https://example.com/docs/start)

## Tools
- [Search](https://example.com/search): Search products
- [Cart](https://example.com/cart): Manage shopping cart`,
  },
  webmcp_manifest: {
    desc: 'Create a /.well-known/webmcp manifest describing available tools.',
    code: `{
  "schema_version": "0.1",
  "name_for_model": "example_site",
  "name_for_human": "Example Site",
  "description": "Tools for interacting with Example Site",
  "tools": [
    {
      "name": "search",
      "description": "Search the site catalog",
      "uri": "/api/search",
      "method": "GET",
      "inputSchema": {
        "type": "object",
        "properties": {
          "q": { "type": "string", "description": "Search query" }
        },
        "required": ["q"]
      }
    }
  ]
}`,
  },
  robots_txt: {
    desc: 'Add or update /robots.txt to explicitly allow AI agent access.',
    code: `User-agent: *
Allow: /

# AI / LLM agents
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /`,
  },
  model_context_api: {
    desc: 'Register tools via the navigator.modelContext imperative API.',
    code: `if (navigator.modelContext) {
  navigator.modelContext.addTool({
    name: "search",
    description: "Search products",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"]
    },
    async handler({ query }) {
      const res = await fetch(\`/api/search?q=\${query}\`);
      return res.json();
    }
  });
}`,
  },
  semantic_html: {
    desc: 'Use semantic HTML elements so agents can understand page structure.',
    code: `<header>
  <nav aria-label="Main navigation">...</nav>
</header>
<main>
  <article>
    <h1>Page Title</h1>
    <section aria-label="Product details">...</section>
  </article>
</main>
<footer>...</footer>`,
  },
  aria_labels: {
    desc: 'Add ARIA labels to interactive elements for better agent understanding.',
    code: `<button aria-label="Add to cart">
  <svg>...</svg>
</button>

<input
  type="search"
  aria-label="Search products"
  placeholder="Search..." />`,
  },
  meta_description: {
    desc: 'Add a meta description so agents understand the page purpose.',
    code: `<meta name="description"
  content="Browse and search our catalog of 10,000+ products." />`,
  },
};

// ---------------------------------------------------------------------------
// Score gauge rendering
// ---------------------------------------------------------------------------

/**
 * Determine color for a given score.
 * @param {number} score 0-100
 * @returns {string} Hex color
 */
function scoreColor(score) {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

/**
 * Get the readiness label for a score.
 * @param {number} score 0-100
 * @returns {{text: string, cls: string}}
 */
function scoreLabel(score) {
  if (score >= 70) return { text: 'Good Readiness', cls: 'score-label--green' };
  if (score >= 40) return { text: 'Partial Readiness', cls: 'score-label--yellow' };
  return { text: 'Not Agent-Ready', cls: 'score-label--red' };
}

/**
 * Render the circular SVG score gauge into the score section.
 * @param {number} score 0-100
 */
function renderGauge(score) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = scoreColor(score);
  const label = scoreLabel(score);

  $scoreSection.innerHTML = `
    <div class="gauge">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle class="gauge__track" cx="50" cy="50" r="${r}" />
        <circle class="gauge__fill" cx="50" cy="50" r="${r}"
          stroke="${color}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}" />
      </svg>
      <span class="gauge__value" style="color:${color}">${score}</span>
    </div>
    <span class="score-label ${label.cls}">${label.text}</span>`;
}

// ---------------------------------------------------------------------------
// Category breakdown rendering
// ---------------------------------------------------------------------------

/**
 * Map a signal key to a fix snippet key. Returns null if no snippet exists.
 * @param {string} signalKey
 * @returns {string|null}
 */
function fixSnippetKey(signalKey) {
  const key = signalKey.toLowerCase().replace(/[\s-]/g, '_');
  // Direct match
  if (FIX_SNIPPETS[key]) return key;
  // Partial matches
  if (key.includes('toolname')) return 'toolname';
  if (key.includes('tooldescription')) return 'tooldescription';
  if (key.includes('json_ld') || key.includes('jsonld') || key.includes('structured_data')) return 'jsonld';
  if (key.includes('llms')) return 'llms_txt';
  if (key.includes('webmcp') || key.includes('manifest')) return 'webmcp_manifest';
  if (key.includes('robots')) return 'robots_txt';
  if (key.includes('model_context') || key.includes('imperative')) return 'model_context_api';
  if (key.includes('semantic') || key.includes('landmark')) return 'semantic_html';
  if (key.includes('aria')) return 'aria_labels';
  if (key.includes('meta_desc') || key.includes('description')) return 'meta_description';
  return null;
}

/**
 * Get a status icon string for a signal.
 * @param {boolean|string} status
 * @returns {{icon: string, cls: string}}
 */
function statusIcon(status) {
  if (status === true || status === 'pass') return { icon: '\u2713', cls: 'signal__icon--pass' };
  if (status === 'warn' || status === 'partial') return { icon: '\u25CB', cls: 'signal__icon--warn' };
  return { icon: '\u2717', cls: 'signal__icon--fail' };
}

/**
 * Format a signal value for display.
 * @param {*} value
 * @returns {string}
 */
function formatValue(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 30 ? value.slice(0, 27) + '...' : value;
  return JSON.stringify(value).slice(0, 30);
}

/**
 * Render a single signal row, optionally with a fix card.
 * @param {object} signal
 * @returns {string} HTML string
 */
function renderSignal(signal) {
  const passed = signal.pass === true || signal.status === 'pass' || signal.status === true;
  const warn = signal.status === 'warn' || signal.status === 'partial';
  const { icon, cls } = statusIcon(passed ? true : (warn ? 'warn' : false));
  const snippetKey = !passed ? fixSnippetKey(signal.key || signal.name || '') : null;
  const fixId = snippetKey ? `fix-${Math.random().toString(36).slice(2, 8)}` : null;
  const clickable = snippetKey ? 'signal--clickable' : '';
  const onclick = fixId ? `onclick="toggleFix('${fixId}')"` : '';

  let html = `<div class="signal ${clickable}" ${onclick}>
    <span class="signal__icon ${cls}">${icon}</span>
    <span class="signal__name">${escapeHtml(signal.name || signal.key || '')}</span>
    <span class="signal__value" title="${escapeHtml(String(signal.rawValue ?? signal.value ?? ''))}">${escapeHtml(formatValue(signal.value ?? signal.rawValue))}</span>
  </div>`;

  if (snippetKey && FIX_SNIPPETS[snippetKey]) {
    const fix = FIX_SNIPPETS[snippetKey];
    html += `<div class="fix-card" id="${fixId}">
      <p class="fix-card__desc">${escapeHtml(fix.desc)}</p>
      <div class="fix-card__code-wrap">
        <code class="fix-card__code">${escapeHtml(fix.code)}</code>
        <button class="fix-card__copy" onclick="event.stopPropagation(); copyCode(this)">Copy</button>
      </div>
    </div>`;
  }

  return html;
}

/**
 * Render all category sections.
 * @param {Array<object>} categories
 */
function renderCategories(categories) {
  if (!categories || !categories.length) {
    $categories.innerHTML = '';
    return;
  }

  $categories.innerHTML = categories.map((cat) => {
    const score = cat.score ?? 0;
    const maxScore = cat.maxScore ?? cat.max ?? 100;
    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const color = scoreColor(pct);

    const signalsHtml = (cat.signals || []).map(renderSignal).join('');

    return `<details class="category">
      <summary>
        <span class="category__name">${escapeHtml(cat.name || cat.key || '')}</span>
        <span class="category__bar">
          <span class="category__bar-fill" style="width:${pct}%;background:${color}"></span>
        </span>
        <span class="category__score">${score}/${maxScore}</span>
      </summary>
      <div class="category__body">${signalsHtml || '<p style="color:var(--text-dim);font-size:11px">No signals</p>'}</div>
    </details>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Tools inventory rendering
// ---------------------------------------------------------------------------

/**
 * Render the list of discovered tools.
 * @param {Array<object>} tools
 */
function renderTools(tools) {
  if (!tools || !tools.length) {
    $toolsList.innerHTML = '<p class="tools-empty">No tools discovered on this page.</p>';
    return;
  }

  $toolsList.innerHTML = tools.map((tool) => {
    const isForm = tool.source === 'form' || tool.source === 'declarative';
    const badgeCls = isForm ? 'tool-badge--form' : 'tool-badge--api';
    const badgeText = isForm ? 'Form' : 'JS API';

    const warnings = [];
    if (!tool.description) warnings.push('Missing description');
    if (tool.inputSchema) {
      const props = tool.inputSchema.properties || {};
      for (const [key, val] of Object.entries(props)) {
        if (!val.type) warnings.push(`Param "${key}" untyped`);
      }
    }

    const warnIcon = warnings.length
      ? `<span class="tool-warn" title="${escapeHtml(warnings.join(', '))}">&#9888;</span>`
      : '';

    const schemaStr = tool.inputSchema
      ? JSON.stringify(tool.inputSchema, null, 2)
      : 'No input schema defined';

    const descHtml = tool.description
      ? `<p class="tool-desc">${escapeHtml(tool.description)}</p>`
      : '<p class="tool-desc" style="color:var(--yellow)">No description provided</p>';

    return `<details class="tool-item">
      <summary>
        <span class="tool-name">${escapeHtml(tool.name || '(unnamed)')}</span>
        ${warnIcon}
        <span class="tool-badge ${badgeCls}">${badgeText}</span>
      </summary>
      <div class="tool-body">
        ${descHtml}
        <pre class="tool-schema">${escapeHtml(schemaStr)}</pre>
      </div>
    </details>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

/**
 * Render all sections from the current scanData.
 */
function renderAll() {
  if (!scanData) return;

  $emptyState.hidden = true;
  $results.hidden = false;

  // Timestamp
  const ts = scanData.timestamp ? new Date(scanData.timestamp) : new Date();
  $timestamp.textContent = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Score gauge — handle both {total,max} object and plain number
  const totalScore = typeof scanData.score === 'object'
    ? (scanData.score.total ?? 0)
    : (scanData.score ?? 0);
  renderGauge(totalScore);

  // Categories — convert from object to array if needed
  let cats = scanData.categories || [];
  if (!Array.isArray(cats)) {
    const LABELS = {
      webmcpCore: 'WebMCP Core',
      declarativeForms: 'Declarative Forms',
      structuredData: 'Structured Data',
      discovery: 'Discovery & Crawling',
      technicalFoundation: 'Technical Foundation',
      security: 'Security & Consent',
    };
    cats = Object.entries(cats).map(([key, val]) => ({
      key,
      name: LABELS[key] || key,
      score: val.score ?? 0,
      max: val.max ?? (key === 'security' ? 0 : 10),
      signals: val.signals || val.warnings || [],
    }));
  }
  renderCategories(cats);

  // Tools
  const tools = [
    ...(scanData.tools || []),
    ...(scanData.declarativeTools || []),
    ...(scanData.imperativeTools || []),
  ];
  // Deduplicate by name
  const seen = new Set();
  const unique = tools.filter((t) => {
    const k = t.name || '';
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  renderTools(unique);
}


// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

/**
 * Get the active tab ID.
 * @returns {Promise<number|null>}
 */
async function getActiveTabId() {
  if (activeTabId) return activeTabId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      activeTabId = tab.id;
      return tab.id;
    }
  } catch {
    // Fallback
  }
  return null;
}

// Show on Page — toggle overlay
$btnOverlay.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;

  overlayActive = !overlayActive;
  $btnOverlay.classList.toggle('btn--active', overlayActive);
  $btnOverlay.textContent = overlayActive ? 'Hide Overlay' : 'Show on Page';

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_OVERLAY' });
  } catch (err) {
    console.error('[webMCP] Failed to toggle overlay:', err);
  }
});

// Export JSON
$btnExport.addEventListener('click', () => {
  if (!scanData) return;

  const domain = scanData.url
    ? new URL(scanData.url).hostname.replace(/^www\./, '')
    : 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  const filename = `webmcp-audit-${domain}-${date}.json`;
  const blob = new Blob([JSON.stringify(scanData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

// Export Markdown Report
$btnExportMd.addEventListener('click', () => {
  if (!scanData) return;

  const domain = scanData.url
    ? new URL(scanData.url).hostname.replace(/^www\./, '')
    : 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  const filename = `webmcp-audit-${domain}-${date}.md`;
  const markdown = generateMarkdownReport(scanData, FIX_SNIPPETS);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

// Re-scan
$btnRescan.addEventListener('click', () => doScan());

// ---------------------------------------------------------------------------
// Global helpers (called from inline onclick in rendered HTML)
// ---------------------------------------------------------------------------

/**
 * Toggle a fix card open/closed.
 * @param {string} id DOM id of the fix card
 */
window.toggleFix = function toggleFix(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('is-open');
};

/**
 * Copy the sibling code block text to clipboard and show feedback.
 * @param {HTMLButtonElement} btn The copy button element
 */
window.copyCode = async function copyCode(btn) {
  const codeEl = btn.parentElement?.querySelector('.fix-card__code');
  if (!codeEl) return;

  try {
    await navigator.clipboard.writeText(codeEl.textContent || '');
    btn.textContent = 'Copied!';
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('is-copied');
    }, 1500);
  } catch {
    // Clipboard API may fail in some contexts; fall back to execCommand
    const range = document.createRange();
    range.selectNodeContents(codeEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('copy');
    sel?.removeAllRanges();
    btn.textContent = 'Copied!';
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('is-copied');
    }, 1500);
  }
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Scan helper — used by both init and Re-scan button
// ---------------------------------------------------------------------------

const EMPTY_STATE_HTML = '<div class="spinner"></div><p>Scanning...</p>';

async function doScan() {
  const tabId = await getActiveTabId();
  if (!tabId) return;

  // Reset UI
  scanData = null;
  $emptyState.innerHTML = EMPTY_STATE_HTML;
  $emptyState.hidden = false;
  $results.hidden = true;
  $timestamp.textContent = '';
  overlayActive = false;
  $btnOverlay.classList.remove('btn--active');
  $btnOverlay.textContent = 'Show on Page';

  try {
    // Ensure the content script is injected (handles tabs open before extension load)
    await chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT', tabId });

    const response = await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_SCAN' });
    if (response?.data) {
      scanData = response.data;
      renderAll();
    }
  } catch (err) {
    $emptyState.innerHTML = '<p style="color:var(--red)">Scan failed. Refresh the page and try again.</p>';
    console.error('[webMCP] Scan failed:', err);
  }
}

// Scan on panel open
doScan();

// Also accept async updates (discovery/main world data arriving later)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SCAN_RESULTS' && message.data) {
    scanData = message.data;
    renderAll();
  }
});
