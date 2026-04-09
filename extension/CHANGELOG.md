# Changelog

## 0.1.6

- Fix: side panel now actually stretches when the user widens it. Root cause was `body { width: 320px }` + `<meta viewport content="width=320">` pinning the layout viewport regardless of the real panel width. Changed body to `min-width: 320px; width: 100%` and viewport to `width=device-width`.
- Category summary row rewritten as flex with shrink priority: name (`flex: 1 1 auto`) absorbs all leftover space, progress bar (`flex: 0 3 140px`, `min 40 / max 140`) shrinks 3× faster than the name so long category labels like "Declarative Forms" are never truncated before the bar collapses. Score column pinned right with `flex: 0 0 auto`.

## 0.1.5

- Fix: Re-scan (and Show on Page) now always acts on the currently active tab. `getActiveTabId()` was caching the tab id from the first call, so switching tabs and hitting Re-scan re-scanned the original tab.
- Fix: CSP violation from inline `onclick=` handlers in rendered category signals. MV3's default `script-src 'self'` rejected the inline handlers, breaking the fix-card toggle and Copy button. Replaced with `data-fix-toggle` / `data-copy-code` attributes and a single delegated click listener on `#categories`. Removed the `window.toggleFix` / `window.copyCode` globals.
- Fix: duplicate recommendations when a page renders the same form twice (e.g. Gravity Forms injecting a second `#gform_1` via AJAX). `generateRecommendations()` now dedupes its output while preserving first-occurrence order.
- UI: header now shows the scanned URL underneath the title as a clickable link (`host + path`, full URL in title/href). Makes it obvious which page the report reflects and avoids stale-URL confusion on the Export buttons.
- UI: initial attempt at responsive category bars (refined further in 0.1.6).

## 0.1.4

- New: Export Report button — generates a downloadable markdown audit report from scan results.
- Markdown report includes: score breakdown, detected signals, forms analysis, discovered tools, discovery files, prioritized recommendations (Do Now / Do When Ready / Future), and domain-adapted code examples.
- Every failing signal, recommendation, and code example links to the relevant spec or documentation (WebMCP W3C spec with deep links, Schema.org, MDN, Google Search Central, llms.txt).
- Documentation links are maintained in a single `DOC_LINKS` constant for easy updates.
- Code examples automatically replace `example.com` with the scanned domain.
- Documentation & Resources summary section at the bottom of the report, dynamically built from referenced docs.

## 0.1.3

- Fix: category bars were always empty/grey. Cause: `.category__bar-fill` is a `<span>` (inline element) — `width` and `height` don't work on inline elements. Fixed with `display: block`.

## 0.1.2

- Fix: "Scanning..." spinner stayed visible above results. Cause: CSS `display: flex` on `.empty-state` overrode the HTML `hidden` attribute. Fixed with explicit `.empty-state[hidden] { display: none }`.
- Fix: prevent duplicate content script injection with `window._webmcpCheckerLoaded` guard.

## 0.1.1

- Fix: content script is now programmatically injected via background service worker before a scan starts. Fixes tabs that were already open before extension (re)load showing "Scan failed".
- Fix: empty state HTML (spinner + "Scanning...") is now always reset on each scan, so a previous error message doesn't persist after a successful re-scan.

## 0.1.0

- Initial working version of the WebMCP Readiness Checker extension.
- Side panel with score gauge (0-100), category breakdown, tool inventory.
- 6 scoring categories: WebMCP Core, Declarative Forms, Structured Data, Discovery & Crawling, Technical Foundation, Security.
- Discovery file fetching (robots.txt, llms.txt, .well-known/webmcp).
- MAIN world injection for navigator.modelContext detection.
- Fix cards with copy-to-clipboard code snippets.
- Overlay toggle (green borders on forms with toolname, red dashed on forms without).
- Export JSON functionality.
- Scan on panel open + Re-scan button.
