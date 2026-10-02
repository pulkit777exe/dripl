import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Single source of truth for repository lint rules.
 *
 * Every workspace extends this config so the pre-commit gate and `pnpm lint`
 * cannot disagree. Packages may add their framework preset and ignore globs;
 * the one documented exception is the Next.js app, which turns off a named
 * set of React Compiler lints pending a compiler-safe migration.
 */
const sharedRules = {
  // The noisy levels (`log`, `debug`, `trace`) are errors everywhere except the
  // logging boundary module below, which is scoped off by file glob. `warn` and
  // `error` stay allowed for the bootstrap paths that have no logger to report
  // through yet: boot-time env validation before the pino logger exists in the
  // two servers, and an idle pg Pool error callback with no request-scoped
  // logger. Each of those call sites carries a written justification. The
  // allowlist matches `compiler.removeConsole`'s `exclude: ['error', 'warn']`
  // in the Next app, so what survives lint also survives the production build.
  'no-console': ['error', { allow: ['warn', 'error'] }],
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'error',
};

/**
 * A logging boundary is the one module whose job is to reach the console, so
 * the rule is scoped off by configuration rather than waived per line.
 */
const loggingBoundary = {
  files: ['**/logging.ts'],
  rules: { 'no-console': 'off' },
};

/**
 * Globals available to every linted file.
 *
 * These are SPREAD, not toggled. `{ node: true, browser: true }` is eslintrc
 * syntax: in flat config it declares two globals literally named "node" and
 * "browser" and expands nothing. The result was a config in which `process`,
 * `Buffer`, `window` and `self` were all undefined, so any `.js`/`.mjs` file
 * linted through the ROOT config failed `no-undef` — `commitlint.config.js`
 * on `module`, the service worker `apps/dripl-app/public/sw.js` on `self`.
 * The per-workspace configs masked it because `eslint-config-next` brings its
 * own expanded globals, so the same file passed or failed depending on which
 * directory ESLint ran from.
 *
 * `globals.node` already supplies the CommonJS names (`module`, `require`,
 * `exports`, `__dirname`, `__filename`), so no separate CommonJS block is
 * needed; declaring them again would only create a second thing to forget.
 */
const nodeBrowserGlobals = {
  files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  languageOptions: {
    globals: {
      ...globals.es2022,
      ...globals.browser,
      ...globals.node,
    },
  },
};

/**
 * The repository root, found by walking up from THIS MODULE rather than from
 * `process.cwd()`.
 *
 * `process.cwd()` is what broke the pre-commit gate last time: lint-staged
 * runs `eslint --fix` from the repository root over absolute staged paths, so a
 * cwd-relative `./tsconfig.eslint.json` resolved against the repository root,
 * where that experiment had put no lint config at all, and every staged
 * TypeScript file died with `Parsing error: Cannot read file`. Resolving from
 * this module's own location is identical whether ESLint was invoked from the
 * repo root or from inside one of the nine workspaces, which is the only
 * property that actually matters here. The `pnpm-workspace.yaml` probe also
 * means a mis-installed copy of this package fails loudly at config load
 * instead of silently linting with no type information.
 */
const configDir = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `@dripl/eslint-config: no pnpm-workspace.yaml found above ${startDir}; ` +
          'cannot resolve the repository root for type-aware linting.'
      );
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot(configDir);

/**
 * One lint-only tsconfig per workspace, plus one at the repository root.
 *
 * `parserOptions.project` is a list, not a glob pattern per workspace, and
 * typescript-eslint only builds the programs it actually needs — so a
 * workspace's `eslint .` constructs one program and the root hook's handful of
 * staged files construct only the one or two that contain them. Every entry
 * is spelled out because a workspace added without one fails loudly (its files
 * would be "not found in any of the provided projects") rather than quietly
 * linting without types.
 *
 * These are `tsconfig.eslint.json`, NOT the packages' existing
 * `tsconfig.check.json`: `check-types` must keep passing with `dist` absent,
 * and the lint projects additionally pin `@dripl/*` to workspace SOURCE so the
 * rule can see real types without a build having happened first. Linting
 * therefore no longer depends on build order.
 */
const typeAwareProjects = [
  'apps/dripl-app/tsconfig.eslint.json',
  'apps/http-server/tsconfig.eslint.json',
  'apps/ws-server/tsconfig.eslint.json',
  'packages/common/tsconfig.eslint.json',
  'packages/db/tsconfig.eslint.json',
  'packages/element/tsconfig.eslint.json',
  'packages/math/tsconfig.eslint.json',
  'packages/test-utils/tsconfig.eslint.json',
  'packages/utils/tsconfig.eslint.json',
  'tsconfig.eslint.json',
];

/**
 * Type-aware linting, one rule at a time.
 *
 * Only `no-floating-promises` is on. This is measured, not taste. Turning on
 * `tseslint.configs.recommendedTypeChecked` instead — which is the obvious way
 * to get this rule — drags in 546 other findings against a baseline of 0:
 *
 *   rule                            prod   test   total
 *   no-unnecessary-type-assertion   104     42     146
 *   unbound-method                    0    113     113
 *   no-unsafe-member-access           7     74      81
 *   no-unsafe-assignment             28     37       65
 *   require-await                     7     42       49
 *   no-floating-promises             14     20       34   <-- this one, alone
 *   no-misused-promises              34      0       34
 *   no-unsafe-return                  4      7       11
 *   no-unsafe-argument                8      0        8
 *   prefer-promise-reject-errors      1      7        8
 *   no-unsafe-call                    2      5        7
 *   no-base-to-string                 0      4        4
 *   (await-thenable, only-throw-error, restrict-template-expressions: all 0)
 *
 * "prod" is hand-written source. "test" is unit tests, the `e2e` and
 * `__tests__` directories, and the root build-tool config files. Two thirds of
 * the total is test-suite noise nobody wants to gate on: `unbound-method` is
 * 113 of 113 in tests, and is almost entirely `vi.spyOn(obj, 'method')`, which
 * the rule reads as "this reference is not bound to its receiver" by
 * construction. It is a false positive on the dominant Vitest idiom.
 *
 * WHAT COMES NEXT, in order:
 *
 *   1. DONE: `no-floating-promises` alone. An unhandled rejection inside the
 *      canvas gesture machine is silent state corruption, and unit tests do
 *      not catch it. Do NOT reach for `recommendedTypeChecked` to extend this;
 *      name each rule explicitly or the other findings arrive with it.
 *   2. Then `await-thenable`, `only-throw-error` and
 *      `restrict-template-expressions`: zero findings today, free to enable.
 *   3. `require-await` (7 in production) and `no-misused-promises` (34, almost
 *      all an `async` handler passed where a `void` return is expected, which
 *      in React means the returned promise is dropped on the floor).
 *   4. Treat `no-unsafe-...` as a typing project, not a lint project: 45 in
 *      production, nearly all `any` arriving from the Prisma client and from
 *      `JSON.parse` boundaries. Lint cannot fix those; types can.
 *   5. `no-unnecessary-type-assertion` is 146 but every one of them is
 *      autofixable, so it is a mechanical `eslint --fix` pass on its own, worth
 *      doing for the noise reduction alone.
 *   6. Leave `unbound-method` off in tests, or relax it there. Vitest spying
 *      is a legitimate unbound reference.
 *
 * WHAT IT COSTS — measured on this repo, three interleaved runs per workspace
 * so machine drift cannot flatter the result (median of 3, `eslint .` per
 * workspace, serial):
 *
 *   workspace            before    after
 *   packages/common        1.9s    10.7s
 *   packages/db            1.8s    11.5s
 *   packages/element       2.3s    13.0s
 *   packages/math          2.0s    12.5s
 *   packages/test-utils    1.9s    13.4s
 *   packages/utils         1.9s    14.7s
 *   apps/http-server       2.8s    10.4s
 *   apps/ws-server         2.7s    11.4s
 *   apps/dripl-app        16.7s    24.5s
 *   total                 33.9s   121.9s   (3.6x)
 *
 * `pnpm turbo run lint --force` went from a 20.2s to a 39.8s median (2.0x);
 * turbo's parallelism hides part of the cost, so the hand-summed 3.6x is the
 * honest figure. This reproduces the 3.3x / 1.9x recorded for the full preset,
 * which is the important result: **the wall clock is program construction, not
 * rule execution.** Adding the whole 73-rule `recommendedTypeChecked` set on
 * top of this configuration — same scoping, same programs — measured 3-5%
 * slower, not 3x. So "one rule" does not buy speed; it buys a zero-finding
 * diff. `parserOptions.project` has no persistent program cache, which is the
 * lever worth pulling if this cost ever has to come down: `projectService`
 * caches across runs but cannot see a `tsconfig.eslint.json` (it resolves only
 * `tsconfig.json` / `jsconfig.json`), so making it work means folding the lint
 * config into the build config, which `tsc -b` then cannot be kept out of.
 *
 * WHY THIS CONFIG SHAPE — the four traps the last attempt walked into, and how
 * each one is closed. Every one of these was verified, not theorised:
 *
 *   - `recommendedTypeChecked` ships its rule object with NO `files` key, so
 *     spreading it hands type-aware rules to every linted file, and a
 *     type-aware rule applied to a file with no type information is a hard
 *     crash ("You have used a rule which requires type information"), not a
 *     finding: a plain `eslint .` dies on the first `eslint.config.js`. This
 *     object therefore pins itself to the TypeScript extensions with an
 *     explicit `files`, and JS/MJS config files never receive `project`.
 *   - Because the presets put `no-unused-vars: off` in the SAME rule object as
 *     the type-aware rules, they cannot be split by file glob — excluding tests
 *     re-enables the core rule and manufactures 86 phantom `no-undef` /
 *     `no-unused-vars` errors. Naming a single rule sidesteps this entirely:
 *     the object below carries only `no-floating-promises`, so test files are
 *     covered by exactly the same object as production files and there is
 *     nothing to split.
 *   - `projectService: true` is cwd-independent but resolves each file to its
 *     nearest `tsconfig.json`, and each package's build tsconfig excludes test
 *     files (it must, or `tsc -b` would compile them into `dist`). 19 linted
 *     files therefore have no project, and `allowDefaultProject` is not the
 *     escape: it rejects any glob containing a double star outright, and the
 *     rejection applies to every file, not just the tests. Instead every
 *     workspace gets a `tsconfig.eslint.json` that widens `include` over its
 *     tests and root-level `*.config.ts` files, with `noEmit`, `composite: false`
 *     and `incremental: false` so `tsc -b` can neither pick it up nor clobber
 *     the esbuild bundles in each app's `dist`.
 *   - The `tsconfigRootDir: process.cwd()` variant breaks the pre-commit gate,
 *     which lint-staged drives from the repository root. See `findRepoRoot`
 *     above: the root is derived from this module's own location, so the root
 *     invocation and the per-workspace invocations resolve the identical ten
 *     projects. Verified with the actual gate invocation, not by inspection.
 */
const typeCheckedRules = {
  files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: typeAwareProjects,
      tsconfigRootDir: repoRoot,
    },
  },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
  },
};

const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nodeBrowserGlobals,
  { rules: sharedRules },
  loggingBoundary,
  typeCheckedRules
);

export { base, sharedRules, repoRoot, typeAwareProjects };
export default base;
