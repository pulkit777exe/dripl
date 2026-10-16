/**
 * Canvas font resolution — single home for the family fallback both render
 * layers share. The static bitmap renderer used bare `'Caveat'` while the
 * interactive draft renderer used `'"Caveat", cursive'`: identical while the
 * webfont is loaded, different fallback glyphs (and metrics) before it
 * arrives or when it fails, so text reflowed on commit.
 */

export const HANDWRITING_FONT_FALLBACK = '"Caveat", cursive';

export function canvasFontFamily(family: unknown): string {
  return typeof family === 'string' && family ? family : HANDWRITING_FONT_FALLBACK;
}

export function canvasFont(size: number, family: unknown): string {
  return `${size}px ${canvasFontFamily(family)}`;
}
