import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';
import {
  projectStyleForElement,
  snapshotStyleFromElement,
  type CurrentStyleInput,
} from '@/lib/canvas/style-transfer';

const fallback: CurrentStyleInput = {
  currentStrokeColor: '#111111',
  currentBackgroundColor: '#222222',
  currentStrokeWidth: 2,
  currentStrokeStyle: 'solid',
  currentRoughness: 1,
  currentFillStyle: 'hachure',
};

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

describe('snapshotStyleFromElement', () => {
  it('reads the element style with fallbacks', () => {
    const snap = snapshotStyleFromElement(
      rect('a', { strokeColor: '#ff0000', strokeWidth: 5, opacity: 0.5 }),
      fallback
    );
    expect(snap).toMatchObject({
      strokeColor: '#ff0000',
      strokeWidth: 5,
      opacity: 0.5,
      backgroundColor: '#222222',
    });
    expect(snap.fontFamily).toBeUndefined();
  });

  it('prefers fillColor over backgroundColor and captures text fonts', () => {
    const text = {
      ...rect('t', { fillColor: '#00ff00', fontFamily: 'Virgil', fontSize: 28 }),
      type: 'text',
    } as DriplElement;
    const snap = snapshotStyleFromElement(text, fallback);
    expect(snap.backgroundColor).toBe('#00ff00');
    expect(snap.fontFamily).toBe('Virgil');
    expect(snap.fontSize).toBe(28);
  });
});

describe('projectStyleForElement', () => {
  const snapshot = snapshotStyleFromElement(
    { ...rect('t'), type: 'text', fontFamily: 'Virgil', fontSize: 28 } as DriplElement,
    fallback
  );

  it('keeps fonts off non-text targets', () => {
    const projected = projectStyleForElement(snapshot, rect('r'));
    expect(projected).not.toHaveProperty('fontFamily');
    expect(projected).not.toHaveProperty('fontSize');
    expect(projected.strokeColor).toBe(snapshot.strokeColor);
  });

  it('carries fonts onto text targets', () => {
    const projected = projectStyleForElement(snapshot, {
      ...rect('t'),
      type: 'text',
    } as DriplElement);
    expect(projected.fontFamily).toBe('Virgil');
    expect(projected.fontSize).toBe(28);
  });
});

describe('applyStyleToElements', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      elements: [],
      elementsById: new Map(),
      selectedIds: new Set(),
      past: [],
      future: [],
      spatialVersion: 0,
      spatialChangedIds: [],
      spatialChangedIdsVersion: 0,
    });
    useCanvasStore.getState().setElements([rect('a', { strokeColor: '#000000' })], {
      skipHistory: true,
    });
  });

  it('applies a snapshot in one history entry and skips locked elements', () => {
    useCanvasStore
      .getState()
      .setElements(
        [
          rect('a', { strokeColor: '#000000' }),
          rect('b', { strokeColor: '#000000', locked: true }),
        ],
        { skipHistory: true }
      );
    const snapshot = snapshotStyleFromElement(rect('src', { strokeColor: '#ff0000' }), fallback);
    useCanvasStore.getState().applyStyleToElements(['a', 'b'], snapshot);
    const after = useCanvasStore.getState();
    expect(after.elementsById.get('a')?.strokeColor).toBe('#ff0000');
    expect(after.elementsById.get('b')?.strokeColor).toBe('#000000');
    expect(after.past).toHaveLength(1);
  });

  it('is a no-op for unknown ids and empty selections', () => {
    const snapshot = snapshotStyleFromElement(rect('src', { strokeColor: '#ff0000' }), fallback);
    useCanvasStore.getState().applyStyleToElements(['missing'], snapshot);
    useCanvasStore.getState().applyStyleToElements([], snapshot);
    const after = useCanvasStore.getState();
    expect(after.elementsById.get('a')?.strokeColor).toBe('#000000');
    expect(after.past).toHaveLength(0);
  });
});
