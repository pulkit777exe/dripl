import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { applyDarkModeFilter } from './theme';
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

  it('swaps the achromatic extremes in the dark theme', () => {
    expect(applyDarkModeFilter('#1e1e1e', 'dark')).toBe('#e9ecef');
    expect(applyDarkModeFilter('#000000', 'dark')).toBe('#e9ecef');
    expect(applyDarkModeFilter('#ffffff', 'dark')).toBe('#1e1e1e');
    expect(applyDarkModeFilter('white', 'dark')).toBe('#1e1e1e');
  });

  it('matches case-insensitively', () => {
    expect(applyDarkModeFilter('#1E1E1E', 'dark')).toBe('#e9ecef');
    expect(applyDarkModeFilter('White', 'dark')).toBe('#1e1e1e');
  });

  it('leaves chromatic colors and transparency alone in the dark theme', () => {
    for (const color of ['#e8462a', '#1971c2', 'transparent', undefined]) {
      expect(applyDarkModeFilter(color, 'dark')).toBe(color);
    }
  });
});

describe('rough options dark-mode remap', () => {
  it('remaps the default near-black stroke and fill in dark bitmaps', () => {
    const options = getRoughOptionsForElement(
      el({ strokeColor: '#1e1e1e', backgroundColor: '#ffffff' }),
      'dark'
    );
    expect(options.stroke).toBe('#e9ecef');
    expect(options.fill).toBe('#1e1e1e');
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
