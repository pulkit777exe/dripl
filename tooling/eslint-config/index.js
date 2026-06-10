import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** @type {import("eslint").Linter.Config} */
const config = {
  ignores: ['dist/**', '**/*.test.ts', '**/*.spec.ts'],
};

const sharedRules = {
  'no-console': 'warn',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'off',
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
);

const reactInternal = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nodeBrowserGlobals,
  { rules: sharedRules },
);

export { config, base, reactInternal, sharedRules };
export default base;
