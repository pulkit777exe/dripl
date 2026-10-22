import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  applyDarkModeFilter,
  isColorDark,
  needsSwatchOutline,
  removeDarkModeFilter,
} from './theme';
import { getRoughOptionsForElement } from './rough-renderer';

function el(overrides: Record<string, unknown> = {}): DriplElement {
  return {
    id: 'e',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 0,
    ...overrides,
  } as unknown as DriplElement;
}

describe('applyDarkModeFilter', () => {
  it('is the identity in the light theme', () => {
    for (const color of ['#1e1e1e', '#ffffff', '#e8462a', 'transparent', undefined]) {
      expect(applyDarkModeFilter(color, 'light')).toBe(color);
    }
  });

  it('applies Excalidraw invert(93%) hue-rotate(180deg)', () => {
    expect(applyDarkModeFilter('#000000', 'dark')).toBe('#ededed');
    expect(applyDarkModeFilter('#ffffff', 'dark')).toBe('#121212');
    expect(applyDarkModeFilter('#ff0000', 'dark')).toBe('#ff9090');
    expect(applyDarkModeFilter('#00ff00', 'dark')).toBe('#008f00');
    expect(applyDarkModeFilter('#0000ff', 'dark')).toBe('#cdcdff');
    expect(applyDarkModeFilter('#1e1e1e', 'dark')).toBe('#d3d3d3');
    expect(applyDarkModeFilter('#e8462a', 'dark')).toBe('#ff7961');
  });

  it('matches the stored spelling case-insensitively', () => {
    expect(applyDarkModeFilter('#1E1E1E', 'dark')).toBe('#d3d3d3');
    expect(applyDarkModeFilter('White', 'dark')).toBe('#121212');
    expect(applyDarkModeFilter('Black', 'dark')).toBe('#ededed');
  });

  it('preserves alpha while transforming the RGB channels', () => {
    expect(applyDarkModeFilter('rgba(255, 0, 0, 0.5)', 'dark')).toBe('#ff909080');
    expect(applyDarkModeFilter('#ff000080', 'dark')).toBe('#ff909080');
    expect(applyDarkModeFilter('rgb(255 0 0 / 50%)', 'dark')).toBe('#ff909080');
    expect(applyDarkModeFilter('hsl(0, 100%, 50%)', 'dark')).toBe('#ff9090');
    expect(applyDarkModeFilter('#ff000000', 'dark')).toBe('#ff909000');
  });

  it('leaves transparency, none, and invalid values alone', () => {
    expect(applyDarkModeFilter('transparent', 'dark')).toBe('#ededed00');
    for (const color of ['none', 'currentColor', 'not-a-color', '']) {
      expect(applyDarkModeFilter(color, 'dark')).toBe(color);
    }
    expect(applyDarkModeFilter(undefined, 'dark')).toBeUndefined();
  });
});

describe('removeDarkModeFilter', () => {
  it('round-trips the achromatic extremes exactly', () => {
    expect(removeDarkModeFilter(applyDarkModeFilter('#000000', 'dark'))).toBe('#000000');
    expect(removeDarkModeFilter(applyDarkModeFilter('#ffffff', 'dark'))).toBe('#ffffff');
    expect(removeDarkModeFilter(applyDarkModeFilter('#1e1e1e', 'dark'))).toBe('#1e1e1e');
  });

  it('recovers chromatic colors as far as clipping permits', () => {
    // Excalidraw's reverse filter is an approximation: the forward matrix
    // clips channels, so a saturated color cannot be recovered exactly.
    expect(removeDarkModeFilter(applyDarkModeFilter('#ff0000', 'dark'))).toBe('#b73636');
    expect(removeDarkModeFilter(applyDarkModeFilter('#00ff00', 'dark'))).toBe('#27cd27');
    expect(removeDarkModeFilter(applyDarkModeFilter('#0000ff', 'dark'))).toBe('#1d1d57');
  });

  it('preserves alpha while reversing', () => {
    expect(removeDarkModeFilter('#ff909080')).toBe('#b7363680');
  });
});

describe('isColorDark / needsSwatchOutline', () => {
  it('classifies swatches by perceived brightness', () => {
    expect(isColorDark('#000000')).toBe(true);
    expect(isColorDark('#ffffff')).toBe(false);
    expect(isColorDark('#ffc9c9')).toBe(false);
    expect(needsSwatchOutline('#ffffff')).toBe(true);
    expect(needsSwatchOutline('#1e1e1e')).toBe(false);
    expect(needsSwatchOutline('transparent')).toBe(false);
    expect(needsSwatchOutline('#ededed00')).toBe(false);
  });
});

describe('rough options dark-mode transform', () => {
  it('transforms the default stroke and fill in dark bitmaps', () => {
    const options = getRoughOptionsForElement(
      el({ strokeColor: '#1e1e1e', backgroundColor: '#ffffff' }),
      'dark'
    );
    expect(options.stroke).toBe('#d3d3d3');
    expect(options.fill).toBe('#121212');
  });

  it('transforms chromatic colors in dark bitmaps', () => {
    const options = getRoughOptionsForElement(
      el({ strokeColor: '#e8462a', backgroundColor: '#a5d8ff' }),
      'dark'
    );
    expect(options.stroke).toBe('#ff7961');
    expect(options.fill).toBe('#154162');
  });

  it('leaves light-theme options exactly as stored', () => {
    const options = getRoughOptionsForElement(
      el({ strokeColor: '#1e1e1e', backgroundColor: '#ffffff' }),
      'light'
    );
    expect(options.stroke).toBe('#1e1e1e');
    expect(options.fill).toBe('#ffffff');
  });
});
