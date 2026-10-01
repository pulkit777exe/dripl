#!/usr/bin/env node
/**
 * Pre-push gate: verify that a clean checkout of HEAD has no unresolvable
 * relative imports.
 *
 * Catches files that were imported by a commit but never `git add`ed (the
 * roomAccess.ts incident) and files left behind importing modules that no
 * longer exist (the api/index.src.ts incident). Worktree-green runs cannot
 * see either class of defect because the missing file is present locally.
 *
 * Usage: node scripts/check-head-imports.mjs            (checks HEAD)
 *        IMPORT_SCAN_REV=<rev> node scripts/check-head-imports.mjs
 * Exits 1 on any gap.
 *
 * The Prisma client (packages/db/src/generated) is gitignored by design and
 * rebuilt by `db:generate`; it is excluded.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const rev = process.env.IMPORT_SCAN_REV || 'HEAD';
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const headFiles = git('ls-tree', '-r', '--name-only', rev).split('\n').filter(Boolean);
const headSet = new Set(headFiles);

const candidates = base => [
  base,
  `${base}.ts`,
  `${base}.tsx`,
  `${base}/index.ts`,
  base.replace(/\.js$/, ''),
  `${base.replace(/\.js$/, '')}.ts`,
];

const importRe = /from\s+'(\.[^']+)'/g;
const missing = [];

for (const file of headFiles) {
  if (!file.endsWith('.ts')) continue;
  if (file.includes('node_modules/') || file.includes('/generated/')) continue;

  const content = git('show', `${rev}:${file}`);
  for (const match of content.matchAll(importRe)) {
    const rel = match[1];
    if (rel.includes('generated/client')) continue; // prisma, rebuilt
    const base = path.normalize(path.join(path.dirname(file), rel));
    if (!candidates(base).some(c => headSet.has(c))) {
      missing.push(`  ${file} -> ${rel}`);
    }
  }
}

if (missing.length > 0) {
  console.error(`${rev} is NOT self-contained — imported files missing from ${rev}:`);
  console.error(missing.join('\n'));
  console.error('A clean checkout would not compile. Track the file or delete the dead import.');
  process.exit(1);
}

console.log(
  `${rev} self-contained: ${headFiles.length} tracked files, zero unresolvable relative imports.`
);
