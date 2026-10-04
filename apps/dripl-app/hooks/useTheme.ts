'use client';

import { useState, useEffect } from 'react';
import { useTheme as useNextThemes } from 'next-themes';
import { useCanvasStore, type Theme } from '@/lib/store';

export function useTheme() {
  const { theme, setTheme: setNextTheme, resolvedTheme } = useNextThemes();
  const setCanvasTheme = useCanvasStore(state => state.setTheme);

  const getSystemTheme = (): 'light' | 'dark' => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  const getEffectiveTheme = (): 'light' | 'dark' => {
    if (theme === 'system' || !theme) {
      return getSystemTheme();
    }
    return theme === 'dark' ? 'dark' : 'light';
  };

  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (theme) {
      setCanvasTheme(theme as Theme);
    }
  }, [theme, setCanvasTheme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get('theme');
    if (themeParam === 'dark' || themeParam === 'light') {
      setEffectiveTheme(themeParam);
      return;
    }
    const resolved = resolvedTheme ?? getEffectiveTheme();
    setEffectiveTheme(resolved === 'dark' ? 'dark' : 'light');
  }, [theme, resolvedTheme]);

  useEffect(() => {
    if (theme === 'system') {
      // Guarded exactly as `getSystemTheme` guards it. This call site was not,
      // and the asymmetry is the whole bug: with `theme === 'system'` and no
      // `matchMedia` -- an older engine, an embedded webview, a test environment
      // -- the effect threw `TypeError: window.matchMedia is not a function` on
      // mount, which takes the canvas down with it rather than falling back to
      // the light theme the getter above already chose.
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => setEffectiveTheme(getSystemTheme());
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setNextTheme(newTheme);
  };

  return {
    theme,
    effectiveTheme,
    setTheme,
    isDark: effectiveTheme === 'dark',
    isLight: effectiveTheme === 'light',
    isSystem: theme === 'system',
  };
}
