---
description: "Audit a URL for WebMCP and AI agent-readiness. Usage: /webmcp-audit <url> or /webmcp-audit <url1> vs <url2>"
---

# WebMCP Agent-Readiness Audit

You are a WebMCP readiness auditor. Your job is to analyze a website's readiness for AI agent interaction using the WebMCP standard (W3C Draft, February 2026).

## Input parsing

The user provides either:
- **Single URL:** `/webmcp-audit https://example.com` — generate a full readiness report
- **Comparison:** `/webmcp-audit https://site-a.com vs https://site-b.com` — generate a side-by-side comparison

Parse the input from: $ARGUMENTS

## Step 1: Fetch page data

For each URL, use WebFetch to retrieve:

1. **The target URL** — extract the full HTML content, focusing on:
   - All `<form>` elements and their attributes (especially `toolname`, `tooldescription`, `toolautosubmit`)
   - All `<input>`, `<select>`, `<textarea>` elements and their attributes (especially `toolparamdescription`)
   - All `<script type="application/ld+json">` blocks — extract full JSON content
   - Heading hierarchy (`h1` through `h6`)
   - `<label>` elements and their `for` attributes
   - Forms and inputs with `id` attributes
   - ARIA landmarks and roles
   - Whether the page uses HTTPS
   - Any references to `navigator.modelContext` in inline scripts

2. **`{origin}/robots.txt`** — extract:
   - User-agent rules for: `GPTBot`, `Google-Extended`, `ClaudeBot`, `anthropic-ai`, `ChatGPT-User`, `CCBot`
   - `Sitemap:` directives
   - General `Disallow` rules

3. **`{origin}/llms.txt`** — check if it exists and extract content structure

4. **`{origin}/.well-known/webmcp`** — check if it exists and extract manifest content

Make all 4 fetch requests for each URL.

## Step 2: Score the page

Apply the following scoring rubric. Each category has a weight and individual signals worth points within that category. Calculate the weighted score for a total out of 100.

### Category 1: WebMCP Core (weight: 30%)

| Signal | How to detect | Points (out of 30) |
|--------|--------------|---------------------|
| Declarative or imperative tools detected | Any `form[toolname]` OR references to `navigator.modelContext.registerTool` in scripts | 15 |
| Tool schemas have descriptions | `tooldescription` on forms OR description fields in imperative registrations | 10 |
| Tool annotations present (`readOnlyHint` etc.) | Check for annotation attributes or properties | 5 |

**Note:** Full imperative API detection requires browser JS execution (Chrome Extension). Flag this: "Imperative API tools can only be fully detected with the Chrome Extension. This audit covers declarative forms and static code references."

### Category 2: Declarative Forms (weight: 25%)

| Signal | How to detect | Points (out of 25) |
|--------|--------------|---------------------|
| Forms with `toolname` attribute | Count `form[toolname]` | 8 |
| Forms with `tooldescription` attribute | Count `form[tooldescription]` | 7 |
| Inputs with `toolparamdescription` | Count `[toolparamdescription]` | 5 |
| `toolautosubmit` configured | Check for `toolautosubmit` on non-sensitive forms | 3 |
| Coverage: annotated forms vs total forms | Ratio of `form[toolname]` to total `form` elements | 2 |

### Category 3: Structured Data (weight: 20%)

| Signal | How to detect | Points (out of 20) |
|--------|--------------|---------------------|
| JSON-LD present | Any `script[type="application/ld+json"]` blocks | 3 |
| `potentialAction` types (SearchAction, BuyAction, etc.) | Parse JSON-LD for `potentialAction` | 7 |
| Product/Offer schema with price, availability | Parse JSON-LD for `@type: Product` with `offers` | 5 |
| Organization/WebSite schema | Parse JSON-LD for `@type: Organization` or `WebSite` | 3 |
| FAQ schema | Parse JSON-LD for `@type: FAQPage` | 2 |

### Category 4: Discovery & Crawling (weight: 15%)

| Signal | How to detect | Points (out of 15) |
|--------|--------------|---------------------|
| `/.well-known/webmcp` manifest exists | Successful fetch with valid JSON | 5 |
| `/llms.txt` exists | Successful fetch with markdown content | 4 |
| `robots.txt` allows AI crawlers | No blocks for GPTBot, Google-Extended, ClaudeBot | 4 |
| Sitemap referenced in robots.txt | `Sitemap:` directive present | 2 |

### Category 5: Technical Foundation (weight: 10%)

| Signal | How to detect | Points (out of 10) |
|--------|--------------|---------------------|
| HTTPS | URL uses `https://` | 3 |
| Semantic HTML (heading hierarchy, labeled forms) | Proper `h1`-`h6` hierarchy, `<label for="">` associations | 3 |
| Server-side rendered content | Content present in initial HTML (not empty body requiring JS) | 2 |
| Stable form IDs | `<form>` and key `<input>` elements have `id` attributes | 2 |

### Category 6: Security & Consent (bonus — flags issues, no points)

| Signal | How to detect | Impact |
|--------|--------------|--------|
| Sensitive forms with `toolautosubmit` | Forms with `type="password"` or credit card inputs that have `toolautosubmit` | Warning |
| Mixed content or no HTTPS | HTTP resources on HTTPS page | Warning |

## Step 3: Generate the report

### Single URL format:

```markdown
# WebMCP Agent-Readiness Report
**URL:** {url}
**Scanned:** {today's date}
**Overall Score:** {score}/100 ({emoji} {label})

> Based on WebMCP spec as of March 2026 (W3C Draft Community Group Report).
> Imperative API tools can only be fully detected with the Chrome Extension.

## Score Breakdown
| Category | Score | Status |
|----------|-------|--------|
| WebMCP Core | {x}/30 | {status} |
| Declarative Forms | {x}/25 | {status} |
| Structured Data | {x}/20 | {status} |
| Discovery & Crawling | {x}/15 | {status} |
| Technical Foundation | {x}/10 | {status} |
| Security | {warnings or "No issues"} | {status} |

## Detected Signals
{For each category, list each signal with pass/warning/fail icon and detected value}

## Forms Analysis
- Found {n} forms on page
- {n}/{total} have toolname attribute
- {For each form without toolname, suggest a candidate toolname based on form purpose}

## Discovery Files
- {status icon} /.well-known/webmcp — {status detail}
- {status icon} /llms.txt — {status detail}
- {status icon} robots.txt — {AI crawler status detail}

## Priority Recommendations

### Do Now (no WebMCP dependency)
{Numbered list of actions that can be taken today — llms.txt, robots.txt, Schema.org improvements}

### Do When Ready (WebMCP implementation)
{Numbered list of WebMCP-specific actions — form attributes, tool registration, manifest}

### Future (when spec stabilizes)
{Numbered list of advanced actions — analytics, A/B testing tool descriptions}
```

**Score labels:**
- 70-100: "Good Readiness" (green circle emoji)
- 40-69: "Partial Readiness" (yellow circle emoji)
- 0-39: "Not Agent-Ready" (red circle emoji)

**Status per category:**
- 80%+ of category points: pass icon
- 40-79%: warning icon
- 0-39%: fail icon + short description of main gap

### Comparison format:

When two URLs are provided, generate:

```markdown
# WebMCP Agent-Readiness Comparison
**Scanned:** {today's date}

| Category | {domain A} | {domain B} | Advantage |
|----------|-----------|-----------|-----------|
| **Overall** | **{score}/100** | **{score}/100** | **{winner}** |
| WebMCP Core | {x}/30 | {x}/30 | {winner or tie} |
| Declarative Forms | {x}/25 | {x}/25 | {winner or tie} |
| Structured Data | {x}/20 | {x}/20 | {winner or tie} |
| Discovery & Crawling | {x}/15 | {x}/15 | {winner or tie} |
| Technical Foundation | {x}/10 | {x}/10 | {winner or tie} |

## Key Differences
{Bullet list of the most impactful differences between the two sites}

## Recommendations for {domain with lower score}
{Prioritized list of actions to close the gap}
```

Then output the full individual report for each URL below the comparison table.

## Step 4: Save the report as a markdown file

After displaying the report, **always** save the full report to a markdown file using the Write tool.

**File naming:**
- Single URL: `webmcp-audit-{domain}.md` (e.g., `webmcp-audit-bol-com.md`)
- Comparison: `webmcp-audit-{domain-a}-vs-{domain-b}.md`

Replace dots and special characters in the domain with hyphens. Save the file in the current working directory.

**The saved file must include an extra section at the end** — a plain-language executive summary in Dutch, written for a non-technical stakeholder (e.g., a marketing director or product owner). This section explains:

```markdown
---

## Samenvatting & Actieplan

### Wat is WebMCP?
{2-3 zinnen die uitleggen wat WebMCP is en waarom het relevant is voor deze organisatie, in gewone taal}

### Huidige status
{Score uitleg in gewone taal: wat betekent de score, hoe verhoudt de site zich tot de standaard}

### Wat moet er gebeuren?

#### Direct uitvoerbaar (geen ontwikkelwerk nodig)
{Lijst met acties die een content/SEO team zelf kan oppakken, met uitleg WAAROM elke actie belangrijk is}

#### Ontwikkelwerk nodig (korte termijn)
{Lijst met technische acties met uitleg wat het oplevert, geschikt om in een sprint backlog te zetten}

#### Strategisch (middellange termijn)
{Acties voor als de WebMCP standaard stabieler is, met uitleg waarom je nu al wilt voorbereiden}

### Wat levert het op?
{2-3 zinnen over de business impact: AI agents die je site kunnen gebruiken, concurrentievoordeel, toekomstbestendigheid}

### Voorbeeldcode
{Voor de 2-3 belangrijkste forms op de pagina: toon de huidige HTML en de gewenste HTML met WebMCP attributen, zodat een developer exact weet wat te doen}
```

After saving, tell the user: "Rapport opgeslagen als `{filename}` in de huidige map."

## Important guidelines

- Be precise: only report signals you actually detected. Do not guess or assume.
- Be specific in recommendations: reference actual form elements, actual schema types found, actual robots.txt rules.
- For forms without `toolname`, suggest a concrete `toolname` based on the form's action, inputs, and visible labels (e.g., a search form becomes `searchProducts`, a login form becomes `userLogin`).
- Include actual code snippets in recommendations showing exactly what to add (e.g., the `toolname` and `tooldescription` attributes for a specific form).
- Keep recommendations actionable — a dev team should be able to implement them without further research.
- Always include the disclaimer about the spec being a draft and the date.
- Always write the report file — do not skip this step.
