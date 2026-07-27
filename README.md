# WebMCP Readiness Checker

Chrome extension that audits any webpage for [WebMCP](https://webmachinelearning.github.io/webmcp/) (Web Model Context Protocol) and AI agent-readiness. Scores pages 0-100 across 6 categories and provides actionable recommendations with code examples.

WebMCP is a W3C Draft Community Group Report (not standards-track) that lets websites expose structured, callable tools to AI agents through `document.modelContext`. This extension helps developers and consultants assess how ready a site is for the agentic web.

### Spec status (checked July 2026)

The draft is moving, and the rubric tracks it:

- `document.modelContext` is the current API location. `navigator.modelContext` is **deprecated as of Chromium 150** but still ships during the origin trial, so feature-detect both: `document.modelContext ?? navigator.modelContext`.
- `unregisterTool()`, `provideContext()` and `clearContext()` have been **removed** from the draft. Unregister by passing an `AbortSignal` at registration and aborting it.
- `getTools()` and the `toolchange` event let you enumerate and observe the live tool set.
- Chrome runs an origin trial from **Chrome 149 through 156**; Chrome 146 was the flag-gated early preview. Edge 147 has experimental support behind a flag. Firefox and Safari participate in spec discussions but have not committed to implementing.
- The declarative API defines exactly four attributes: `toolname`, `tooldescription`, `toolautosubmit`, `toolparamdescription`. There are no declarative annotation attributes — annotations are an imperative-API concept.

## What it checks

| Category | Weight | What it detects |
|----------|--------|-----------------|
| **WebMCP Core** | 30% | `document.modelContext` (full credit) vs deprecated `navigator.modelContext` (partial), registered imperative tools via `getTools()` / `registerTool` interception, tool descriptions, `annotations.readOnlyHint` |
| **Declarative Forms** | 25% | `toolname`, `tooldescription`, `toolparamdescription`, `toolautosubmit` attributes, form coverage ratio, and agent submit handling (`agentInvoked` / `respondWith`, `toolactivated` / `toolcanceled`, `:tool-form-active`) |
| **Structured Data** | 20% | JSON-LD blocks, `potentialAction` (SearchAction, BuyAction), Product/Offer schema, Organization/WebSite schema |
| **Discovery & Crawling** | 15% | `/.well-known/webmcp` manifest, `/llms.txt`, `robots.txt` AI crawler rules, sitemaps |
| **Technical Foundation** | 10% | Secure context (WebMCP requires HTTPS — without it no tool can register at all), semantic HTML, server-side rendering, stable form IDs |
| **Security & Consent** | Flags | Sensitive forms with autosubmit, missing consent patterns |

## Features

- **Score gauge** — 0-100 score with color-coded readiness label (Good / Partial / Not Agent-Ready)
- **Category breakdown** — Collapsible sections with per-signal pass/warn/fail status
- **Fix cards** — Click any failing signal to see a code snippet with copy-to-clipboard
- **Page overlay** — Toggle to highlight forms on the page (green = has toolname, red = missing)
- **Discovered tools inventory** — Lists all WebMCP tools found (declarative forms + JS API), with schema details and quality warnings
- **Export JSON** — Full scan data as structured JSON
- **Export Report** — Downloadable markdown report with scores, signals, recommendations, code examples, and links to relevant specs

## Installation

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder
5. Click the extension icon to open the side panel

## Usage

The extension scans automatically when the side panel opens. Use the buttons at the bottom:

- **Show on Page** — Toggle the visual overlay on the current page
- **Export JSON** — Download raw scan data
- **Export Report** — Download a markdown audit report with recommendations and doc links
- **Re-scan** — Run a fresh scan

## Markdown report

The exported `.md` report includes:

- Header with URL, date, score, and readiness label
- Score breakdown table across all 6 categories
- Detected signals per category with pass/fail status and links to relevant documentation
- Forms analysis table (toolname status, suggested names, input counts)
- Discovered tools with source, description, and quality indicators
- Discovery files status (webmcp manifest, llms.txt, robots.txt)
- Prioritized recommendations in 3 tiers: **Do Now**, **Do When Ready**, **Future**
- Code examples adapted to the scanned domain (with a note that paths are illustrative)
- Documentation & Resources section with all referenced spec links

Every signal, recommendation, and code example links to the relevant specification:

- [WebMCP W3C Spec](https://webmachinelearning.github.io/webmcp/) (with section deep links)
- [Chrome Developers — WebMCP Early Preview](https://developer.chrome.com/blog/webmcp-epp)
- [Schema.org](https://schema.org/) (SearchAction, potentialAction, Organization, WebSite)
- [llms.txt](https://llmstxt.org/)
- [MDN Web Docs](https://developer.mozilla.org/) (Semantics, ARIA)
- [Google Search Central](https://developers.google.com/search/docs/) (robots.txt, meta descriptions)

## Architecture

```
extension/
  manifest.json          Manifest V3 config
  background.js          Service worker — side panel, discovery fetching, script injection
  content.js             Content script (ISOLATED world) — DOM scanning, scoring, overlays
  inject.js              MAIN world script — document/navigator.modelContext detection
  sidepanel.html         Side panel markup
  sidepanel.css          Styles (dark-mode-friendly, compact)
  sidepanel.js           Side panel logic — rendering, actions, fix snippets
  markdown-report.js     Pure function: scanData -> markdown report
  icons/                 Extension icons (16/48/128px)
```

**Communication flow:**
Side Panel -> `chrome.runtime.sendMessage` -> Background -> `chrome.tabs.sendMessage` -> Content Script -> scans DOM -> sends results back

`inject.js` is declared as a MAIN-world content script at `document_start` so it can intercept `registerTool` before any page script calls it. `chrome.scripting.executeScript({ world: 'MAIN' })` remains as a fallback for tabs that were already open when the extension was installed. The model context object is not reachable from the isolated content script world, hence the split.

### Permissions

| Permission | Why |
|------------|-----|
| `sidePanel` | The entire UI is a side panel |
| `scripting` | Injects the scanner into the tab being audited |
| `host_permissions: <all_urls>` | The tool audits arbitrary pages the user navigates to, so the set of hosts cannot be known ahead of time. Also used to fetch `robots.txt`, `llms.txt` and `.well-known/webmcp` from the scanned origin |

No `activeTab` — it grants nothing when the trigger is a side-panel button rather than a gesture on the action icon. No `storage` or `webNavigation`: nothing is persisted and scans are user-triggered.

## Limitations

- **WebMCP is a draft spec, not standards-track.** Attribute names, API surfaces, and security models are still moving — `navigator.modelContext` → `document.modelContext` and the removal of `unregisterTool()` both landed in 2026. Scores reflect the draft as of July 2026.
- **Only inline scripts are readable.** Tools registered from an external JS bundle are detected at runtime via the MAIN-world interception, but static keyword fallbacks (and the `agentInvoked` / `respondWith` signal) only see inline `<script>` content. A negative result there means "not detected", not "not implemented".
- **Imperative API detection** requires the MAIN world injection to work. Some pages with strict CSP may block this.
- **Cross-origin stylesheets** cannot be read, so `:tool-form-active` styling defined in a third-party stylesheet will not be detected.
- **Point-in-time analysis** — no historical tracking or monitoring (yet).
- **Single page** — scans the current page only, not the entire site.

## Privacy

Nothing is collected, stored, or transmitted. Page analysis happens entirely in your browser, and the only network requests go to the audited site's own domain for `robots.txt`, `llms.txt` and `.well-known/webmcp`. See [PRIVACY.md](PRIVACY.md) for the full policy.

## License

MIT
