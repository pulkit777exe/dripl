import base from '@dripl/eslint-config';

export default [
  { ignores: ['dist/**', '**/*.test.ts'] },
  ...base,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  }
];
