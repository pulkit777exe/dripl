import js from '@eslint/js';
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

const nodeBrowserGlobals = {
  languageOptions: {
    globals: {
      browser: true,
      es2022: true,
      node: true,
    },
  },
};

/**
 * Type-aware linting is deliberately OFF. This is the measured reason, so the
 * question does not get re-litigated from scratch.
 *
 * Swapping `tseslint.configs.recommended` for `recommendedTypeChecked` and
 * giving the parser a TS project was built and measured end to end. It works,
 * and it is not worth taking yet: 560 findings against a baseline of 0.
 *
 *   rule                            prod   test   total
 *   no-unnecessary-type-assertion   104     42     146
 *   unbound-method                    0    113     113
 *   no-unsafe-member-access           7     74      81
 *   no-unsafe-assignment             28     37      65
 *   require-await                     7     42      49
 *   no-floating-promises             14     20      34
 *   no-misused-promises              34      0      34
 *   no-unsafe-return                  4      7      11
 *   no-unsafe-argument                8      0       8
 *   prefer-promise-reject-errors      1      7       8
 *   no-unsafe-call                    2      5       7
 *   no-base-to-string                 0      4       4
 *   (await-thenable, only-throw-error, restrict-template-expressions: all 0)
 *
 * "prod" is hand-written source. "test" is unit tests, the `e2e` and
 * `__tests__` directories, and the root build-tool config files. Two thirds of
 * the total is test-suite noise nobody wants to gate on: `unbound-method` is
 * 113 of 113 in tests, and is almost entirely `vi.spyOn(obj, 'method')`, which
 * the rule reads as "this reference is not bound to its receiver" by
 * construction. It is a false positive on the dominant Vitest idiom.
 *
 * Wall clock on the same machine, per-workspace `eslint .` summed by hand:
 *
 *   workspace            before    after
 *   packages/common        1.8s     3.4s
 *   packages/element       1.8s     4.7s
 *   packages/math          1.6s     4.0s
 *   packages/utils         1.8s     3.5s
 *   packages/db            1.8s     3.8s
 *   packages/test-utils    1.8s     5.0s
 *   apps/http-server       2.5s    14.7s
 *   apps/ws-server         2.2s     8.3s
 *   apps/dripl-app        16.3s    57.7s
 *   total                 31.5s   105.1s   (3.3x)
 *
 * `pnpm turbo run lint --force` went from a ~26s median wall to ~50s (1.9x);
 * the hand-summed 3.3x is the honest figure, because turbo's parallelism hides
 * part of the cost. Timing a failing configuration needs `--continue`, since
 * turbo otherwise aborts the run on the first failing task and reports a time
 * that never happened.
 *
 * WHAT TO DO INSTEAD, in order:
 *
 *   1. Turn on `no-floating-promises` alone: 14 findings in production, and it
 *      is the rule this repo actually needs. An unhandled rejection inside the
 *      canvas gesture machine is silent state corruption, and unit tests do
 *      not catch it. Do NOT reach for `recommendedTypeChecked` to get it; name
 *      the rule explicitly or the other 546 findings arrive with it.
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
 * Four things the measurement turned up, so nobody has to rediscover them:
 *
 *   - `recommendedTypeChecked`'s rule object ships with NO `files` key. Spread
 *     as-is, every type-aware rule is handed to every linted file, and a
 *     type-aware rule applied to a file with no type information is a hard
 *     crash ("You have used a rule which requires type information"), not a
 *     finding, so a plain `eslint .` dies on the first `eslint.config.js`.
 *     Every rule-bearing object has to be pinned to the TypeScript extensions.
 *   - You then cannot scope the type-aware rules away from test files with an
 *     `ignores` list. `no-unused-vars: off` and the `no-unused-vars` override
 *     live in the SAME rule object as the type-aware rules, so excluding tests
 *     re-enables the core rule and manufactures 86 phantom `no-undef` and
 *     `no-unused-vars` errors. The presets are not separable by file glob.
 *     Every linted TypeScript file has to be inside a project instead.
 *   - `projectService: true` is the cwd-independent option, which matters
 *     because the pre-commit hook runs ESLint from the repository root over
 *     absolute staged paths. But it resolves each file to its nearest
 *     `tsconfig.json`, and each package's build tsconfig excludes test files
 *     (it must, or `tsc -b` would compile them into `dist`). 19 linted files
 *     therefore have no project. `allowDefaultProject` is not the escape: it
 *     rejects any glob containing a double star outright, and the rejection
 *     applies to every file, not just the tests.
 *   - The configuration that did work is `parserOptions.project` with
 *     `tsconfigRootDir` set to `process.cwd()` (each workspace runs its own
 *     `eslint .`, so the cwd is the workspace), plus one lint-only tsconfig
 *     per workspace: `noEmit`, `composite: false`, and referenced by nothing,
 *     so `tsc -b` cannot pick it up and cannot clobber the esbuild bundles in
 *     each app's `dist` directory. Those files were deleted along with the
 *     rest of this experiment. The shape is `extends` the workspace's
 *     `tsconfig.check.json` (which already un-excludes tests, exactly what a
 *     lint project needs) with `include` widened to cover the source
 *     directory and the root build-tool config files; the two servers and the
 *     Next app have no check config, so they extend their own `tsconfig.json`
 *     and must force `composite` and `incremental` off.
 *   - That setup also breaks the pre-commit gate, which is why it is not a
 *     drop-in. lint-staged runs `eslint --fix` from the repository root, so
 *     `tsconfigRootDir: process.cwd()` is the repo root and `./tsconfig...`
 *     resolves to a file that does not exist; every staged TypeScript file
 *     then fails with "Parsing error: Cannot read file". Verified, not
 *     theorised. A root lint tsconfig would paper over it with a repo-wide
 *     program that needs every package's `dist` built to resolve workspace
 *     imports, which is a worse trade than the rule set itself.
 */
const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nodeBrowserGlobals,
  { rules: sharedRules },
  loggingBoundary
);

export { base, sharedRules };
export default base;
