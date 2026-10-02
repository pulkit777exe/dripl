#!/usr/bin/env node
/**
 * Guarantee a Prisma client exists before a server starts from source.
 *
 * `packages/db/src/generated/` is gitignored, so a fresh checkout has no
 * client and `pnpm dev` — which runs the TypeScript sources directly — cannot
 * resolve `@dripl/db`. Root `pnpm dev` and the Render build command both run
 * `db:generate` first, but a service started with nothing but `pnpm dev` as
 * its start command has no such step.
 *
 * The client is only generated when it is actually missing, so the common case
 * costs one short-lived process and nothing else. `prisma generate` reads
 * `schema.prisma` only and needs no database connection.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientEntry = resolve(repoRoot, 'packages/db/src/generated/client.ts');

if (existsSync(clientEntry)) {
  process.exit(0);
}

process.stderr.write('[db] Prisma client missing — generating (no database connection needed)\n');

const result = spawnSync('pnpm', ['--filter', '@dripl/db', 'db:generate'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.stderr.write(
    '[db] prisma generate failed — run `pnpm db:generate` and check the error above\n'
  );
  process.exit(result.status ?? 1);
}

process.exit(0);
