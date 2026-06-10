import base from '@dripl/eslint-config';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...base,
  {
    rules: {
      'no-console': 'off',
    },
  },
];
