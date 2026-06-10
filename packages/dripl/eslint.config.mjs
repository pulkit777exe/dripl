import base from '@dripl/eslint-config';

export default [
  { ignores: ['dist/**'] },
  ...base,
  {
    rules: {
      'no-console': 'off',
    },
  },
];
