# CLAUDE.md

Guidance for working in this repository. The general principles bias toward
caution over speed — apply judgement, and skip the ceremony on trivial edits.

## What this is

A Chrome extension (Manifest V3, vanilla JS, no build step) that audits any page
for WebMCP and AI agent-readiness and scores it 0–100 across six categories.
The side panel is the whole UI.

```
extension/
  manifest.json       MV3 config — the release version lives here
  background.js       Service worker: side panel, discovery fetches, injection
  content.js          ISOLATED world: DOM scan, scoring, overlay
  inject.js           MAIN world: intercepts tool registration on the page
  sidepanel.{html,css,js}
  markdown-report.js  Pure function: scanData -> markdown
claude-skill/         The same rubric, as a URL-based audit skill
test/                 Regression guards; run with npm test
```

## Working principles

### 1. Think before coding
State your assumptions and surface what you are unsure about rather than
quietly picking an interpretation. If two readings of the request lead to
materially different work, ask. If they lead to the same work, proceed.

### 2. Simplicity first
Write the least code that solves the stated problem. This project has no
framework, no bundler, and no runtime dependencies, and that is deliberate — it
keeps the store package small and reviewable. Do not add a dependency without
saying why the standard library will not do.

### 3. Surgical changes
Match the surrounding style — JSDoc on functions, section banner comments, the
existing naming. Change what the task requires and leave the rest alone. Do not
reformat, rename, or "tidy" adjacent code in the same change; it buries the
actual diff.

### 4. Verify, don't assume
`npm run verify` before you claim something works. If you changed behaviour a
test cannot reach, say so plainly rather than implying it was checked. Reporting
"done" on unverified work is worse than reporting it as unverified.

## The rules that are specific to this codebase

These are not style preferences. Each one corresponds to a bug that actually
shipped.

### The spec is a moving target — check it, don't recall it

WebMCP is a W3C Draft Community Group Report, not standards-track, and it has
changed repeatedly. Between 0.1.7 and 0.2.0 alone: the API moved from
`navigator.modelContext` to `document.modelContext`, `unregisterTool()` /
`provideContext()` / `clearContext()` were removed, and `getTools()` plus a
`toolchange` event appeared.

**Before changing any detection or code example, verify the current shape
against live sources** — the [draft spec](https://webmachinelearning.github.io/webmcp/),
the [explainers](https://github.com/webmachinelearning/webmcp), and
[Chrome's docs](https://developer.chrome.com/docs/ai/webmcp). Training data on
this API is unreliable; three separate errors in the shipped code example
(`addTool()`, `handler`, `navigator.`) came from plausible-sounding recall.

The extension also once scored five declarative attributes — `toolreadonly`,
`tooldestructive`, and friends — that have never existed in any draft. If you
cannot point at the attribute in a spec document, do not score it.

When a site uses a superseded form, award partial credit and name the migration.
A readiness tool that just says "wrong" is less useful than one that says what
to change.

### The side panel is a privileged context

Everything rendered there — tool names, descriptions, signal values — comes from
the scanned page and is attacker-controlled. The panel has full `chrome.*`
access.

Run every page-derived value through `escapeHtml()`, including inside attribute
values. `escapeHtml` must escape quotes; the `div.textContent` /
`div.innerHTML` round-trip does not, which is exactly how a tool description
could break out of `title="…"` and execute. `test/escaping.test.js` guards both
the function and its call sites.

### MAIN world and ISOLATED world are different worlds

`inject.js` runs in the page's own JS context because the model context object
is not reachable from a content script. Two consequences:

- **Timing.** It is declared at `document_start` so the interception is in place
  before page scripts register anything. Injecting at scan time is too late —
  a React bundle has already registered its tools.
- **Serialization.** Data crossing the boundary via `CustomEvent.detail` is
  structured-cloned. Tool definitions contain handler functions, which throw.
  JSON-sanitize anything that crosses; the panel only needs the shape.

Prefer the browser's own `getTools()` over the shadow registry when available —
it is authoritative and already reflects `AbortSignal` teardown, which the
interception cannot see.

### The service worker is ephemeral

`background.js` terminates after roughly 30 seconds idle. It holds no mutable
module-level state and must not start doing so — use `chrome.storage` if state
is ever needed. `test/manifest.test.js` fails on a top-level `let` or `var`
there.

### Scoring must add up

Each category's signals must sum to exactly its declared `max`, and the
categories to 100. This is easy to break because the branches look mutually
exclusive on inspection — WebMCP Core silently summed to 35 against a max of 30
for several releases, letting pages score 105/100. `test/scoring.test.js`
executes the functions rather than reading them.

If you change the rubric, update `claude-skill/webmcp-audit.md` in the same
change. It carries a copy of the same rubric for URL-based audits and will
otherwise disagree with the extension.

### Permissions must be justified and used

Every permission in the manifest needs a real call site (CI enforces this) and a
plain-English justification in `CHROMEWEBSTORE.md`. Unused permissions are a
common store rejection. Note that `activeTab` grants nothing here — the scan is
triggered from a side-panel button, and `activeTab` only applies to a direct
gesture on the action icon, a context menu item, a command, or an omnibox
suggestion.

MV3's CSP forbids inline `<script>`, inline event handlers, `eval()` and
`new Function()` in extension pages. Use data attributes with delegated
listeners.

## Commands

```bash
npm run verify    # syntax check + tests, no dependencies needed
npm run lint      # ESLint (the only thing needing npm install)
npm run package   # build the store zip into dist/
npm run bump -- patch|minor|major
```

`npm run bump` updates the version in the manifest, `package.json`,
`CHANGELOG.md` and `CHROMEWEBSTORE.md` together. Do not edit them separately —
the report footer once shipped a hardcoded `v0.1.4` for three releases.

## Testing the extension by hand

Chrome 150 removed the `--load-extension` flag, so an unpacked build can only be
loaded through `chrome://extensions` → Developer mode → Load unpacked. CI
attaches a built `.zip` to every run, which is the quickest way to try a branch.

For automated end-to-end checks, a Chrome for Testing build still accepts
`--load-extension` alongside `--disable-extensions-except`. Note that
`chrome.sidePanel.open()` requires a genuine user gesture and cannot be reliably
triggered over CDP.

## Conventions

- Semver, interpreted against what a user of the audit sees. The policy is at
  the top of `CHANGELOG.md`; a rubric change always lands with an entry saying
  what moved, because an unexplained score shift reads as a regression.
- Keep a Changelog groups: Added / Changed / Deprecated / Removed / Fixed /
  Security.
- Commit messages explain the failure, not just the change. "Fixed the escaping"
  says nothing; naming the payload that got through says everything.
- `CHANGELOG.md`, `PRIVACY.md` and `CHROMEWEBSTORE.md` live at the repo root and
  must stay out of the store package. `scripts/package.mjs` fails the build if
  they appear in the zip.
