/** @type {import("eslint").Linter.Config} */
const config = {
  languageOptions: {
    globals: {
      browser: true,
      es2022: true,
      node: true,
    },
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
  rules: {
    'no-console': 'warn',
    'no-unused-vars': 'off',
  },
};

const reactInternal = config;

export { config, reactInternal };
export default config;
