import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import { getColorPalette, ColorPalette, Theme } from "./colors";
import { store, actions, StoreState } from "../store";

interface ThemeContextValue {
  theme: Theme;
  colors: ColorPalette;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "dripl-theme",
}: ThemeProviderProps) {
  const getInitialTheme = (): Theme => {
    if (typeof window === "undefined") return defaultTheme;
    
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    
    return defaultTheme;
  };

  const theme = useStore(store, (state: StoreState) => state.appState.theme);
  const colors = useMemo(() => getColorPalette(theme), [theme]);

  useEffect(() => {
    const initialTheme = getInitialTheme();
    const currentTheme = store.state.appState.theme;
    
    if (currentTheme !== initialTheme) {
      actions.setAppState({ theme: initialTheme });
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    
    if (theme === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
    
    actions.setAppState({
      canvasBackgroundColor: theme === "dark" ? "#1e1e1e" : "#ffffff",
    });
    
    localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    
    const handleChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        actions.setAppState({ theme: e.matches ? "dark" : "light" });
      }
    };

    mediaQuery?.addEventListener("change", handleChange);
    return () => mediaQuery?.removeEventListener("change", handleChange);
  }, [storageKey]);

  const setTheme = (newTheme: Theme) => {
    actions.setAppState({ theme: newTheme });
  };

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const value = useMemo(
    () => ({
      theme,
      colors,
      setTheme,
      toggleTheme,
    }),
    [theme, colors],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function useThemeColors(): ColorPalette {
  const { colors } = useTheme();
  return colors;
}

export function useThemeColor<K extends keyof ColorPalette>(key: K): ColorPalette[K] {
  const { colors } = useTheme();
  return colors[key];
}