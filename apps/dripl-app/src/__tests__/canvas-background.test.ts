import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveCanvasBackground,
  resolveDisplayTheme,
  THEME_DEFAULT_BACKGROUNDS,
} from '@/lib/canvas/background';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveDisplayTheme', () => {
  it('uses an explicit light or dark theme directly', () => {
    expect(resolveDisplayTheme('light')).toBe('light');
    expect(resolveDisplayTheme('dark')).toBe('dark');
  });

  it('resolves system from the media query', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    expect(resolveDisplayTheme('system')).toBe('dark');
  });

  it('falls back to light without a media query', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveDisplayTheme('system')).toBe('light');
    expect(resolveDisplayTheme(undefined)).toBe('light');
  });
});

describe('resolveCanvasBackground', () => {
  it('uses the theme default when there is no stored override', () => {
    expect(resolveCanvasBackground(null, 'light')).toBe(THEME_DEFAULT_BACKGROUNDS.light);
    expect(resolveCanvasBackground(null, 'dark')).toBe(THEME_DEFAULT_BACKGROUNDS.dark);
    expect(resolveCanvasBackground(undefined, 'dark')).toBe(THEME_DEFAULT_BACKGROUNDS.dark);
  });

  it('leaves an explicit background alone in the light theme', () => {
    expect(resolveCanvasBackground('#ffffff', 'light')).toBe('#ffffff');
    expect(resolveCanvasBackground('#123456', 'light')).toBe('#123456');
  });

  it('filters an explicit background in the dark theme', () => {
    expect(resolveCanvasBackground('#ffffff', 'dark')).toBe('#121212');
    expect(resolveCanvasBackground('#f0ede6', 'dark')).toBe('#23211b');
    expect(resolveCanvasBackground('#1c1a17', 'dark')).toBe('#d8d6d4');
    expect(resolveCanvasBackground('#000000', 'dark')).toBe('#ededed');
  });

  it('does not filter the theme default a second time', () => {
    // The dark default is already dark; filtering it would turn the canvas
    // light and defeat the whole point of the default.
    expect(resolveCanvasBackground(null, 'dark')).toBe('#1C1A17');
    expect(resolveCanvasBackground(null, 'dark')).not.toBe('#d8d6d4');
  });
});
