/**
 * @file scripts/check-syntax.mjs
 * Parses every shipped JS file. Dependency-free, so it runs before (and
 * independently of) anything that needs npm install.
 *
 * A syntax error in an extension is silent at load time — Chrome just skips
 * the script — so this is the cheapest way to catch a broken release.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['extension', 'test', 'test/helpers', 'scripts'];

let failed = 0;
let checked = 0;

for (const dir of dirs) {
  let entries;
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.js') && !entry.endsWith('.mjs')) continue;
    const file = join(root, dir, entry);
    checked++;
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      failed++;
      console.error(`FAIL ${dir}/${entry}`);
      console.error(String(err.stderr || err.message).trim());
    }
  }
}

console.log(`${checked - failed}/${checked} files parsed cleanly`);
process.exit(failed === 0 ? 0 : 1);
