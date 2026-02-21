import type { Config } from "tailwindcss";

const config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        serif: ["var(--font-instrument-serif)", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        "toolbar-bg": "var(--color-toolbar-bg)",
        "toolbar-border": "var(--color-toolbar-border)",
        "toolbar-divider": "var(--color-toolbar-divider)",
        "tool-active-bg": "var(--color-tool-active-bg)",
        "tool-active-text": "var(--color-tool-active-text)",
        "tool-inactive-text": "var(--color-tool-inactive-text)",
        "tool-hover-bg": "var(--color-tool-hover-bg)",
        "tool-hover-text": "var(--color-tool-hover-text)",
        "tool-active-shadow": "var(--color-tool-active-shadow)",

        "panel-bg": "var(--color-panel-bg)",
        "panel-border": "var(--color-panel-border)",
        "panel-btn-bg": "var(--color-panel-btn-bg)",
        "panel-btn-hover": "var(--color-panel-btn-hover)",
        "panel-btn-active": "var(--color-panel-btn-active)",
        "panel-label": "var(--color-panel-label)",
        "panel-text": "var(--color-panel-text)",
        "panel-divider": "var(--color-panel-divider)",
        "panel-slider": "var(--color-panel-slider)",
        "panel-menu-active": "var(--color-panel-menu-active)",

        "canvas-bg": "var(--color-canvas-bg)",
        "hint-bg": "var(--color-hint-bg)",
        "hint-text": "var(--color-hint-text)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(to right, hsl(var(--border) / 0.4) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.4) 1px, transparent 1px)",
      },
      boxShadow: {
        "attio-sm":
          "0px 1px 2px rgba(0, 0, 0, 0.04), 0px 1px 1px rgba(0, 0, 0, 0.02)",
        "attio-md":
          "0px 4px 8px rgba(0, 0, 0, 0.04), 0px 2px 4px rgba(0, 0, 0, 0.02), 0 0 0 1px rgba(0,0,0,0.04)",
        "attio-lg":
          "0px 12px 24px rgba(0, 0, 0, 0.06), 0px 4px 8px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0,0,0,0.04)",
      },
    },
  },
} as Config;

export default config;
