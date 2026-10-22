import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_COLORS,
  COLOR_PALETTE,
  DEFAULT_CANVAS_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
  STROKE_COLORS,
} from '@/lib/canvas/colors';

describe('Excalidraw palette structure', () => {
  it('pins the five element stroke quick picks in Excalidraw order', () => {
    expect(DEFAULT_ELEMENT_STROKE_PICKS).toEqual([
      '#1e1e1e',
      '#e03131',
      '#2f9e44',
      '#1971c2',
      '#f08c00',
    ]);
  });

  it('pins the five element fill quick picks in Excalidraw order', () => {
    expect(DEFAULT_ELEMENT_BACKGROUND_PICKS).toEqual([
      'transparent',
      '#ffc9c9',
      '#b2f2bb',
      '#a5d8ff',
      '#ffec99',
    ]);
  });

  it('pins the five canvas quick picks in Excalidraw order', () => {
    expect(DEFAULT_CANVAS_BACKGROUND_PICKS).toEqual([
      '#ffffff',
      '#f8f9fa',
      '#f5faff',
      '#fffce8',
      '#fdf8f6',
    ]);
  });

  it('only exposes swatches drawn from the palette', () => {
    const palette = new Set<string>(
      Object.values(COLOR_PALETTE).flatMap(value =>
        typeof value === 'string' ? [value] : [...value]
      )
    );
    for (const swatch of [...STROKE_COLORS, ...BACKGROUND_COLORS]) {
      expect(palette.has(swatch.value)).toBe(true);
    }
  });

  it('keeps the quick-pick prefixes identical to the panel swatches', () => {
    expect(STROKE_COLORS.slice(0, 5).map(c => c.value)).toEqual([...DEFAULT_ELEMENT_STROKE_PICKS]);
    expect(BACKGROUND_COLORS.slice(0, 5).map(c => c.value)).toEqual([
      ...DEFAULT_ELEMENT_BACKGROUND_PICKS,
    ]);
  });
});
