# Changelog

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
