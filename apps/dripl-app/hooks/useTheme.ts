"use client";

import { useState, useEffect } from "react";
import { useTheme as useNextThemes } from "next-themes";
import { useCanvasStore, type Theme } from "@/lib/canvas-store";

export function useTheme() {
  const { theme, setTheme: setNextTheme, resolvedTheme } = useNextThemes();
  const setCanvasTheme = useCanvasStore((state) => state.setTheme);

  const getSystemTheme = (): "light" | "dark" => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  };

  const getEffectiveTheme = (): "light" | "dark" => {
    if (theme === "system") {
      return getSystemTheme();
    }
    return theme as "light" | "dark";
  };

  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const themeParam = params.get("theme");
      console.log("Theme parameter:", themeParam);
      if (themeParam === "dark" || themeParam === "light") {
        return themeParam;
      }
    }
    const defaultTheme = getEffectiveTheme();
    console.log("Default theme:", defaultTheme);
    return defaultTheme;
  });

  useEffect(() => {
    if (theme) {
      setCanvasTheme(theme as Theme);
    }
  }, [theme, setCanvasTheme]);

  useEffect(() => {
    console.log("useEffect theme update");
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get("theme");
    console.log("useEffect theme parameter:", themeParam);
    if (!themeParam) {
      const newEffectiveTheme = getEffectiveTheme();
      console.log("useEffect newEffectiveTheme:", newEffectiveTheme);
      setEffectiveTheme(newEffectiveTheme);

      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(newEffectiveTheme);
      }
    }
  }, [theme]);

  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => setEffectiveTheme(getSystemTheme());
      
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setNextTheme(newTheme);
  };

  return {
    theme,
    effectiveTheme,
    setTheme,
    isDark: effectiveTheme === "dark",
    isLight: effectiveTheme === "light",
    isSystem: theme === "system",
  };
}
