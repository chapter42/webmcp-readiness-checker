/**
 * @file scripts/bump-version.mjs
 * Bumps the version in every place that carries it, in one step.
 *
 *   npm run bump -- patch
 *   npm run bump -- minor
 *   npm run bump -- 1.0.0
 *
 * The version lives in extension/manifest.json (the release version),
 * package.json, and CHANGELOG.md. Keeping them in sync by hand is how the
 * report footer ended up shipping a hardcoded v0.1.4 for three releases.
 *
 * This rewrites the [Unreleased] heading into the new version and opens a
 * fresh empty [Unreleased] above it, so release notes are written as you go
 * rather than reconstructed from git log at release time.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(root, 'extension', 'manifest.json');
const PACKAGE = join(root, 'package.json');
const CHANGELOG = join(root, 'CHANGELOG.md');
const STORE = join(root, 'CHROMEWEBSTORE.md');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const REPO = 'https://github.com/chapter42/webmcp-readiness-checker';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run bump -- <major|minor|patch|X.Y.Z>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const current = manifest.version;
const parts = current.match(SEMVER);
if (!parts) {
  console.error(`Current manifest version "${current}" is not valid semver.`);
  process.exit(1);
}

const [major, minor, patch] = parts.slice(1).map(Number);
let next;
if (arg === 'major') next = `${major + 1}.0.0`;
else if (arg === 'minor') next = `${major}.${minor + 1}.0`;
else if (arg === 'patch') next = `${major}.${minor}.${patch + 1}`;
else if (SEMVER.test(arg)) next = arg;
else {
  console.error(`"${arg}" is neither major/minor/patch nor a valid X.Y.Z version.`);
  process.exit(1);
}

if (next === current) {
  console.error(`Version is already ${current}.`);
  process.exit(1);
}

// Chrome rejects an upload whose version is not higher than the published one,
// so refuse to go backwards rather than discover it at submission time.
const isHigher = (a, b) => {
  const [x, y, z] = a.split('.').map(Number);
  const [p, q, r] = b.split('.').map(Number);
  return x > p || (x === p && (y > q || (y === q && z > r)));
};
if (!isHigher(next, current)) {
  console.error(`Refusing to move ${current} -> ${next}: the Chrome Web Store only accepts increases.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

// --- manifest.json ----------------------------------------------------------
manifest.version = next;
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

// --- package.json -----------------------------------------------------------
const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'));
pkg.version = next;
writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);

// --- CHANGELOG.md -----------------------------------------------------------
let changelog = readFileSync(CHANGELOG, 'utf8');

if (!changelog.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md has no "## [Unreleased]" section to promote.');
  process.exit(1);
}

changelog = changelog.replace(
  /## \[Unreleased\]\n\n(_Nothing yet\._\n\n)?/,
  `## [Unreleased]\n\n_Nothing yet._\n\n## [${next}] — ${today}\n\n`
);

// Refresh the compare links at the bottom.
changelog = changelog
  .replace(
    /\[Unreleased\]: \S+/,
    `[Unreleased]: ${REPO}/compare/v${next}...HEAD`
  )
  .replace(
    /(\[Unreleased\]: \S+\n)/,
    `$1[${next}]: ${REPO}/compare/v${current}...v${next}\n`
  );

writeFileSync(CHANGELOG, changelog);

// --- CHROMEWEBSTORE.md ------------------------------------------------------
// Only the "Current Version" line is mechanical; the version-history table is
// prose and stays a manual edit.
let store = readFileSync(STORE, 'utf8');
if (store.includes('**Current Version:**')) {
  store = store
    .replace(/\*\*Current Version:\*\* .*/, `**Current Version:** ${next}`)
    .replace(/\*\*Last Updated:\*\* .*/, `**Last Updated:** ${today}`);
  writeFileSync(STORE, store);
}

console.log(`${current} -> ${next}`);
console.log('Updated: extension/manifest.json, package.json, CHANGELOG.md, CHROMEWEBSTORE.md');
console.log('');
console.log('Next:');
console.log(`  1. Move the release notes under ## [${next}] in CHANGELOG.md`);
console.log('  2. Add a Version History row in CHROMEWEBSTORE.md');
console.log(`  3. npm run verify && git commit && git tag v${next}`);
