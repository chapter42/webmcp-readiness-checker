# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

The version in `extension/manifest.json` is the release version; `package.json`
and this file track it. `npm run bump -- <major|minor|patch>` updates all three
together — the report footer once shipped a hardcoded `v0.1.4` for three
releases because they were maintained by hand.

For an extension with no public API, semver is interpreted against what a *user*
of the audit sees:

- **MAJOR** — the scoring rubric changes such that scores are no longer
  comparable across versions, or an exported report changes shape in a way that
  breaks anything consuming it.
- **MINOR** — new signals, categories, or features; new detection for a spec
  change. Scores may shift, but the rubric still measures the same thing.
- **PATCH** — bug fixes, corrected detection, documentation, tooling. No
  intended change to what a correct page scores.

A rubric change always lands with a CHANGELOG entry stating what moved, because
a score that changes without explanation looks like a regression to whoever ran
the audit last month.

## [Unreleased]

_Nothing yet._

## [0.2.0] — 2026-07-27

Compliance pass against the Chrome Manifest V3 guidance and a re-check of the
rubric against the WebMCP draft as of July 2026. The spec moved underneath this
extension since 0.1.7 and several signals were scoring things that no longer
exist — or never did.

Scores will move. WebMCP Core is redistributed and the deprecated API surface
now earns partial rather than full credit, so a page scored under 0.1.7 is not
directly comparable.

### Security

- **Fixed an XSS hole in the side panel.** `escapeHtml()` used the
  `div.textContent = str; return div.innerHTML` trick, which escapes `&`, `<`
  and `>` but leaves quotes intact. Two call sites interpolate into attribute
  values (`title="${escapeHtml(...)}"`), so a page serving a tool description
  like `x" onmouseover="…` could break out of the attribute and run script
  **inside the extension's privileged side panel**, which has `chrome.*` access.
  All values rendered there originate from the scanned page. Now escapes
  `& < > " '` explicitly.

### Added

- Detection for `document.modelContext`, the current API location.
  `navigator.modelContext` was deprecated in Chromium 150 and the extension only
  ever looked at the deprecated one, so a site correctly using the current API
  scored zero on WebMCP Core.
- Use of the browser's own `getTools()` when available. 0.1.7 claimed the API
  "has no way to enumerate previously-registered tools" — that stopped being
  true. Its result is authoritative and takes precedence over the shadow
  registry, so tools registered before injection are no longer invisible.
- Subscription to `toolchange`. `unregisterTool()` was removed from the draft in
  April 2026 in favour of `AbortSignal`, so wrapping it no longer observes
  teardown and the registry kept reporting tools that had already been aborted.
- New signal: **agent submit handling** (3 pts, Declarative Forms). Detects
  `SubmitEvent.agentInvoked` / `respondWith()`, the `toolactivated` /
  `toolcanceled` lifecycle events, and `:tool-form-active` /
  `:tool-submit-active` styling.
- `PRIVACY.md` and `CHROMEWEBSTORE.md` for store submission, with a
  plain-English justification per permission.
- CI (`.github/workflows/ci.yml`): syntax check, a 27-case test suite, ESLint,
  and a packaged `.zip` artifact on every PR. The tests are dependency-free and
  run on Node's built-in runner. Each guard was mutation-tested — reintroducing
  the original bug makes it fail.

### Changed

- **Rebalanced WebMCP Core to 12 / 8 / 5 / 5 = 30.** It previously summed to 35
  against a declared max of 30, so a fully-featured page could total 105/100.
  Declarative Forms rebalanced to 7 / 6 / 4 / 3 / 2 / 3 = 25 to make room for
  the new signal. Verified: max reachable total is exactly 100, no category can
  overflow.
- Partial credit (3/5) for the deprecated `navigator` surface instead of full
  marks, with the migration named in the signal text.
- HTTPS reframed as a hard prerequisite. WebMCP is gated on a secure context, so
  an HTTP page cannot register tools at all. Now checks `window.isSecureContext`
  and says so plainly instead of treating it as three soft points.
- Corrected the imperative code example, which was wrong three ways: it used
  `navigator.modelContext` (deprecated), called `addTool()` (never existed in
  any version — it is `registerTool`), and used a `handler` property (the spec
  calls it `execute`). Now shows feature detection, `execute`, `annotations`,
  and `AbortSignal` teardown.
- `.well-known/webmcp` is still scored but labelled honestly as a community
  discovery convention rather than linked to a spec section that does not
  describe it.
- `robots.txt` AI-crawler detection now covers `claudebot` (Anthropic's current
  crawler — only the retired `claude-web` and `anthropic-ai` names were
  checked), plus `oai-searchbot`, `perplexitybot` and `ccbot`. A site blocking
  ClaudeBot previously still passed.
- Overlay batches 20 elements per frame behind `requestAnimationFrame` instead
  of styling every form in one synchronous pass.
- Discovery fetches given an 8s timeout and a 512 KB cap — they hit arbitrary
  third-party origins, so an unresponsive host hung the scan and a large
  `robots.txt` was read into the service worker in full.
- Remaining callback-style `chrome.runtime.sendMessage` calls converted to
  `async`/`await`.
- This changelog moved to the repository root and adopted Keep a Changelog. It
  previously lived in `extension/` and shipped inside the store package.

### Removed

- **Scoring for annotation attributes that do not exist.** WebMCP Core awarded
  5 points for `toolannotation`, `toolreadonly`, `tooldestructive`,
  `toolidempotent` and `toolopenworldhint`. None appear in any draft — the
  declarative API defines exactly four attributes. The points were unreachable,
  silently capping every site at 95. Annotations are now scored where they
  actually live: `annotations: { readOnlyHint }` on imperative tool definitions.
- `webNavigation` and `storage` permissions — declared but never used anywhere.
- `activeTab` permission — it grants nothing when the trigger is a side-panel
  button rather than a gesture on the action icon. `scripting` plus
  `host_permissions` was doing the work all along. Unused permissions are a
  common Chrome Web Store rejection reason.
- Two dead assignments surfaced by the new lint step: an unused `activeTabId` in
  the side panel, and a redundant `toLowerCase()` in the robots.txt parser whose
  result was never read.

### Fixed

- **Warnings rendered as red failures.** `content.js` emits `'warning'` but the
  side panel only recognised `'warn'` / `'partial'`. The markdown export handled
  it correctly, so the two outputs disagreed.
- **Re-scans stacked listeners.** Each scan added another
  `webmcp-checker-main-results` listener, so one tool registration triggered N
  full re-scans.
- Report footer reads the version from the manifest instead of the hardcoded
  `v0.1.4` it had carried for three releases.
- Badge text is rounded — the fractional coverage-ratio points could render a
  four-character badge like `63.4`.

## [0.1.7] — 2026-04-09

### Fixed

- Pages registering tools via `navigator.modelContext.registerTool` (e.g. the
  Chrome WebMCP React Flight Search demo) scored 0 on WebMCP Core and reported
  zero tools. Five overlapping root causes:
  1. `inject.js` looked for a `getTools()` / `.tools` accessor believed not to
     exist. Rewrote to monkey-patch `registerTool` and mirror every call into a
     shadow registry.
  2. `inject.js` loaded at scan time, too late — the React bundle had already
     called `registerTool`. Promoted to a declared MAIN-world content script at
     `document_start` so the wrap is in place before any page code runs. The
     dynamic-injection path remains as a fallback for pre-existing tabs.
  3. `registerTool` lives on the prototype, not the instance, so
     `ctx.registerTool = wrapped` created a shadow the page's calls bypassed.
     `wrap()` now walks up to five levels of the prototype chain and uses
     `Object.defineProperty`.
  4. Tool definitions contain handler functions that silently broke structured
     cloning of `CustomEvent.detail` across the MAIN → ISOLATED boundary,
     yielding an empty tools array. `snapshot()` now JSON-sanitizes
     `inputSchema` and `annotations`.
  5. `capture()` re-dispatches on every registration so React effects calling
     `registerTool` after the initial snapshot still reach the side panel.

### Changed

- Communication protocol: `content.js` dispatches `webmcp-checker-main-request`;
  `inject.js` responds with `webmcp-checker-main-results`.
- WebMCP Core "script references" prefers runtime observation over the
  inline-script keyword scan.

### Added

- Debug handle `window.__webmcpChecker = { snapshot, registry, tryWrap }` in the
  page's MAIN world.

## [0.1.6] — 2026-04-09

### Fixed

- Side panel now stretches when widened. `body { width: 320px }` plus
  `<meta viewport content="width=320">` pinned the layout viewport regardless of
  real panel width.

### Changed

- Category summary row rewritten as flex with shrink priority, so long labels
  like "Declarative Forms" are never truncated before the progress bar
  collapses.

## [0.1.5] — 2026-04-09

### Fixed

- Re-scan and Show on Page now act on the currently active tab.
  `getActiveTabId()` cached the id from its first call.
- CSP violation from inline `onclick=` handlers in rendered signals, which broke
  the fix-card toggle and Copy button. Replaced with data attributes and a
  delegated listener.
- Duplicate recommendations when a page renders the same form twice.

### Added

- Header shows the scanned URL as a clickable link, avoiding stale-URL confusion
  on the Export buttons.

## [0.1.4] — 2026-04-09

### Added

- Export Report button — a downloadable markdown audit report.
- Report contains score breakdown, detected signals, forms analysis, discovered
  tools, discovery files, prioritized recommendations (Do Now / Do When Ready /
  Future), and domain-adapted code examples.
- Every failing signal, recommendation, and code example links to the relevant
  spec, maintained in a single `DOC_LINKS` constant.

## [0.1.3] — 2026-04-09

### Fixed

- Category bars were always empty. `.category__bar-fill` is a `<span>`, and
  `width` / `height` do not apply to inline elements.

## [0.1.2] — 2026-04-09

### Fixed

- "Scanning…" spinner stayed visible above results — `display: flex` overrode
  the `hidden` attribute.
- Duplicate content script injection, now guarded by `window._webmcpCheckerLoaded`.

## [0.1.1] — 2026-04-09

### Fixed

- Content script is injected via the service worker before a scan, fixing tabs
  already open before the extension was loaded showing "Scan failed".
- Empty state resets on each scan, so a previous error no longer persists after
  a successful re-scan.

## [0.1.0] — 2026-04-09

Initial working version.

### Added

- Side panel with score gauge (0–100), category breakdown, tool inventory.
- Six scoring categories: WebMCP Core, Declarative Forms, Structured Data,
  Discovery & Crawling, Technical Foundation, Security.
- Discovery file fetching (`robots.txt`, `llms.txt`, `.well-known/webmcp`).
- MAIN world injection for `navigator.modelContext` detection.
- Fix cards with copy-to-clipboard snippets.
- Overlay toggle and JSON export.

[Unreleased]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.7...v0.2.0
[0.1.7]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/chapter42/webmcp-readiness-checker/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/chapter42/webmcp-readiness-checker/releases/tag/v0.1.0
