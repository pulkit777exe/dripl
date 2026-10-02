import { describe, expect, it, vi } from 'vitest';
import type { InteractionState } from '@/hooks/canvas/useCanvasPointerEvents';
import {
  finalizeDragGesture,
  finalizeResizeGesture,
  finalizeRotateGesture,
} from '@/lib/canvas/gesture-teardown';

function armedInteraction(): InteractionState {
  return {
    panning: false,
    panStartClient: null,
    isSpacePressed: false,
    dragStartCanvasPos: { x: 0, y: 0 },
    dragInitialElements: new Map(),
    dragging: true,
    historyPushed: true,
    resizing: true,
    resizeHandle: 'se',
    resizeStartCanvasPos: { x: 0, y: 0 },
    resizeInitialEl: null,
    rotating: true,
    rotateInitialEl: null,
    touchPointers: new Map(),
    pinchStartDistance: 0,
    pinchStartMid: null,
    pinchStartZoom: 1,
    pinchStartPan: { x: 0, y: 0 },
    boundArrowsByShape: new Map([['a', new Set(['arrow-1'])]]),
    bindingIndexReady: true,
  };
}

function deps() {
  return {
    setIsActive: vi.fn(),
    setEditingElementId: vi.fn(),
    unlockElement: vi.fn(),
    unlockGestureElements: vi.fn(),
  };
}

describe('finalizeResizeGesture', () => {
  it('resets flags, commits transient state, and releases every lock', () => {
    const interaction = armedInteraction();
    const options = {
      ...deps(),
      editingId: 'editor-1',
      resizedId: 'shape-1',
      clearHoverBinding: vi.fn(),
      commitTransient: vi.fn(),
    };
    finalizeResizeGesture(interaction, options);

    expect(interaction.resizing).toBe(false);
    expect(interaction.resizeHandle).toBeNull();
    expect(interaction.resizeInitialEl).toBeNull();
    expect(interaction.boundArrowsByShape.size).toBe(0);
    expect(interaction.bindingIndexReady).toBe(false);
    expect(interaction.historyPushed).toBe(false);
    expect(options.clearHoverBinding).toHaveBeenCalled();
    expect(options.setIsActive).toHaveBeenCalledWith(false);
    expect(options.commitTransient).toHaveBeenCalledWith('shape-1', {});
    expect(options.setEditingElementId).toHaveBeenCalledWith(null);
    expect(options.unlockElement).toHaveBeenCalledWith('editor-1');
    expect(options.unlockGestureElements).toHaveBeenCalled();
  });

  it('skips the commit when nothing was resized', () => {
    const options = {
      ...deps(),
      editingId: null,
      resizedId: undefined,
      clearHoverBinding: vi.fn(),
      commitTransient: vi.fn(),
    };
    finalizeResizeGesture(armedInteraction(), options);
    expect(options.commitTransient).not.toHaveBeenCalled();
    expect(options.unlockElement).not.toHaveBeenCalled();
    expect(options.unlockGestureElements).toHaveBeenCalled();
  });
});

describe('finalizeRotateGesture', () => {
  it('resets flags and releases locks', () => {
    const interaction = armedInteraction();
    const options = { ...deps(), editingId: 'editor-2' };
    finalizeRotateGesture(interaction, options);
    expect(interaction.rotating).toBe(false);
    expect(interaction.rotateInitialEl).toBeNull();
    expect(interaction.historyPushed).toBe(false);
    expect(options.setIsActive).toHaveBeenCalledWith(false);
    expect(options.unlockElement).toHaveBeenCalledWith('editor-2');
    expect(options.unlockGestureElements).toHaveBeenCalled();
  });
});

describe('finalizeDragGesture', () => {
  it('resets flags and releases locks without a commit', () => {
    const interaction = armedInteraction();
    const options = { ...deps(), editingId: null };
    finalizeDragGesture(interaction, options);
    expect(interaction.dragging).toBe(false);
    expect(interaction.dragStartCanvasPos).toBeNull();
    expect(interaction.dragInitialElements).toBeNull();
    expect(options.setIsActive).toHaveBeenCalledWith(false);
    expect(options.setEditingElementId).toHaveBeenCalledWith(null);
    expect(options.unlockGestureElements).toHaveBeenCalled();
  });
});
