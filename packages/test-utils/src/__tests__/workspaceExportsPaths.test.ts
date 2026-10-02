/**
 * Repository invariant: every hand-maintained `@dripl/*` entry in a tsconfig
 * `paths` map must name a subpath that some workspace package really exports,
 * must resolve to a file that exists, and must resolve to the same file that
 * the package's `exports` map names under `dist`.
 *
 * WHY THIS NEEDS A TEST AND NOT A REVIEW. `@dripl/*` has to be mapped to
 * workspace source in several tsconfigs so that `tsc` and `tsx` resolve to
 * `src/` instead of each package's `exports` map, whose `types` condition points
 * at `dist/*.d.ts` files that do not exist until `pnpm build` has run. Those
 * maps are hand-written and no compiler stands behind them. They fail in two
 * opposite ways:
 *
 *   - A MISSING entry is loud and useful: TS2307 on the import that needed it,
 *     pointing straight at the omission.
 *   - A PHANTOM entry — a `paths` key that names no real export — type-checks
 *     perfectly, because nothing imports it, and then fails at bundle or
 *     runtime. `@dripl/element` and `@dripl/math` declare no `"."` export at
 *     all, so a `@dripl/element` or `@dripl/math` key reads as coverage while
 *     being dead weight. An earlier draft of apps/dripl-app/tsconfig.check.json
 *     carried both, and review was the only thing that caught them.
 *
 * Nothing downstream can catch the second kind. scripts/bundle-server.mjs
 * resolves `@dripl/<pkg>[/<subpath>]` by convention rather than through
 * `exports`, so the bundler is deliberately free to disagree with `tsc`. That
 * independence is the design; this test is the thing that keeps the two in
 * agreement anyway.
 *
 * LOCATION. `@dripl/test-utils` is the repo's shared test-infrastructure
 * package, and a repository-wide invariant check is squarely in its remit.
 * Concretely it is the only home that works without new wiring:
 *
 *   - It already has a `test` script and a `vitest.config.ts`, so
 *     `turbo run test` picks this file up unchanged and the repo-wide task
 *     count stays where it is. A test at the repository root would not run at
 *     all: pnpm-workspace.yaml lists only apps/*, packages/* and tooling/*, so
 *     turbo never sees a root `test` task.
 *   - Its build tsconfig already excludes test files, so `tsc -b` can never
 *     compile this checker into `dist/`.
 *   - `tsconfig.check.json` leaves `types` unset, so Node's `node:fs` /
 *     `node:path` / `node:url` declarations resolve. This is a hard
 *     requirement, not a preference: `@dripl/common`, `@dripl/element` and
 *     `@dripl/math` all inherit `"types": []` from the shared node/server
 *     config and cannot see those modules at all, so a checker there fails
 *     `pnpm check-types` with TS2307 on its own imports.
 *
 * DIST-FREE BY CONSTRUCTION. Everything below is read out of `package.json` and
 * tsconfig files. Nothing consults `dist`, so this test is meaningful on a tree
 * that has never been built — the same tree `pnpm check-types` must pass on.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no pnpm-workspace.yaml found above this test file');
    dir = parent;
  }
}

const repoRoot = findRepoRoot();

/** Directories that can never hold a hand-written source tsconfig. */
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

function collectFiles(
  dir: string,
  accept: (name: string) => boolean,
  found: string[] = []
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) collectFiles(join(dir, entry.name), accept, found);
    } else if (accept(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/** Repo-relative, forward slashes, so failure messages read the same everywhere. */
const posix = (abs: string): string => relative(repoRoot, abs).split(sep).join('/');

type Manifest = {
  name?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type RawConfig = {
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[] | string>;
  };
};

const readManifest = (abs: string): Manifest => JSON.parse(readFileSync(abs, 'utf8')) as Manifest;

/**
 * tsconfigs are JSONC — most of them in this repo carry long `//` explanations.
 * TypeScript's own parser is the honest way to read them; `JSON.parse` throws on
 * the first comment.
 */
function readRawConfig(abs: string): RawConfig {
  const parsed = ts.parseConfigFileTextToJson(abs, readFileSync(abs, 'utf8'));
  if (parsed.error) {
    throw new Error(
      `${posix(abs)}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`
    );
  }
  return (parsed.config ?? {}) as RawConfig;
}

// ---------------------------------------------------------------------------
// The truth: what every workspace package actually exports
// ---------------------------------------------------------------------------

const manifestsByDir = new Map<string, Manifest>(
  collectFiles(repoRoot, name => name === 'package.json').map(abs => [
    dirname(abs),
    readManifest(abs),
  ])
);

const packageDirByName = new Map<string, string>();
for (const [dir, manifest] of manifestsByDir) {
  if (manifest.name) packageDirByName.set(manifest.name, dir);
}

/**
 * `packages/*` are the shipped libraries. `tooling/*` are configuration
 * packages consumed through `extends`, never through `import`, so they are
 * deliberately not subject to the completeness rule below even though
 * `@dripl/typescript-config` has an `exports` map of its own.
 */
const isLibraryPackage = (name: string): boolean =>
  dirname(packageDirByName.get(name) ?? '') === join(repoRoot, 'packages');

/** `"."` becomes `@dripl/pkg`; `"./types/element"` becomes `@dripl/pkg/types/element`. */
function specifierFor(packageName: string, exportKey: string): string | undefined {
  if (exportKey.includes('*')) return undefined; // a wildcard names no single specifier
  return exportKey === '.' ? packageName : `${packageName}/${exportKey.slice(2)}`;
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const conditions = value as Record<string, unknown>;
  for (const condition of ['default', 'import', 'types'] as const) {
    const target = conditions[condition];
    if (typeof target === 'string') return target;
  }
  return undefined;
}

/**
 * `./dist/encryption/index.js` -> `src/encryption/index.ts`.
 *
 * Only meaningful for packages that ship compiled `dist` output; returns
 * undefined for anything else, in which case the "right file" check is skipped
 * rather than guessed at.
 */
function sourceModuleFor(target: string | undefined): string | undefined {
  if (!target?.startsWith('./dist/')) return undefined;
  const withoutExtension = target.slice('./dist/'.length).replace(/\.d\.ts$|\.js$/, '');
  return `src/${withoutExtension}.ts`;
}

type ExportInfo = {
  packageName: string;
  exportKey: string;
  /** Repo-relative POSIX path of the source file this export compiles from. */
  sourceRel: string | undefined;
};

const exportsIndex = new Map<string, ExportInfo>();
const exportsByPackage = new Map<string, string[]>();

for (const [dir, manifest] of manifestsByDir) {
  if (!manifest.name || !manifest.exports) continue;
  const specifiers: string[] = [];
  for (const [key, value] of Object.entries(manifest.exports)) {
    const specifier = specifierFor(manifest.name, key);
    if (!specifier) continue;
    specifiers.push(specifier);
    const sourceRel = sourceModuleFor(exportTarget(value));
    exportsIndex.set(specifier, {
      packageName: manifest.name,
      exportKey: key,
      sourceRel: sourceRel ? posix(resolve(dir, sourceRel)) : undefined,
    });
  }
  exportsByPackage.set(manifest.name, specifiers.sort());
}

// ---------------------------------------------------------------------------
// The thing under test: every tsconfig in the repo that hand-writes @dripl paths
// ---------------------------------------------------------------------------

/**
 * `paths` targets resolve against `baseUrl` when one is set, and otherwise
 * against the tsconfig that declares them. Only in-repo `extends` chains are
 * walked — `@dripl/typescript-config` cannot be read from here and never
 * declares `baseUrl` anyway.
 */
function resolvePathsBase(configAbs: string, config: RawConfig, seen = new Set<string>()): string {
  const own = config.compilerOptions?.baseUrl;
  if (typeof own === 'string') return resolve(dirname(configAbs), own);
  const parents = typeof config.extends === 'string' ? [config.extends] : (config.extends ?? []);
  for (const parent of parents) {
    if (!parent.startsWith('.')) continue;
    const parentAbs = resolve(dirname(configAbs), parent);
    if (seen.has(parentAbs) || !existsSync(parentAbs)) continue;
    seen.add(parentAbs);
    return resolvePathsBase(parentAbs, readRawConfig(parentAbs), seen);
  }
  return dirname(configAbs);
}

type PathEntry = { specifier: string; targets: string[] };

type ScannedConfig = {
  abs: string;
  /** Directory that `paths` targets are resolved against. */
  baseDir: string;
  entries: PathEntry[];
};

function scanConfig(abs: string): ScannedConfig | undefined {
  const config = readRawConfig(abs);
  const paths = config.compilerOptions?.paths;
  if (!paths) return undefined;
  const entries: PathEntry[] = [];
  for (const [specifier, value] of Object.entries(paths)) {
    if (!specifier.startsWith('@dripl/')) continue;
    entries.push({ specifier, targets: Array.isArray(value) ? value : [value] });
  }
  if (entries.length === 0) return undefined;
  return { abs, baseDir: resolvePathsBase(abs, config), entries };
}

/** Globbed, never hardcoded: a tsconfig added after this test was written is covered too. */
const scannedConfigs: ScannedConfig[] = collectFiles(
  repoRoot,
  name => name.startsWith('tsconfig') && name.endsWith('.json')
)
  .map(scanConfig)
  .filter((config): config is ScannedConfig => config !== undefined)
  .sort((a, b) => posix(a.abs).localeCompare(posix(b.abs)));

/**
 * `tsconfig.check.json` and `tsconfig.dev.json` exist to make a workspace's
 * entire `@dripl/*` surface resolve to source, so a map in one of them has to
 * be complete for every library package that workspace depends on. Lint-only
 * configs are deliberately exempt: they exist to type the files `eslint .`
 * reads, so a deliberate subset is correct there — but they are still subject to
 * the phantom, existence and target-identity checks below.
 */
const FULL_MAP_CONFIGS = new Set(['tsconfig.check.json', 'tsconfig.dev.json']);

function nearestManifest(dir: string): Manifest | undefined {
  for (let current = dir; ;) {
    const manifest = manifestsByDir.get(current);
    if (manifest) return manifest;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** `@dripl/*` library packages the owning workspace declares, deps and devDeps alike. */
function libraryDependenciesOf(configAbs: string): string[] {
  const manifest = nearestManifest(dirname(configAbs));
  if (!manifest) return [];
  const declared = new Set<string>([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  return [...declared].filter(name => name.startsWith('@dripl/') && isLibraryPackage(name)).sort();
}

const driplImportPattern = /from '@dripl\/[^']*'/;

describe('tsconfig @dripl/* paths maps agree with package exports', () => {
  it('finds every workspace that imports @dripl/* and still has a map for it', () => {
    // The non-vacuity guard. It is derived independently of the tsconfig glob
    // on purpose: if a map is deleted outright, or the glob stops matching, this
    // still fails instead of quietly shrinking to zero configs.
    const workspaces = [...manifestsByDir.keys()]
      .filter(
        dir =>
          dirname(dir) === join(repoRoot, 'apps') || dirname(dir) === join(repoRoot, 'packages')
      )
      .sort();
    const importers = workspaces.filter(dir =>
      collectFiles(dir, name => name.endsWith('.ts') || name.endsWith('.tsx')).some(abs =>
        driplImportPattern.test(readFileSync(abs, 'utf8'))
      )
    );
    expect(importers.length).toBeGreaterThan(0);

    const mappedWorkspaces = new Set(scannedConfigs.map(config => dirname(config.abs)));
    const unmapped = importers.filter(dir => !mappedWorkspaces.has(dir)).map(posix);
    expect(
      unmapped,
      'these workspaces import @dripl/* but no tsconfig in them maps it to source'
    ).toEqual([]);
  });

  it('scans every tsconfig that hand-writes at least one @dripl/* key', () => {
    expect(scannedConfigs.length).toBeGreaterThanOrEqual(6);
    for (const config of scannedConfigs) {
      expect(
        config.entries.length,
        `${posix(config.abs)} was scanned with no entries`
      ).toBeGreaterThan(0);
    }
  });

  for (const config of scannedConfigs) {
    describe(posix(config.abs), () => {
      it('declares no @dripl/* key that no workspace package exports', () => {
        const phantoms = config.entries
          .map(entry => entry.specifier)
          .filter(specifier => !exportsIndex.has(specifier));
        expect(
          phantoms,
          `${posix(config.abs)}: a paths key that no package.json exports type-checks cleanly ` +
            'and then fails at bundle or runtime. Either add the export or delete the key.'
        ).toEqual([]);
      });

      it('points every @dripl/* key at a file that exists', () => {
        const missing: string[] = [];
        for (const entry of config.entries) {
          for (const target of entry.targets) {
            const abs = resolve(config.baseDir, target);
            if (!existsSync(abs)) {
              missing.push(`${entry.specifier} -> ${target} (resolved: ${posix(abs)})`);
            }
          }
        }
        expect(missing, `${posix(config.abs)}: mapped targets that are not on disk`).toEqual([]);
      });

      it('points every @dripl/* key at the module its package exports', () => {
        const wrong: string[] = [];
        for (const entry of config.entries) {
          const info = exportsIndex.get(entry.specifier);
          if (!info?.sourceRel) continue; // not a compiled dist package
          const expected = resolve(repoRoot, info.sourceRel);
          if (!entry.targets.some(target => resolve(config.baseDir, target) === expected)) {
            wrong.push(
              `${entry.specifier} -> [${entry.targets.join(', ')}] but ${info.packageName} ` +
                `exports ${info.exportKey} from ${info.sourceRel}`
            );
          }
        }
        expect(
          wrong,
          `${posix(config.abs)}: entries that resolve to a real file but the wrong one`
        ).toEqual([]);
      });

      if (FULL_MAP_CONFIGS.has(basename(config.abs))) {
        it('maps every subpath of every workspace package it depends on', () => {
          const declared = new Set(config.entries.map(entry => entry.specifier));
          const missing: string[] = [];
          for (const packageName of libraryDependenciesOf(config.abs)) {
            for (const specifier of exportsByPackage.get(packageName) ?? []) {
              if (!declared.has(specifier)) missing.push(specifier);
            }
          }
          expect(
            missing,
            `${posix(config.abs)}: exports of a package this workspace depends on that have no ` +
              'paths entry. A partial map is the same hazard as a phantom one — it reads as ' +
              'coverage until something imports the subpath that was left out.'
          ).toEqual([]);
        });
      }
    });
  }
});
