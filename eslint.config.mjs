import base from '@dripl/eslint-config';

// The root config exists for the pre-commit hook, which hands ESLint the exact
// files it staged. It deliberately does not ignore test files: a globally
// ignored file passed explicitly becomes a warning, which `--max-warnings=0`
// would turn into a failed commit.
export default [{ ignores: ['dist/**', 'node_modules/**'] }, ...base];
