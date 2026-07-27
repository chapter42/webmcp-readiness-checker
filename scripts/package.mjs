/**
 * @file scripts/package.mjs
 * Builds the Chrome Web Store upload zip from extension/.
 *
 * Only the extension directory is packaged — the repo's README, CHANGELOG,
 * CHROMEWEBSTORE.md, tests and store assets must never end up in the upload.
 * Extra files are not a rejection on their own, but CHROMEWEBSTORE.md contains
 * internal review notes that have no business being shipped to users.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const dist = join(root, 'dist');

const { version } = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
const out = join(dist, `webmcp-readiness-checker-${version}.zip`);

mkdirSync(dist, { recursive: true });
if (existsSync(out)) rmSync(out);

// Exclude dotfiles and macOS cruft; everything else under extension/ ships.
execFileSync('zip', ['-r', '-q', out, '.', '-x', '.*', '-x', '__MACOSX/*', '-x', '*/.DS_Store'], {
  cwd: ext,
  stdio: 'inherit',
});

const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const forbidden = listing.filter((f) => /CHROMEWEBSTORE|PRIVACY\.md|^test\/|^\.git/.test(f));
if (forbidden.length) {
  console.error('Refusing to ship — these must not be in the package:');
  for (const f of forbidden) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`Built ${out.replace(root + '/', '')} (${listing.length} files)`);
for (const f of listing) console.log(`  ${f}`);
