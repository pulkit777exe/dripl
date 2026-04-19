const DEFAULT_FONT = '"Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", cursive';

const FONT_PREFERENCES: Record<string, string> = {
  handwritten: DEFAULT_FONT,
  sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, serif',
  mono: 'monospace',
};

export function getCanvasFontPreference(): string {
  if (typeof window === 'undefined') return DEFAULT_FONT;
  const stored = localStorage.getItem('dripl_canvas_font');
  const font = FONT_PREFERENCES[stored as string];
  return font || DEFAULT_FONT;
}

export function getDefaultFontFamily(): string {
  return getCanvasFontPreference();
}
