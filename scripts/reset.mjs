#!/usr/bin/env node
// Reset the Configuration Manager's on-disk state (the data/ directory) for a clean restart.
//
// Usage:
//   node scripts/reset.mjs                 # wipe everything (the whole data/ directory)
//   node scripts/reset.mjs users           # clear only the user directory (re-triggers admin bootstrap)
//   node scripts/reset.mjs changes audit   # clear specific stores, keep the rest
//
// Targets: all (default) | users | changes | instances | settings | audit | repo
//
// Note: stop the API server before running this. The server keeps state in memory and rewrites
// these files, so deleting while it runs can be undone on its next save.
import { rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// data/ lives at the repo root, one level up from this script — resolved independently of cwd.
const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const FILES = {
  users: 'users.json',
  changes: 'changes.json',
  instances: 'instances.json',
  settings: 'settings.json',
  audit: 'audit.json',
  repo: 'config-repo',
};

const args = process.argv.slice(2).map((a) => a.toLowerCase());
const targets = args.length === 0 || args.includes('all') ? ['all'] : args;

const unknown = targets.filter((t) => t !== 'all' && !(t in FILES));
if (unknown.length) {
  console.error(`Unknown target(s): ${unknown.join(', ')}`);
  console.error(`Valid targets: all, ${Object.keys(FILES).join(', ')}`);
  process.exit(1);
}

if (!existsSync(dataDir)) {
  console.log(`Nothing to reset — no data directory at ${dataDir}`);
  process.exit(0);
}

function remove(path, label) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    console.log(`  removed ${label}`);
  } else {
    console.log(`  (skip) ${label} — not present`);
  }
}

console.log(`Resetting Configuration Manager data in ${dataDir}`);
if (targets.includes('all')) {
  remove(dataDir, 'data/ (everything)');
} else {
  for (const t of targets) remove(join(dataDir, FILES[t]), `data/${FILES[t]}`);
}
console.log('Done. Restart the API and reload the app — the first visitor becomes admin.');
