export interface ColorPalette {
  canvasBackground: string;
  canvasGrid: string;
  
  elementStroke: string;
  elementBackground: string;
  
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  
  uiBackground: string;
  uiForeground: string;
  uiBorder: string;
  uiAccent: string;
  uiAccentHover: string;
  
  selectionFill: string;
  selectionStroke: string;
  
  toolActive: string;
  toolHover: string;
  
  success: string;
  warning: string;
  error: string;
  info: string;
}

export const lightColors: ColorPalette = {
  canvasBackground: "#ffffff",
  canvasGrid: "#e0e0e0",
  
  elementStroke: "#1e1e1e",
  elementBackground: "transparent",
  
  textPrimary: "#1e1e1e",
  textSecondary: "#6b6b6b",
  textMuted: "#8c8c8c",
  
  uiBackground: "#ffffff",
  uiForeground: "#1e1e1e",
  uiBorder: "#e0e0e0",
  uiAccent: "#1e1e1e",
  uiAccentHover: "#363636",
  
  selectionFill: "rgba(66, 133, 244, 0.15)",
  selectionStroke: "#4285f4",
  
  toolActive: "#4285f4",
  toolHover: "#f0f0f0",
  
  success: "#2e7d32",
  warning: "#f57c00",
  error: "#c62828",
  info: "#1976d2",
};

export const darkColors: ColorPalette = {
  canvasBackground: "#1e1e1e",
  canvasGrid: "#2a2a2a",
  
  elementStroke: "#e0e0e0",
  elementBackground: "transparent",
  
  textPrimary: "#e0e0e0",
  textSecondary: "#a0a0a0",
  textMuted: "#6b6b6b",
  
  uiBackground: "#2a2a2a",
  uiForeground: "#e0e0e0",
  uiBorder: "#3a3a3a",
  uiAccent: "#4285f4",
  uiAccentHover: "#5a9cf5",
  
  selectionFill: "rgba(66, 133, 244, 0.25)",
  selectionStroke: "#4285f4",
  
  toolActive: "#4285f4",
  toolHover: "#3a3a3a",
  
  success: "#4caf50",
  warning: "#ffb74d",
  error: "#ef5350",
  info: "#42a5f5",
};

export const strokeColors = {
  black: "#1e1e1e",
  white: "#ffffff",
  red: "#e03131",
  orange: "#f76707",
  yellow: "#f59f00",
  green: "#2f9e44",
  cyan: "#0c8599",
  blue: "#1971c2",
  purple: "#862e9c",
  pink: "#c2255c",
  
  gray: "#495057",
  lightGray: "#adb5bd",
} as const;

export const backgroundColors = {
  transparent: "transparent",
  white: "#ffffff",
  lightGray: "#f1f3f5",
  red: "#ffe3e3",
  orange: "#fff4e6",
  yellow: "#fff9db",
  green: "#d3f9d8",
  cyan: "#c5f6fa",
  blue: "#d0ebff",
  purple: "#eebefa",
  pink: "#fcc2d7",
} as const;

export function getColorPalette(theme: "light" | "dark"): ColorPalette {
  return theme === "dark" ? darkColors : lightColors;
}

export function getContrastingTextColor(backgroundColor: string): string {
  if (backgroundColor === "transparent") {
    return lightColors.textPrimary;
  }
  
  const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5 ? "#1e1e1e" : "#ffffff";
}

export type Theme = "light" | "dark";