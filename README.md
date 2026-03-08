# WebMCP Readiness Checker

Chrome extension that audits any webpage for [WebMCP](https://webmachinelearning.github.io/webmcp/) (Web Model Context Protocol) and AI agent-readiness. Scores pages 0-100 across 6 categories and provides actionable recommendations with code examples.

WebMCP is a W3C Draft standard that lets websites expose structured, callable tools to AI agents through `navigator.modelContext`. Chrome 146 shipped an early preview in February 2026. This extension helps developers and consultants assess how ready a site is for the agentic web.

## What it checks

| Category | Weight | What it detects |
|----------|--------|-----------------|
| **WebMCP Core** | 30% | `navigator.modelContext` API, registered imperative tools, schema quality, annotations |
| **Declarative Forms** | 25% | `toolname`, `tooldescription`, `toolparamdescription`, `toolautosubmit` attributes, form coverage ratio |
| **Structured Data** | 20% | JSON-LD blocks, `potentialAction` (SearchAction, BuyAction), Product/Offer schema, Organization/WebSite schema |
| **Discovery & Crawling** | 15% | `/.well-known/webmcp` manifest, `/llms.txt`, `robots.txt` AI crawler rules, sitemaps |
| **Technical Foundation** | 10% | HTTPS, semantic HTML, server-side rendering, stable form IDs |
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
  inject.js              MAIN world script — navigator.modelContext detection
  sidepanel.html         Side panel markup
  sidepanel.css          Styles (dark-mode-friendly, compact)
  sidepanel.js           Side panel logic — rendering, actions, fix snippets
  markdown-report.js     Pure function: scanData -> markdown report
  icons/                 Extension icons (16/48/128px)
```

**Communication flow:**
Side Panel -> `chrome.runtime.sendMessage` -> Background -> `chrome.tabs.sendMessage` -> Content Script -> scans DOM -> sends results back

The MAIN world script (`inject.js`) is injected via `chrome.scripting.executeScript({ world: 'MAIN' })` to access `navigator.modelContext`, which is not available from the isolated content script context.

## Limitations

- **WebMCP is a draft spec.** Attribute names, API surfaces, and security models may change. Scores are based on the spec as of March 2026.
- **Imperative API detection** requires the MAIN world injection to work. Some pages with strict CSP may block this.
- **Point-in-time analysis** — no historical tracking or monitoring (yet).
- **Single page** — scans the current page only, not the entire site.

## License

MIT
