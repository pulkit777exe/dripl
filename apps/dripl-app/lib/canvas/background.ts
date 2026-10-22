import { applyDarkModeFilter } from '@dripl/element/theme';

/**
 * Canvas background resolution.
 *
 * `canvasBackground: null` means "use the theme default"; an explicit stored
 * value is theme-neutral and is filtered for display in dark mode, exactly
 * like an element color. The same helper feeds the on-screen surface and every
 * export path, so a PNG cannot disagree with the canvas it came from.
 */

export const THEME_DEFAULT_BACKGROUNDS = {
  light: '#F0EDE6',
  dark: '#1C1A17',
} as const;

export type DisplayTheme = 'light' | 'dark';

/** Resolve next-themes' `system` (or an unset theme) to the theme on screen. */
export function resolveDisplayTheme(theme: string | undefined): DisplayTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * The background actually painted for a stored canvas background.
 *
 * No override defers to the theme default, which is already the right value for
 * that theme and must not be filtered again. An explicit value is filtered,
 * because it is stored theme-neutrally.
 */
export function resolveCanvasBackground(
  canvasBackground: string | null | undefined,
  theme: DisplayTheme
): string {
  if (!canvasBackground) return THEME_DEFAULT_BACKGROUNDS[theme];
  return applyDarkModeFilter(canvasBackground, theme) ?? canvasBackground;
}
