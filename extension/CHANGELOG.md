# Changelog

## 0.1.7

- Fix: pages that register tools via `navigator.modelContext.registerTool` (e.g. the Chrome WebMCP React Flight Search demo) scored 0 on WebMCP Core and reported zero tools. Multiple overlapping root causes, all now fixed:
  1. `inject.js` was looking for a non-existent `getTools()` / `.tools` accessor on `navigator.modelContext`. The real API only exposes `registerTool` / `unregisterTool` and has no way to enumerate previously-registered tools. Rewrote to monkey-patch `registerTool` at injection time and mirror every call into a shadow registry.
  2. `inject.js` was loaded on-demand at scan time, which is too late — the React bundle had already called `registerTool` by then. Promoted `inject.js` to a declared MAIN-world content script at `document_start` (manifest `"world": "MAIN"`) so the wrap is in place before any page code runs. The old dynamic-injection path remains as a fallback for tabs opened before the extension was installed.
  3. `registerTool` lives on the prototype of the model context object, not the instance, so `ctx.registerTool = wrapped` created an instance shadow that the page's calls bypassed. Rewrote `wrap()` to walk up to 5 levels of the prototype chain and use `Object.defineProperty` so the patch survives on prototype objects.
  4. The real tool definitions contain handler functions and other non-cloneable fields that silently broke structured cloning of `CustomEvent.detail` when snapshots crossed the MAIN → ISOLATED world boundary, resulting in an empty tools array on the content-script side. `snapshot()` now JSON-sanitizes `inputSchema` and `annotations` so only plain cloneable data ever crosses the boundary.
  5. `capture()` now re-dispatches a fresh results event on every registration so React effects that call `registerTool` after the initial snapshot still push updates to the side panel. `content.js` dropped `{ once: true }` on its listener so these reactive updates are honored.
- Communication protocol updated: content.js dispatches `webmcp-checker-main-request` to ask for a fresh snapshot; inject.js responds with `webmcp-checker-main-results`.
- WebMCP Core "script references" signal now prefers runtime observation from the MAIN-world monkey-patch (awards 5pts when `registerTool` was actually called or any tool was observed) and only falls back to the inline-script keyword scan when no runtime signal is available.
- Debug handle: `window.__webmcpChecker = { snapshot, registry, tryWrap }` exposed in the page's MAIN world for diagnostic inspection from devtools.

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
