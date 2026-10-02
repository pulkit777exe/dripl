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

const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nodeBrowserGlobals,
  { rules: sharedRules },
  loggingBoundary
);

export { base, sharedRules };
export default base;
