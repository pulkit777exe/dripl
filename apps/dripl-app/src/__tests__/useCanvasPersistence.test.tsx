import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { useCanvasPersistence } from '@/hooks/canvas/useCanvasPersistence';
import { LOCAL_CANVAS_STORAGE_KEYS } from '@/utils/localCanvasStorage';
import type { DriplElement } from '@dripl/common';

const IDLE_DELAY = 2500;
const RETRY_DELAY = 2000;

function rect(id: string, x = 0): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function seed(elements: DriplElement[] = []) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    zoom: 2,
    panX: 30,
    panY: -40,
    activeTool: 'rectangle',
    currentStrokeColor: '#123456',
    canvasBackground: '#fefefe',
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function readSaved() {
  const raw = localStorage.getItem(LOCAL_CANVAS_STORAGE_KEYS.STRUCTURED);
  return raw ? (JSON.parse(raw) as Record<string, never>) : null;
}

interface Options {
  roomSlug?: string | null;
  readOnly?: boolean;
  theme?: 'light' | 'dark';
  isDrawingRef?: React.RefObject<boolean>;
}

function setup(options: Options = {}) {
  const isDrawingRef = options.isDrawingRef ?? ({ current: false } as React.RefObject<boolean>);
  return {
    isDrawingRef,
    ...renderHook(() =>
      useCanvasPersistence({
        roomSlug: options.roomSlug ?? null,
        theme: options.theme ?? 'dark',
        isDrawingRef,
        readOnly: options.readOnly ?? false,
      })
    ),
  };
}

beforeEach(() => {
  localStorage.clear();
  seed();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('useCanvasPersistence idle autosave', () => {
  it('saves the scene and viewport after the idle delay', () => {
    seed([rect('a')]);
    setup();

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY);
    });

    const saved = readSaved();
    expect(saved).not.toBeNull();
    const payload = saved as unknown as {
      userPreferences: Record<string, unknown>;
      elementStates: { elements: DriplElement[] };
    };
    expect(payload.userPreferences).toMatchObject({
      theme: 'dark',
      zoom: 2,
      panX: 30,
      panY: -40,
      currentStrokeColor: '#123456',
      activeTool: 'rectangle',
    });
    expect(payload.elementStates.elements.map(el => el.id)).toEqual(['a']);
  });

  it('waits for the whole idle window rather than firing early', () => {
    seed([rect('a')]);
    setup();

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY - 1);
    });
    expect(readSaved()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(readSaved()).not.toBeNull();
  });

  it('debounces a burst of edits into a single save', () => {
    seed([rect('a')]);
    setup();

    for (let i = 1; i <= 5; i++) {
      act(() => {
        useCanvasStore.getState().updateElementTransient('a', { x: i * 10 });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }
    // 2500ms of quiet time has not elapsed since the last edit.
    expect(readSaved()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY);
    });
    expect(readSaved()).not.toBeNull();
  });

  it('defers the save while a gesture is in flight and retries afterwards', () => {
    seed([rect('a', 10)]);
    const isDrawingRef = { current: true } as React.RefObject<boolean>;
    setup({ isDrawingRef });

    // Armed while drawing, so the shorter retry delay applies and it keeps
    // re-arming until the gesture ends.
    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });
    expect(readSaved()).toBeNull();

    act(() => {
      isDrawingRef.current = false;
      vi.advanceTimersByTime(RETRY_DELAY);
    });
    const saved = readSaved() as unknown as { elementStates: { elements: DriplElement[] } };
    expect(saved.elementStates.elements[0]!.x).toBe(10);
  });

  it('ignores element changes made mid-gesture until the user goes idle', () => {
    seed([rect('a', 0)]);
    const isDrawingRef = { current: true } as React.RefObject<boolean>;
    setup({ isDrawingRef });

    act(() => {
      useCanvasStore.getState().updateElementTransient('a', { x: 99 });
    });
    // The subscription is gated on the drawing flag, so the mid-gesture edit
    // does not arm its own save window.
    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });
    expect(readSaved()).toBeNull();

    act(() => {
      isDrawingRef.current = false;
      vi.advanceTimersByTime(RETRY_DELAY);
    });
    const saved = readSaved() as unknown as { elementStates: { elements: DriplElement[] } };
    expect(saved.elementStates.elements[0]!.x).toBe(99);
  });

  it('persists the selection alongside the scene', () => {
    seed([rect('a'), rect('b', 300)]);
    useCanvasStore.getState().setSelectedIds(new Set(['b']));
    setup();

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY);
    });

    const saved = readSaved() as unknown as { elementStates: { selectedIds?: string[] } };
    expect(saved.elementStates.selectedIds).toEqual(['b']);
  });
});

describe('useCanvasPersistence gating', () => {
  it('does not autosave inside a collaborative room', () => {
    seed([rect('a')]);
    setup({ roomSlug: 'my-room' });

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY * 4);
    });
    act(() => {
      useCanvasStore.getState().updateElementTransient('a', { x: 5 });
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });

    expect(readSaved()).toBeNull();
  });

  it('does not autosave a read-only canvas', () => {
    seed([rect('a')]);
    setup({ readOnly: true });

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY * 4);
    });
    expect(readSaved()).toBeNull();
  });

  it('starts saving as soon as the room is left', () => {
    seed([rect('a')]);
    const isDrawingRef = { current: false } as React.RefObject<boolean>;
    const { rerender } = renderHook(
      (props: { roomSlug: string | null }) =>
        useCanvasPersistence({
          roomSlug: props.roomSlug,
          theme: 'dark',
          isDrawingRef,
          readOnly: false,
        }),
      { initialProps: { roomSlug: 'my-room' as string | null } }
    );

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });
    expect(readSaved()).toBeNull();

    act(() => {
      rerender({ roomSlug: null });
    });
    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY);
    });
    expect(readSaved()).not.toBeNull();
  });
});

describe('useCanvasPersistence flush and cleanup', () => {
  it('flushes on beforeunload instead of waiting for the idle delay', () => {
    seed([rect('a', 42)]);
    setup();

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    const saved = readSaved() as unknown as { elementStates: { elements: DriplElement[] } };
    expect(saved.elementStates.elements[0]!.x).toBe(42);
  });

  it('does not flush on beforeunload inside a room or while read-only', () => {
    seed([rect('a')]);
    setup({ roomSlug: 'my-room' });
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(readSaved()).toBeNull();

    localStorage.clear();
    seed([rect('a')]);
    setup({ readOnly: true });
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(readSaved()).toBeNull();
  });

  it('removes the beforeunload listener on unmount', () => {
    seed([rect('a')]);
    const { unmount } = setup();
    unmount();

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });
    expect(readSaved()).toBeNull();
  });

  it('cancels the pending save and unsubscribes on unmount', () => {
    seed([rect('a')]);
    const { unmount } = setup();

    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY - 500);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });

    expect(readSaved()).toBeNull();
  });

  it('stops reacting to store changes after unmount', () => {
    seed([rect('a')]);
    const { unmount } = setup();
    unmount();

    act(() => {
      useCanvasStore.getState().updateElementTransient('a', { x: 7 });
      vi.advanceTimersByTime(IDLE_DELAY * 3);
    });
    expect(readSaved()).toBeNull();
  });

  it('flushes the current state even when the pending timer was never armed', () => {
    // roomSlug non-null arms no timer at all; the beforeunload handler must
    // still be absent rather than writing a half-state.
    seed([rect('a')]);
    const { unmount } = setup({ roomSlug: 'room' });

    act(() => {
      useCanvasStore.getState().setElements([rect('a', 500)], { skipHistory: true });
      vi.advanceTimersByTime(IDLE_DELAY * 2);
    });
    expect(readSaved()).toBeNull();

    unmount();
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(readSaved()).toBeNull();
  });
});
