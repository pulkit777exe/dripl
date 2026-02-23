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
        sans: ["var(--font-caveat)", "Caveat", "cursive"],
        caveat: ["var(--font-caveat)", "Caveat", "cursive"],
      },
      colors: {
        border: "var(--color-border)",
        input: "var(--color-input)",
        ring: "var(--color-ring)",
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        primary: {
          DEFAULT: "var(--color-primary)",
          foreground: "var(--color-primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
          foreground: "var(--color-secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--color-destructive)",
          foreground: "var(--color-destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--color-muted)",
          foreground: "var(--color-muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--color-popover)",
          foreground: "var(--color-popover-foreground)",
        },
        card: {
          DEFAULT: "var(--color-card)",
          foreground: "var(--color-card-foreground)",
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
