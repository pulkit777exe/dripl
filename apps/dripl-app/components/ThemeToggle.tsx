"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="p-2 rounded-lg bg-card border border-border">
        <div className="w-4 h-4" />
      </button>
    );
  }

  const toggleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
    } else if (theme === "dark") {
      setTheme("system");
    } else {
      setTheme("light");
    }
  };

  const getThemeIcon = () => {
    if (theme === "dark") {
      return <Sun className="w-4 h-4" />;
    } else if (theme === "light") {
      return <Moon className="w-4 h-4" />;
    } else {
      return <Monitor className="w-4 h-4" />;
    }
  };

  const getThemeLabel = () => {
    if (theme === "dark") {
      return "Switch to light mode";
    } else if (theme === "light") {
      return "Switch to dark mode";
    } else {
      return "Switch to system mode";
    }
  };

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "p-2 rounded-lg transition-all duration-200",
        "bg-card hover:bg-accent border border-border",
        "text-foreground hover:text-accent-foreground",
      )}
      title={getThemeLabel()}
    >
      {getThemeIcon()}
    </button>
  );
}
