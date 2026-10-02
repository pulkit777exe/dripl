import { beforeEach, describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';

import {
  loadLocalCanvasFromStorage,
  saveLocalCanvasToStorage,
  type LocalCanvasState,
} from '@/utils/localCanvasStorage';
import { MAX_PERSISTED_ELEMENTS } from '@/lib/canvas-db';

function element(id: string, extraText = ''): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...(extraText ? ({ label: extraText } as Record<string, unknown>) : {}),
  } as DriplElement;
}

const state: LocalCanvasState = {
  theme: 'light',
  zoom: 1,
  panX: 0,
  panY: 0,
  currentStrokeColor: '#1e1e1e',
  currentBackgroundColor: 'transparent',
  currentStrokeWidth: 2,
  currentRoughness: 1,
  currentStrokeStyle: 'solid',
  currentFillStyle: 'hachure',
  activeTool: 'select',
};

describe('local canvas persistence limits', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a scene well past the old 5,000 element cap', () => {
    // This is the regression the cap caused: a 6,000 element scene used to be
    // silently truncated on save and on load.
    const elements = Array.from({ length: 6_000 }, (_, index) => element(`e${index}`));
    const result = saveLocalCanvasToStorage(elements, state);
    expect(result.ok).toBe(true);

    const loaded = loadLocalCanvasFromStorage();
    expect(loaded.elements).toHaveLength(6_000);
    expect(loaded.elementsTruncated).toBeUndefined();
  });

  it('keeps more than 5,000 elements when they are small', () => {
    const elements = Array.from({ length: 12_000 }, (_, index) => element(`s${index}`));
    const result = saveLocalCanvasToStorage(elements, state);
    // Whether the whole scene fits the byte budget depends on the payload; what
    // must never happen is silent truncation reported as success.
    if (result.ok) {
      expect(loadLocalCanvasFromStorage().elements).toHaveLength(12_000);
    } else {
      const loaded = loadLocalCanvasFromStorage();
      expect(loaded.elementsTruncated).toBe(true);
      expect(loaded.totalElements).toBe(12_000);
      expect(loaded.elements!.length).toBeLessThan(12_000);
    }
  });

  it('flags a truncated payload instead of passing it off as complete', () => {
    // Force truncation with elements far larger than the byte budget.
    const big = 'x'.repeat(4_000);
    const elements = Array.from({ length: 4_000 }, (_, index) => element(`b${index}`, big));
    const result = saveLocalCanvasToStorage(elements, state);
    expect(result.ok).toBe(false);

    const loaded = loadLocalCanvasFromStorage();
    expect(loaded.elementsTruncated).toBe(true);
    expect(loaded.totalElements).toBe(4_000);
    expect(loaded.elements!.length).toBeGreaterThan(0);
    expect(loaded.elements!.length).toBeLessThan(4_000);
  });

  it('never reports success while storing fewer elements than given', () => {
    // A single element far larger than any storage quota. The invariant is not
    // "it saves" but "success implies completeness": it either stores the whole
    // scene or reports failure.
    const huge = 'y'.repeat(5_000_000);
    const result = saveLocalCanvasToStorage([element('only', huge)], state);
    const loaded = loadLocalCanvasFromStorage();

    if (result.ok) {
      expect(loaded.elements).toHaveLength(1);
      expect(loaded.elementsTruncated).toBeUndefined();
    } else {
      // Nothing partial may masquerade as a complete save.
      expect(loaded.elements).toBeNull();
    }
  });

  it('exposes a local persistence ceiling well above the measurement targets', () => {
    // 10k and 20k scenes must be persistable for the performance harness to be
    // able to exercise them.
    expect(MAX_PERSISTED_ELEMENTS).toBeGreaterThanOrEqual(20_000);
  });
});
