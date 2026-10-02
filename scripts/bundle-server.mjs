#!/usr/bin/env node
/**
 * Bundle a Node server (http-server / ws-server) into a single ESM file.
 *
 * Why a bundle instead of `tsc` emit: the workspace uses
 * `moduleResolution: "bundler"` with standard extensionless relative imports.
 * `tsc` does not rewrite specifiers on emit, so raw `tsc` output is only
 * loadable by a bundler — running it under plain `node` (as the Docker
 * images do) died with ERR_MODULE_NOT_FOUND. Bundling resolves every
 * relative import at build time, so the output has no relative specifiers
 * left to fail.
 *
 * Dependency strategy: third-party packages stay external
 * (`packages: 'external'`) and are provided by `node_modules` at runtime,
 * exactly as today. Workspace packages (`@dripl/*`) are bundled from source
 * via the plugin below, so the servers never load package `dist` output under
 * raw Node at all.
 *
 * Type safety comes from `turbo run check-types` (`tsc --noEmit`), which
 * runs separately. This script performs no type checking, like most
 * esbuild-based pipelines.
 *
 * Usage (run from the server package dir, wired as its `build` script):
 *   node ../../scripts/bundle-server.mjs
 */
import { existsSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { context } = require('esbuild');

const appDir = process.cwd();
const appName = basename(appDir);
const entryPoint = resolve(appDir, 'src/index.ts');
const outfile = resolve(appDir, 'dist/index.js');
const repoRoot = resolve(appDir, '..', '..');

/**
 * Resolve `@dripl/<pkg>[/<subpath>]` to workspace source, not `dist`.
 *
 * A subpath may be a flat module (`src/logger.ts`) or a directory with its own
 * entry (`src/encryption/index.ts`, which is how `@dripl/utils/encryption` is
 * declared in that package's `exports`). Try the flat path first and fall back
 * to the directory index, so both shapes resolve — and so this stays in step
 * with `tsconfig.dev.json`, which maps the same specifiers for `pnpm dev`.
 */
const workspacePlugin = {
  name: 'dripl-workspace-source',
  setup(build) {
    build.onResolve({ filter: /^@dripl\// }, args => {
      const [, pkg, ...rest] = args.path.split('/');
      const subpath = rest.length > 0 ? rest.join('/') : 'index';
      const base = resolve(repoRoot, 'packages', pkg, 'src', subpath);
      const flat = `${base}.ts`;
      if (existsSync(flat)) return { path: flat };
      const index = resolve(base, 'index.ts');
      if (existsSync(index)) return { path: index };
      // Neither shape exists. Hand the flat path to esbuild so the failure
      // names the specifier the caller actually wrote.
      return { path: flat };
    });
  },
};

rmSync(resolve(appDir, 'dist'), { recursive: true, force: true });

const ctx = await context({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  plugins: [workspacePlugin],
  outfile,
  sourcemap: true,
  logLevel: 'warning',
});

await ctx.rebuild();
await ctx.dispose();

console.log(`bundled ${appName} -> dist/index.js`);
