import { act, renderHook } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';
import { describe, expect, it, vi } from 'vitest';
import { useContextMenu } from '@/hooks/canvas/useContextMenu';

function contextMenuEvent(x: number, y: number) {
  return {
    preventDefault: vi.fn(),
    currentTarget: {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }),
    },
    clientX: x,
    clientY: y,
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

describe('useContextMenu', () => {
  it('opens on a hit element and selects it when unselected', () => {
    const setSelectedIds = vi.fn();
    const target = { id: 'a' } as DriplElement;
    const { result } = renderHook(() =>
      useContextMenu({
        readOnly: false,
        viewport: { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
        getElementAtPosition: () => target,
        selectedIds: new Set<string>(),
        setSelectedIds,
      })
    );

    act(() => {
      result.current.openContextMenu(contextMenuEvent(110, 120));
    });
    expect(setSelectedIds).toHaveBeenCalledWith(new Set(['a']));
    expect(result.current.contextMenuState).toEqual({ x: 100, y: 100, elementId: 'a' });
  });

  it('dismisses on empty space and in read-only mode', () => {
    const { result, rerender } = renderHook(
      ({ readOnly }: { readOnly: boolean }) =>
        useContextMenu({
          readOnly,
          viewport: { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
          getElementAtPosition: () => null,
          selectedIds: new Set<string>(['a']),
          setSelectedIds: vi.fn(),
        }),
      { initialProps: { readOnly: false } }
    );

    act(() => {
      result.current.openContextMenu(contextMenuEvent(50, 50));
    });
    expect(result.current.contextMenuState).toBeNull();

    rerender({ readOnly: true });
    expect(result.current.contextMenuState).toBeNull();
  });

  it('ignores opens while read-only', () => {
    const setSelectedIds = vi.fn();
    const { result } = renderHook(() =>
      useContextMenu({
        readOnly: true,
        viewport: { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
        getElementAtPosition: () => ({ id: 'a' }) as DriplElement,
        selectedIds: new Set<string>(),
        setSelectedIds,
      })
    );

    const event = contextMenuEvent(110, 120);
    act(() => {
      result.current.openContextMenu(event);
    });
    expect(result.current.contextMenuState).toBeNull();
    expect(setSelectedIds).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
