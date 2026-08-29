import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLaserTrail } from '@/hooks/canvas/useLaserTrail';

describe('useLaserTrail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function emitLaserStart(x: number, y: number) {
    window.dispatchEvent(new CustomEvent('dripl:laser-start', { detail: { x, y } }));
  }
  function emitLaserMove(x: number, y: number) {
    window.dispatchEvent(new CustomEvent('dripl:laser-move', { detail: { x, y } }));
  }
  function emitLaserEnd() {
    window.dispatchEvent(new CustomEvent('dripl:laser-end'));
  }

  it('starts with no points and not active', () => {
    const { result } = renderHook(() => useLaserTrail());
    expect(result.current.points.current).toEqual([]);
    expect(result.current.isActive).toBe(false);
  });

  it('captures the starting point on dripl:laser-start', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserStart(10, 20);
    });
    expect(result.current.points.current).toHaveLength(1);
    expect(result.current.points.current[0]).toMatchObject({ x: 10, y: 20 });
    expect(result.current.isActive).toBe(true);
  });

  it('appends points on dripl:laser-move', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserStart(0, 0);
      emitLaserMove(5, 5);
      emitLaserMove(10, 10);
    });
    expect(result.current.points.current).toHaveLength(3);
    expect(result.current.points.current[1]).toMatchObject({ x: 5, y: 5 });
    expect(result.current.points.current[2]).toMatchObject({ x: 10, y: 10 });
  });

  it('ignores laser-move events before laser-start', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserMove(50, 50);
    });
    // The append() call still mutates the ref, but there is no real
    // start — the renderer would treat this as a stray move. The hook
    // contract is: the renderer guards on isActive, not on the move
    // listener. We document the behavior either way.
    expect(result.current.points.current).toHaveLength(0);
    expect(result.current.isActive).toBe(false);
  });

  it('sets isActive false on dripl:laser-end', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserStart(0, 0);
    });
    expect(result.current.isActive).toBe(true);
    act(() => {
      emitLaserEnd();
    });
    expect(result.current.isActive).toBe(false);
  });

  it('prune() drops points older than maxAgeMs', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserStart(0, 0);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      emitLaserMove(10, 10);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Total elapsed: 1000ms. First point is 1000ms old.
    act(() => {
      result.current.prune(800);
    });
    // Only the second point (500ms old) survives.
    expect(result.current.points.current).toHaveLength(1);
    expect(result.current.points.current[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('append() caps the trail at MAX_POINTS_PER_TRAIL (160)', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserStart(0, 0);
    });
    act(() => {
      for (let i = 1; i <= 200; i++) {
        emitLaserMove(i, i);
      }
    });
    expect(result.current.points.current).toHaveLength(160);
    // The oldest point should be #41 (200 - 160 + 1) because we keep the last 160.
    expect(result.current.points.current[0]).toMatchObject({ x: 41, y: 41 });
    expect(result.current.points.current.at(-1)).toMatchObject({ x: 200, y: 200 });
  });

  it('clear() empties the points and deactivates', () => {
    const { result } = renderHook(() => useLaserTrail());
    act(() => {
      emitLaserStart(0, 0);
      emitLaserMove(10, 10);
    });
    expect(result.current.points.current.length).toBeGreaterThan(0);
    act(() => {
      result.current.clear();
    });
    expect(result.current.points.current).toEqual([]);
    expect(result.current.isActive).toBe(false);
  });

  it('detaches listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useLaserTrail());
    const added = addSpy.mock.calls.filter(c => String(c[0]).startsWith('dripl:laser-'));
    expect(added.length).toBe(3);
    unmount();
    const removed = removeSpy.mock.calls.filter(c => String(c[0]).startsWith('dripl:laser-'));
    expect(removed.length).toBe(3);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
