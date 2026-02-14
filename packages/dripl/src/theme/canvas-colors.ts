import { useThemeColors, ColorPalette } from "./index";

export interface CanvasColors extends ColorPalette {
    gridLines: string;
  selectionBox: string;
  selectionBoxFill: string;
  remoteCursor: string;
  remoteCursorLabel: string;
  bindingHighlight: string;
  snapPoint: string;
  snapLine: string;
  hoverStroke: string;
  hoverFill: string;
}

export function getCanvasColors(colors: ColorPalette): CanvasColors {
  return {
    ...colors,
      gridLines: colors.canvasGrid,
    
      selectionBox: colors.selectionStroke,
    selectionBoxFill: colors.selectionFill,
    
      remoteCursor: colors.uiAccent,
    remoteCursorLabel: colors.textPrimary,
    
      bindingHighlight: colors.uiAccent,
    snapPoint: colors.uiAccent,
    snapLine: colors.uiAccent,
    
      hoverStroke: colors.elementStroke,
    hoverFill: "rgba(0, 0, 0, 0.05)",
  };
}

export function useCanvasColors(): CanvasColors {
  const colors = useThemeColors();
  return getCanvasColors(colors);
}

export function getUniversalStrokeColor(isDark: boolean): string {
  return isDark ? "#e0e0e0" : "#1e1e1e";
}

export function getReadableTextColor(backgroundColor: string, isDark: boolean): string {
    if (backgroundColor === "transparent") {
    return isDark ? "#e0e0e0" : "#1e1e1e";
  }
  
    const hex = backgroundColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
    return luminance > 0.5 ? "#1e1e1e" : "#ffffff";
}

export default {
  useCanvasColors,
  getCanvasColors,
  getUniversalStrokeColor,
  getReadableTextColor,
};