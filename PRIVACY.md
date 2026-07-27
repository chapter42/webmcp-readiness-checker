# Privacy Policy — WebMCP Readiness Checker

**Last updated:** 27 July 2026
**Applies to:** WebMCP Readiness Checker Chrome extension, version 0.2.0 and later

## Summary

WebMCP Readiness Checker does not collect, store, or transmit any personal data
or browsing information. Everything the extension does happens locally in your
browser. There are no servers, no accounts, and no analytics.

## What data the extension reads

To produce a readiness score, the extension reads the structure of the page you
choose to audit:

- HTML elements and their attributes — primarily `<form>`, `<input>`,
  `<select>`, `<textarea>`, headings, labels and ARIA landmarks
- `<script type="application/ld+json">` structured-data blocks
- The contents of inline `<script>` and readable stylesheets, to detect
  WebMCP-related code patterns
- Tools the page registers with the browser's model context API at runtime
- The page URL, protocol, and whether it is a secure context

This information is held in memory for as long as the side panel is open and is
discarded when you close it. It is never written to disk by the extension, never
placed in browser storage, and never sent anywhere.

## What data the extension collects

None. Specifically, the extension does not collect:

personally identifiable information · health information · financial or payment
information · authentication information or credentials · personal
communications · location · browsing history · user activity or behavioural
analytics · website content sent off-device

The extension has no analytics, no telemetry, no crash reporting, no advertising
identifiers, and no third-party SDKs.

## Network requests

The extension makes exactly three network requests, only when you run a scan,
and only to the domain of the page you are already visiting:

- `/robots.txt`
- `/llms.txt`
- `/.well-known/webmcp`

These are public files that form part of the discovery score. The requests are
plain, unauthenticated GETs; the extension sends no data with them beyond what
the browser normally includes in any request to that site. Responses are read in
memory, capped at 512 KB, and discarded with the rest of the scan.

No request is ever made to any server operated by the extension author or by any
third party.

## Why the extension asks for access to all sites

The extension declares access to all websites (`<all_urls>`). This is required
because it is a general-purpose auditing tool: you point it at whichever page
you want to assess, so the set of sites cannot be known in advance. The same
permission allows the three discovery files above to be fetched from the audited
site's own domain.

This permission is used solely to read page structure for the audit. It is not
used to track browsing, build a profile, or read data from sites you are not
actively auditing.

## Data storage

The extension stores nothing. It does not use `chrome.storage`, cookies,
`localStorage`, or `IndexedDB`. Scan results exist only in the memory of the
open side panel.

Because nothing is stored, there is nothing to retain, export, or delete. Closing
the side panel discards the scan.

## Exported reports

The "Export JSON" and "Export Report" buttons generate a file in your browser and
hand it to Chrome's normal download flow. The file is written to your own
computer. Nothing is uploaded, and the extension has no visibility into what you
do with the file afterwards.

An exported report contains the URL and findings for the page you scanned. If you
audited a page on an internal or authenticated system, treat the exported file
with the same care as the page itself.

## Third-party services

The extension does not use any third-party services, APIs, libraries, or hosted
resources. All code ships inside the extension package; nothing is loaded
remotely at runtime.

## Changes to this policy

If the extension's data practices change, this policy will be updated and the
"Last updated" date revised. Material changes will also be noted in the
extension's changelog. The current version of this policy is always available at
the URL published on the extension's Chrome Web Store listing.

## Contact

Questions about this policy or the extension's data handling:
**roy@chapter42.com**

Issues can also be raised at
<https://github.com/chapter42/webmcp-readiness-checker/issues>.
