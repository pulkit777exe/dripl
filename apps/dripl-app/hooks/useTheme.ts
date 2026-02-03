"use client";

import { useState, useEffect } from "react";
import { useCanvasStore, type Theme } from "@/lib/canvas-store";

export function useTheme() {
  const theme = useCanvasStore((state) => state.theme);
  const setTheme = useCanvasStore((state) => state.setTheme);

  // Get system theme preference
  const getSystemTheme = (): "light" | "dark" => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light"; // Default to light if not available
  };

  // Get effective theme based on current setting
  const getEffectiveTheme = (): "light" | "dark" => {
    if (theme === "system") {
      return getSystemTheme();
    }
    return theme;
  };

  // Current effective theme
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(getEffectiveTheme());

  // Update effective theme when theme or system preference changes
  useEffect(() => {
    const newEffectiveTheme = getEffectiveTheme();
    setEffectiveTheme(newEffectiveTheme);

    // Update root element class for CSS variables
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(newEffectiveTheme);
    }
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => setEffectiveTheme(getSystemTheme());
      
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  return {
    theme,
    effectiveTheme,
    setTheme,
    isDark: effectiveTheme === "dark",
    isLight: effectiveTheme === "light",
    isSystem: theme === "system",
  };
}
