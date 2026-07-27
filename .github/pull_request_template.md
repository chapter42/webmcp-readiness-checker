<!--
Keep this short. The checklist exists because these are the things that have
actually broken before, not as ceremony.
-->

## What changed

<!-- One or two sentences. What problem does this solve? -->

## Checklist

- [ ] `npm run verify` passes locally (syntax + tests)
- [ ] Loaded unpacked in Chrome and exercised the change by hand

If `manifest.json` changed:

- [ ] Every permission added is actually called somewhere (CI enforces this)
- [ ] `CHROMEWEBSTORE.md` has a plain-English justification for each new permission
- [ ] Version bumped with `npm run bump -- patch|minor|major`, notes written under `## [Unreleased]`

If scoring changed:

- [ ] Category point values still sum to the declared `max` (CI enforces this)
- [ ] `claude-skill/webmcp-audit.md` updated to match — it carries the same rubric

If this tracks a WebMCP spec change:

- [ ] Signal text names the migration, rather than only marking the old form wrong
- [ ] Code examples in `sidepanel.js` `FIX_SNIPPETS` reflect the current API
- [ ] The "as of" date in `markdown-report.js` and the README is current

## Notes for the reviewer

<!--
Anything you are unsure about, or deliberately left out of scope.
CI attaches a built .zip to every run — since Chrome 150 removed
--load-extension, downloading that and loading it unpacked is the quickest way
to try this branch.
-->
