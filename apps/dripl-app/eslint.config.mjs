import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { base, sharedRules } from '@dripl/eslint-config';

/**
 * `eslint-config-next` v16 ships the React Compiler lint family. The canvas
 * gesture machine reads and writes refs inside pointer/wheel handlers and
 * mirrors store slices into local state, which those rules flag by design
 * rather than by defect — 108 sites today. They stay off, in one documented
 * place, until the app is migrated to compiler-safe code; the correctness
 * rules (`rules-of-hooks`, `static-components`) remain on.
 */
const reactCompilerLintsPendingMigration = {
  'react-hooks/exhaustive-deps': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/set-state-in-effect': 'off',
};

// Framework preset first, shared rules last: `eslint-config-next` downgrades
// `no-unused-vars` to a warning, and the repository rule has to win.
export default defineConfig([
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**']),
  ...nextVitals,
  ...nextTs,
  // The shared base must come after the Next presets (they set parser/plugins
  // and turn core recommended rules off) but before the two `rules` entries
  // below, so `sharedRules` still wins over `eslint-config-next/typescript`
  // downgrading `no-unused-vars` to a warning, and so the React Compiler
  // overrides still win over anything `base` sets.
  ...base,
  { rules: reactCompilerLintsPendingMigration },
  { rules: sharedRules },
]);
