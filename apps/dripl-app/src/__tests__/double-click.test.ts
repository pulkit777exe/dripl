import { describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { handleDoubleClick, type DoubleClickDeps } from '@/lib/canvas/double-click';

function stubDeps(hit: DriplElement | null, overrides: Partial<DoubleClickDeps> = {}) {
  const setTextInput = vi.fn();
  const addElement = vi.fn();
  const updateElement = vi.fn();
  const deps: DoubleClickDeps = {
    getElementAtPosition: () => hit,
    setTextInput,
    addElement,
    updateElement,
    ...overrides,
  };
  return { deps, setTextInput, addElement, updateElement };
}

const text = {
  id: 'text-1',
  type: 'text',
  x: 10,
  y: 20,
  width: 60,
  height: 24,
  text: 'hello',
  fontSize: 20,
  fontFamily: 'Virgil',
} as unknown as DriplElement;

const arrow = {
  id: 'arrow-1',
  type: 'arrow',
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  points: [
    { x: 0, y: 20 },
    { x: 100, y: 20 },
  ],
} as unknown as DriplElement;

describe('handleDoubleClick', () => {
  it('opens the text editor in place', () => {
    const { deps, setTextInput, addElement } = stubDeps(text);
    expect(handleDoubleClick({ x: 15, y: 25 }, [text], deps)).toBe(true);
    expect(setTextInput).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20, existingElementId: 'text-1', value: 'hello' })
    );
    expect(addElement).not.toHaveBeenCalled();
  });

  it('creates a label for an unlabeled arrow and opens the editor', () => {
    const { deps, setTextInput, addElement, updateElement } = stubDeps(arrow);
    expect(handleDoubleClick({ x: 50, y: 20 }, [arrow], deps)).toBe(true);
    expect(addElement).toHaveBeenCalledTimes(1);
    const label = addElement.mock.calls[0]![0] as DriplElement;
    expect(label.type).toBe('text');
    expect(updateElement).toHaveBeenCalledWith(
      'arrow-1',
      expect.objectContaining({ labelId: label.id })
    );
    expect(setTextInput).toHaveBeenCalledWith(
      expect.objectContaining({ existingElementId: label.id, value: '' })
    );
  });

  it('opens the existing label instead of duplicating it', () => {
    const label = { ...text, id: 'label-9' } as unknown as DriplElement;
    const labeled = { ...arrow, labelId: 'label-9' } as unknown as DriplElement;
    const { deps, setTextInput, addElement } = stubDeps(labeled);
    expect(handleDoubleClick({ x: 50, y: 20 }, [labeled, label], deps)).toBe(true);
    expect(addElement).not.toHaveBeenCalled();
    expect(setTextInput).toHaveBeenCalledWith(
      expect.objectContaining({ existingElementId: 'label-9', value: 'hello' })
    );
  });

  it('falls through for misses and other types', () => {
    const rect = { ...text, id: 'r1', type: 'rectangle' } as unknown as DriplElement;
    expect(handleDoubleClick({ x: 0, y: 0 }, [], stubDeps(null).deps)).toBe(false);
    const { deps, setTextInput } = stubDeps(rect);
    expect(handleDoubleClick({ x: 0, y: 0 }, [rect], deps)).toBe(false);
    expect(setTextInput).not.toHaveBeenCalled();
  });
});
