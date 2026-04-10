/** @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    rules: {
      'no-console': 'off',
    },
  },
];
