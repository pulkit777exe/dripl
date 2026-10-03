import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useCanvasClipboard } from '@/hooks/canvas/useCanvasClipboard';
import * as imageTools from '@/utils/tools/image';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x = 0, y = 0, extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    fractionalIndex: 'a0',
    ...extra,
  } as DriplElement;
}

function seed(elements: DriplElement[] = [], selectedIds: string[] = []) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
  useCanvasStore.getState().setSelectedIds(new Set(selectedIds));
}

const uploadSpy = vi.spyOn(imageTools, 'uploadImageToServer');
const loadSpy = vi.spyOn(imageTools, 'loadImage');

beforeEach(() => {
  uploadSpy.mockReset();
  loadSpy.mockReset();
});

afterEach(() => {
  uploadSpy.mockReset();
  loadSpy.mockReset();
});

describe('useCanvasClipboard.duplicateSelection', () => {
  beforeEach(() => {
    seed();
  });

  it('copies the selection offset by 10px with fresh ids and selects the copies', () => {
    seed([rect('a', 100, 200), rect('b', 400, 500)], ['a', 'b']);
    const { result } = renderHook(() => useCanvasClipboard());

    act(() => {
      result.current.duplicateSelection();
    });

    const elements = useCanvasStore.getState().elements;
    expect(elements).toHaveLength(4);

    const originals = elements.filter(el => el.id === 'a' || el.id === 'b');
    expect(originals.map(el => [el.x, el.y])).toEqual([
      [100, 200],
      [400, 500],
    ]);

    // The copies are matched by position rather than by scene order: z-order is
    // decided by fractional index, not by the order they were handed over.
    const copies = elements.filter(el => el.id !== 'a' && el.id !== 'b');
    expect(copies).toHaveLength(2);
    expect(copies.map(el => [el.x, el.y]).sort((l, r) => l[0]! - r[0]!)).toEqual([
      [110, 210],
      [410, 510],
    ] as Array<[number, number]>);
    expect(new Set(copies.map(el => el.id)).size).toBe(2);
    expect(Array.from(useCanvasStore.getState().selectedIds).sort()).toEqual(
      copies.map(el => el.id).sort()
    );
  });

  it('does nothing without a selection', () => {
    seed([rect('a')], []);
    const before = useCanvasStore.getState().elements;
    const { result } = renderHook(() => useCanvasClipboard());

    act(() => {
      result.current.duplicateSelection();
    });
    expect(useCanvasStore.getState().elements).toBe(before);
  });

  it('places the copy above the originals in z-order', () => {
    seed([rect('a', 0), rect('b', 300)], ['a']);
    const { result } = renderHook(() => useCanvasClipboard());

    act(() => {
      result.current.duplicateSelection();
    });

    const elements = useCanvasStore.getState().elements;
    const copy = elements.at(-1)!;
    expect(copy.fractionalIndex).toBeDefined();
    expect(copy.fractionalIndex! > 'a0').toBe(true);
  });

  it('undoes the whole duplication in one step', () => {
    seed([rect('a', 0)], ['a']);
    const { result } = renderHook(() => useCanvasClipboard());

    act(() => {
      result.current.duplicateSelection();
    });
    expect(useCanvasStore.getState().elements).toHaveLength(2);

    act(() => {
      useCanvasStore.getState().undo();
    });
    expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(['a']);
  });
});

describe('useCanvasClipboard.copySelectedToClipboard', () => {
  beforeEach(() => {
    seed();
  });

  it('writes the selected elements as JSON', async () => {
    seed([rect('a', 0), rect('b', 300)], ['a']);
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.copySelectedToClipboard();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeText.mock.calls[0]![0]) as DriplElement[];
    expect(payload.map(el => el.id)).toEqual(['a']);
  });

  it('swallows a denied clipboard permission', async () => {
    seed([rect('a', 0)], ['a']);
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await expect(result.current.copySelectedToClipboard()).resolves.toBeUndefined();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('does not touch the clipboard without a selection', async () => {
    seed([rect('a', 0)], []);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.copySelectedToClipboard();
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('useCanvasClipboard.pasteFromClipboard', () => {
  beforeEach(() => {
    seed();
  });

  function stubRead(items: unknown[]) {
    const read = vi.fn(async () => items);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read },
    });
    return read;
  }

  it('duplicates the current selection instead of reading the system clipboard', async () => {
    seed([rect('a', 10, 20)], ['a']);
    const read = stubRead([]);
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.pasteFromClipboard();
    });

    expect(read).not.toHaveBeenCalled();
    const elements = useCanvasStore.getState().elements;
    expect(elements).toHaveLength(2);
    expect(elements.at(-1)).toMatchObject({ x: 20, y: 30 });
  });

  it('uploads a pasted image and centres it on the canvas', async () => {
    seed();
    uploadSpy.mockResolvedValue('https://cdn.example/paste.png');
    loadSpy.mockResolvedValue({
      src: 'https://cdn.example/paste.png',
      naturalWidth: 120,
      naturalHeight: 60,
      displayWidth: 120,
      displayHeight: 60,
    });
    stubRead([
      {
        types: ['image/png'],
        getType: async () => new Blob(['x'], { type: 'image/png' }),
      },
    ]);
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.pasteFromClipboard();
    });

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    const created = useCanvasStore.getState().elements[0]!;
    expect(created).toMatchObject({
      type: 'image',
      src: 'https://cdn.example/paste.png',
      x: 0,
      y: 0,
      width: 120,
      height: 60,
    });
  });

  it('recreates elements from pasted JSON text, offset by 10px', async () => {
    seed();
    const source = [rect('a', 5, 6, { fractionalIndex: undefined })];
    stubRead([
      {
        types: ['text/plain'],
        // jsdom's Blob has no .text(), so hand back the shape the hook reads.
        getType: async () => ({ text: async () => JSON.stringify(source) }) as unknown as Blob,
      },
    ]);
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.pasteFromClipboard();
    });

    const created = useCanvasStore.getState().elements[0]!;
    expect(created).toMatchObject({ type: 'rectangle', x: 15, y: 16 });
    expect(created.id).not.toBe('a');
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual([created.id]);
  });

  it('ignores unparseable clipboard text without throwing', async () => {
    seed();
    stubRead([
      {
        types: ['text/plain'],
        getType: async () => ({ text: async () => 'just some prose' }) as unknown as Blob,
      },
    ]);
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.pasteFromClipboard();
    });
    expect(useCanvasStore.getState().elements).toHaveLength(0);
  });

  it('ignores an empty JSON array', async () => {
    seed();
    stubRead([
      {
        types: ['text/plain'],
        getType: async () => ({ text: async () => '[]' }) as unknown as Blob,
      },
    ]);
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await result.current.pasteFromClipboard();
    });
    expect(useCanvasStore.getState().elements).toHaveLength(0);
  });

  it('swallows a denied clipboard read', async () => {
    seed();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    const { result } = renderHook(() => useCanvasClipboard());

    await act(async () => {
      await expect(result.current.pasteFromClipboard()).resolves.toBeUndefined();
    });
    expect(useCanvasStore.getState().elements).toHaveLength(0);
  });
});

describe('useCanvasClipboard.findOnCanvas', () => {
  beforeEach(() => {
    seed();
  });

  it('selects and counts text matches case-insensitively', () => {
    seed(
      [
        rect('a', 0, 0, { text: 'Budget Plan' }),
        rect('b', 300, 0, { text: 'roadmap' }),
        rect('c', 600, 0),
      ] as DriplElement[],
      []
    );
    const { result } = renderHook(() => useCanvasClipboard());

    let count = -1;
    act(() => {
      count = result.current.findOnCanvas('BUDGET');
    });

    expect(count).toBe(1);
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual(['a']);
  });

  it('matches a named element as well as its text', () => {
    seed(
      [
        rect('a', 0, 0, { name: 'Kanban Board' }),
        rect('b', 300, 0, { text: 'other' }),
      ] as DriplElement[],
      []
    );
    const { result } = renderHook(() => useCanvasClipboard());

    let count = -1;
    act(() => {
      count = result.current.findOnCanvas('kanban');
    });

    expect(count).toBe(1);
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual(['a']);
  });

  it('selects every match', () => {
    seed(
      [
        rect('a', 0, 0, { text: 'alpha' }),
        rect('b', 300, 0, { text: 'beta alpha' }),
      ] as DriplElement[],
      []
    );
    const { result } = renderHook(() => useCanvasClipboard());

    let count = -1;
    act(() => {
      count = result.current.findOnCanvas('alpha');
    });
    expect(count).toBe(2);
    expect(useCanvasStore.getState().selectedIds.size).toBe(2);
  });

  it('leaves the existing selection alone when nothing matches', () => {
    seed([rect('a', 0, 0, { text: 'alpha' })], ['a']);
    const { result } = renderHook(() => useCanvasClipboard());

    let count = -1;
    act(() => {
      count = result.current.findOnCanvas('nothing here');
    });

    expect(count).toBe(0);
    expect(Array.from(useCanvasStore.getState().selectedIds)).toEqual(['a']);
  });
});
