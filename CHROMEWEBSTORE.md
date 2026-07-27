# Chrome Web Store Listing — WebMCP Readiness Checker

Single source of truth for the store listing. Copy-paste from here into the
Chrome Developer Dashboard; keep it updated whenever `manifest.json`, the
feature set, or the data handling changes.

**Last Updated:** 2026-07-27
**Current Version:** 0.2.0
**Status:** Not yet submitted

---

## Store Listing

**Name:** WebMCP Readiness Checker

**Category:** Developer Tools

**Short description** (132 char max):

> Audit any page for WebMCP and AI agent-readiness. Scores 0-100 across six categories with copy-paste fixes.

**Detailed description:**

> WebMCP Readiness Checker tells you how ready a web page is for AI agents, and exactly what to change.
>
> Open the side panel on any page and it scores the page from 0 to 100 across six areas: WebMCP tool definitions, agent-annotated forms, structured data, agent discovery files, technical foundations, and safety flags.
>
> What you get:
>
> • A single readiness score with a per-category breakdown, so you can see at a glance where a site stands.
> • Every check is explained. Click a failing check to get a working code snippet you can copy straight into your page.
> • An inventory of the tools the page already offers to agents, including the input each one expects and any gaps in how it is described.
> • A visual overlay that outlines every form on the page — green where it is already agent-ready, red where it is not — with suggested names for the ones that are missing them.
> • Downloadable reports in Markdown or JSON, with the scanned URL, findings, prioritised recommendations and links to the relevant specifications. Recommendations are grouped into what you can do today, what needs a WebMCP implementation, and what to wait on.
>
> Built for developers, technical SEOs and consultants who need to assess or explain agent-readiness. The rubric tracks the evolving WebMCP draft — including the move to the current API location and the removal of methods that earlier drafts used — so you are not shipping against advice that has expired.
>
> Everything runs locally in your browser. Nothing about the pages you visit is collected, stored, or sent anywhere.

---

## Permissions Justification

Every entry below must be filled in on the dashboard. Vague answers get rejected.

| Permission | Justification |
|------------|---------------|
| `sidePanel` | The extension's entire interface is a side panel. It displays the readiness score, the per-category breakdown, the discovered tool inventory, and the export buttons. |
| `scripting` | The audit works by reading the structure of the page being audited. This permission injects the scanner into the active tab when the user asks for a scan, and injects a second script into the page's own JavaScript context to observe which agent tools the page registers at runtime — tools that are invisible to a plain HTML inspection because they are created by JavaScript after load. |
| `host_permissions: <all_urls>` | The purpose of the extension is to audit whichever page the user is looking at, so the set of sites cannot be known in advance. Also used to read three public files from the audited site's own domain — `/robots.txt`, `/llms.txt` and `/.well-known/webmcp` — which are part of the readiness score. Only the origin of the page being scanned is requested; no third-party endpoint is contacted. |

### Permissions deliberately NOT requested

Worth stating on the dashboard, since reviewers look for over-permissioning:

- **`activeTab`** — removed in 0.2.0. It grants nothing here: the scan is triggered from a side-panel button, and `activeTab` only applies to direct gestures on the action icon, a context menu item, a keyboard command, or an omnibox suggestion.
- **`storage`** — nothing is persisted. Results live in memory for the lifetime of the panel.
- **`webNavigation`** — scans are user-triggered only. The extension does not watch navigation.
- **`tabs`** — never needed. The extension reads the tab's URL from the content script it already injected, not from the tab object.

---

## Privacy & Data Use

**Does this extension collect user data?** No.

Dashboard data-use declarations — all must be answered "No":

| Category | Collected? |
|----------|-----------|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

Required certifications — all three apply:

- [x] Does not sell or transfer user data to third parties, outside of approved use cases
- [x] Does not use or transfer user data for purposes unrelated to the item's single purpose
- [x] Does not use or transfer user data to determine creditworthiness or for lending purposes

**What actually happens to data:**

- Page analysis happens entirely in the browser. Scan results are held in memory in the side panel and discarded when it closes.
- The only network requests are to the audited site's own domain, for `/robots.txt`, `/llms.txt` and `/.well-known/webmcp`. These are public files, requested from the origin the user is already visiting.
- No analytics, no telemetry, no remote code, no external servers of any kind.
- Exports (Markdown and JSON) are generated locally and saved via the browser's own download flow. They are not uploaded.

**Privacy policy URL:**
`https://github.com/chapter42/webmcp-readiness-checker/blob/main/PRIVACY.md`

Source lives at [`PRIVACY.md`](PRIVACY.md) in this repository. The GitHub blob URL
is publicly accessible and renders as a formatted page, which satisfies the review
requirement. Verify it returns 200 on the `main` branch **after** this branch is
merged — a 404 is an automatic rejection.

The policy states no data collection, which must stay consistent with the "No"
answers in the data-use table above. If either changes, change both.

**Single purpose statement:**

> Analyse the page the user is viewing for WebMCP and AI agent-readiness, and present a score with specific, actionable fixes.

---

## Assets

| Asset | Requirement | Status |
|-------|-------------|--------|
| Icon 128×128 | Required | Present (`extension/icons/icon128.png`) |
| Icon 48×48 | Required | Present (`extension/icons/icon48.png`) |
| Icon 16×16 | Required | Present (`extension/icons/icon16.png`) |
| Screenshot 1280×800 or 640×400 | At least 1, up to 5 | **TODO** |
| Small promo tile 440×280 | Optional | Not planned |

**Screenshots to capture before submitting:**

1. Side panel showing a scored page with the gauge and category breakdown expanded.
2. A failing check expanded into its fix card, with the code snippet visible.
3. The page overlay active, showing green/red outlines on real forms.
4. The discovered-tools inventory with an input schema expanded.
5. A section of an exported Markdown report.

---

## Pre-Submission Checklist

- [x] `manifest_version` is 3
- [x] Every permission has a specific justification written above
- [x] No unused permissions declared
- [x] All icon files exist at their declared sizes (verified 16×16, 48×48, 128×128)
- [x] No inline scripts or inline event handlers (MV3 CSP)
- [x] No `eval()` or `new Function()`
- [x] No remote code execution — all scripts ship in the package
- [x] Side panel has an explicit open trigger (`chrome.action.onClicked`, no competing `default_popup`)
- [x] Version in `manifest.json` matches the version in this file
- [x] Privacy policy written ([`PRIVACY.md`](PRIVACY.md)) and consistent with the data-use answers above
- [ ] Privacy policy URL verified live on `main` after merge
- [ ] At least one screenshot at 1280×800 or 640×400
- [x] ZIP contains only `extension/` — `npm run package` fails the build if repo docs leak in
- [ ] Tested as an unpacked extension on a fresh Chrome profile

**Packaging command:**

```bash
npm run package
```

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.2.0 | 2026-07-27 | Fixed an XSS hole in the side panel where page-supplied text could break out of an HTML attribute. Dropped three unused permissions (`activeTab`, `storage`, `webNavigation`). Updated the rubric to the July 2026 WebMCP draft: detects the current API location, uses the browser's own tool enumeration where available, and stopped scoring attributes that never existed in the spec. Fixed a scoring bug where a page could exceed 100. Overlay no longer blocks the page while drawing. First release prepared for store submission. |
| 0.1.7 | 2026-04-09 | Runtime detection of JavaScript-registered tools via MAIN-world interception. |
| 0.1.6 | 2026-04-09 | Responsive side panel, CSP compliance, active-tab fixes. |
| 0.1.5 | 2026-04-09 | Scanned URL shown in header; duplicate recommendations deduped. |
| 0.1.4 | 2026-04-09 | Initial release — Markdown report export. |

---

## Review Notes

Two things a reviewer is most likely to query:

**Why `<all_urls>` rather than a fixed list?**
The extension is a general-purpose auditing tool. Its value is that a developer can open it on any site — their own staging environment, a competitor, a client's page — and get a readiness score. Restricting it to a list of hosts would defeat its purpose. It reads page structure only; it does not modify the page except for the user-initiated visual overlay, which is removed when toggled off.

**Why a content script that runs at `document_start` on every page?**
Websites register agent tools by calling a browser API from their own JavaScript, often within milliseconds of load. To see those registrations at all, the observer has to be in place before the page's own scripts run — by the time a user opens the side panel it is far too late. The script only observes; it does not modify page behaviour, and it sends nothing anywhere until the user explicitly runs a scan.
