# Changelog

## 0.2.0

Compliance pass against the Chrome Manifest V3 guidance and a re-check of the
rubric against the WebMCP draft as of July 2026. The spec moved underneath this
extension since 0.1.7 and several signals were scoring things that no longer
exist — or never did.

### Security

- **Fixed an XSS hole in the side panel.** `escapeHtml()` used the
  `div.textContent = str; return div.innerHTML` trick, which escapes `&`, `<`
  and `>` but leaves quotes intact. Two call sites interpolate into attribute
  values (`title="${escapeHtml(...)}"`), so a page serving a tool description
  like `x" onmouseover="…` could break out of the attribute and run script
  **inside the extension's privileged side panel**, which has `chrome.*` access.
  All values rendered there originate from the scanned page. Now escapes
  `& < > " '` explicitly.

### Spec drift (WebMCP draft, July 2026)

- **`document.modelContext` is now detected.** `navigator.modelContext` was
  deprecated in Chromium 150; the extension only ever looked at the deprecated
  location, so a site correctly using the current API scored zero on WebMCP
  Core. `inject.js` now watches both surfaces and reports which one is in use.
- **`getTools()` is now used when available.** 0.1.7's changelog claimed the API
  "has no way to enumerate previously-registered tools" — that stopped being
  true. When the browser exposes `getTools()` its result is authoritative and
  takes precedence over the shadow registry, which means tools registered
  before injection are no longer invisible.
- **`toolchange` is now the update signal.** `unregisterTool()` was removed from
  the draft in April 2026 in favour of `AbortSignal`, so wrapping it no longer
  observes teardown and the shadow registry kept reporting tools that had
  already been aborted. Subscribing to `toolchange` fixes the stale counts and
  replaces most of the 2-second polling loop.
- **Removed scoring for annotation attributes that do not exist.** WebMCP Core
  awarded 5 points for `toolannotation`, `toolreadonly`, `tooldestructive`,
  `toolidempotent` and `toolopenworldhint`. None of these appear in any draft —
  the declarative API defines exactly four attributes. The points were
  unreachable, so every site was silently capped at 95. Annotations are now
  scored where they actually live: `annotations: { readOnlyHint }` on imperative
  tool definitions.
- **New signal: agent submit handling** (3 pts, Declarative Forms). Detects
  `SubmitEvent.agentInvoked` / `respondWith()`, the `toolactivated` /
  `toolcanceled` lifecycle events, and `:tool-form-active` /
  `:tool-submit-active` styling.
- **Corrected the imperative code example.** It was wrong three ways: it used
  `navigator.modelContext` (deprecated), called `addTool()` (never existed in
  any version — it is `registerTool`), and used a `handler` property (the spec
  calls it `execute`). Now shows feature detection, `execute`, `annotations`,
  and `AbortSignal` teardown.
- **HTTPS reframed as a hard prerequisite.** WebMCP is gated on a secure
  context, so an HTTP page cannot register tools at all. Now checks
  `window.isSecureContext` and says so plainly instead of treating it as 3 soft
  points.
- `.well-known/webmcp` is still scored but now labelled honestly as a community
  discovery convention rather than being linked to a spec section that does not
  describe it.

### Scoring

- **Fixed a category overflow.** WebMCP Core summed to 35 points against a
  declared max of 30, so a fully-featured page could total 105/100. Rebalanced
  to 12 / 8 / 5 / 5 = 30. Declarative Forms rebalanced to 7 / 6 / 4 / 3 / 2 / 3
  = 25 to make room for the new signal. Verified: max reachable total is exactly
  100, no category can overflow.
- Partial credit (3/5) is now awarded for the deprecated `navigator` surface
  rather than full marks, with the migration named in the signal text.
- Badge text is rounded — the fractional coverage-ratio points could render a
  4-character badge like `63.4`.

### Manifest V3 compliance

- **Dropped three permissions.** `webNavigation` and `storage` were declared but
  never used anywhere in the codebase. `activeTab` does not grant anything when
  the trigger is a side-panel button rather than a direct user gesture on the
  action icon — the `scripting` permission plus `host_permissions` is what was
  actually authorising injection all along. Unused permissions are a common
  Chrome Web Store rejection reason.
- **Overlay no longer blocks the main thread.** `toggleOverlay()` styled every
  form in one synchronous pass, calling `getComputedStyle` per form. Now batched
  20 at a time behind `requestAnimationFrame` with `scheduler.yield()` between
  batches.
- Converted the remaining callback-style `chrome.runtime.sendMessage` calls in
  `content.js` to `async`/`await`.
- Discovery fetches now have an 8s timeout and a 512 KB cap. They hit arbitrary
  third-party origins, so an unresponsive host previously hung the scan and a
  large `robots.txt` was read into the service worker in full.
- Added `CHROMEWEBSTORE.md` with per-permission justifications, privacy
  disclosure, and a pre-submission checklist.

### Tooling

- Added CI (`.github/workflows/ci.yml`): syntax check, a 27-case test suite,
  ESLint, and a packaged `.zip` artifact on every PR. The tests are
  dependency-free and run on Node's built-in runner.
- The suite encodes the bugs fixed in this release so they cannot come back:
  attribute-breakout payloads against `escapeHtml`, per-category score ceilings,
  and permissions declared but never used. Each guard was mutation-tested —
  reintroducing the original bug makes it fail.
- Downloading the CI artifact is now the quickest way to try a branch, since
  Chrome 150 removed `--load-extension` and unpacked builds can only be loaded
  by hand.

### Other fixes

- **Warnings no longer render as failures.** `content.js` emits `'warning'` but
  the side panel only recognised `'warn'` / `'partial'`, so every warning showed
  a red ✗. The markdown export handled it correctly, so the two outputs
  disagreed.
- **Re-scans no longer stack listeners.** Each scan added another
  `webmcp-checker-main-results` listener, so after N re-scans one tool
  registration triggered N full re-scans.
- Report footer reads the version from the manifest instead of the hardcoded
  `v0.1.4` it had carried for three releases.
- `robots.txt` AI-crawler detection now covers `claudebot` (Anthropic's current
  crawler — only the retired `claude-web` and `anthropic-ai` names were
  checked), plus `oai-searchbot`, `perplexitybot` and `ccbot`. A site blocking
  ClaudeBot previously still passed the check.
- Removed two dead assignments surfaced by the new lint step: an unused
  `activeTabId` in the side panel, and a redundant `toLowerCase()` in the
  robots.txt parser whose result was never read.

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
