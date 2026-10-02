import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  buildDocumentExportOptions,
  buildRasterExportOptions,
  exportFileName,
  parseExportDimensions,
  resolveExportScope,
} from '@/lib/export-options';

const el = (id: string): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
  }) as DriplElement;

describe('parseExportDimensions', () => {
  it('returns unset dims when custom size is off or blank', () => {
    expect(parseExportDimensions(false, '800', '600')).toEqual({
      width: undefined,
      height: undefined,
    });
    expect(parseExportDimensions(true, '', '')).toEqual({ width: undefined, height: undefined });
  });

  it('parses integer dimensions', () => {
    expect(parseExportDimensions(true, '800', '600')).toEqual({ width: 800, height: 600 });
  });
});

describe('resolveExportScope', () => {
  const scene = [el('a'), el('b')];

  it('returns the full scene by default', () => {
    expect(resolveExportScope(scene, new Set(['a']), false)).toBe(scene);
  });

  it('filters to the selection when requested and non-empty', () => {
    expect(resolveExportScope(scene, new Set(['a']), true)).toEqual([scene[0]]);
  });

  it('falls back to the full scene when the selection is empty', () => {
    expect(resolveExportScope(scene, new Set(), true)).toBe(scene);
  });
});

describe('buildRasterExportOptions', () => {
  it('uses a fixed scale with optional custom size', () => {
    expect(buildRasterExportOptions({})).toMatchObject({ scale: 2, background: '#ffffff' });
    expect(buildRasterExportOptions({ width: 800, height: 600 })).toMatchObject({
      scale: 2,
      customWidth: 800,
      customHeight: 600,
    });
  });

  it('honors a background override', () => {
    expect(buildRasterExportOptions({}, '#000000').background).toBe('#000000');
  });
});

describe('buildDocumentExportOptions', () => {
  it('keeps the requested scale without custom dims', () => {
    const out = buildDocumentExportOptions(3, {}, { zoom: 1 });
    expect(out.scale).toBe(3);
    expect(out).not.toHaveProperty('customWidth');
  });

  it('reinterpret scale against the 1920px reference with custom dims', () => {
    const out = buildDocumentExportOptions(2, { width: 960, height: 540 }, undefined);
    expect(out.scale).toBe(0.5);
    expect(out.customWidth).toBe(960);
  });

  it('honors a background override', () => {
    expect(buildDocumentExportOptions(2, {}, undefined, '#123456').background).toBe('#123456');
  });
});

describe('exportFileName', () => {
  it('builds timestamped filenames with known extensions', () => {
    expect(exportFileName('png', 123)).toBe('canvas-123.png');
    expect(exportFileName('excalidraw', 123)).toBe('canvas-123.excalidraw');
    expect(exportFileName('pdf', 123)).toBe('canvas-123.pdf');
  });
});
