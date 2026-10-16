/**
 * Dark-mode color handling, mirroring Excalidraw's `applyDarkModeFilter`.
 *
 * Only the achromatic extremes are remapped: near-black ink must read on a
 * dark canvas and near-white ink on a light one. Chromatic colors pass
 * through untouched in both themes — remapping those would rewrite user data
 * instead of adapting chrome. Matching is case-insensitive over the spellings
 * the editor stores (`#1e1e1e` is the default stroke).
 */

const DARK_REMAP: Record<string, string> = {
  '#1e1e1e': '#e9ecef',
  '#000000': '#e9ecef',
  '#000': '#e9ecef',
  black: '#e9ecef',
  '#ffffff': '#1e1e1e',
  '#fff': '#1e1e1e',
  white: '#1e1e1e',
};

export function applyDarkModeFilter(
  color: string | undefined,
  theme: 'light' | 'dark'
): string | undefined {
  if (theme !== 'dark' || typeof color !== 'string') return color;
  return DARK_REMAP[color.toLowerCase()] ?? color;
}
