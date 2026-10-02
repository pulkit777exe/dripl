import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GESTURE_LOCK_HEARTBEAT_MS, useGestureLocks } from '@/hooks/canvas/useGestureLocks';

describe('useGestureLocks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mirrors local locks to the collaboration layer', () => {
    const lockElement = vi.fn();
    const unlockElement = vi.fn();
    const { result } = renderHook(() => useGestureLocks(lockElement, unlockElement));

    act(() => {
      result.current.lockElementsForGesture(['a', 'b']);
    });
    expect(result.current.isGestureLocked('a')).toBe(true);
    expect(result.current.isGestureLocked('c')).toBe(false);
    expect(lockElement).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.unlockGestureElements();
    });
    expect(result.current.isGestureLocked('a')).toBe(false);
    expect(unlockElement).toHaveBeenCalledTimes(2);
  });

  it('heartbeats held locks until every lock is released', () => {
    const heartbeatLockElement = vi.fn();
    const { result } = renderHook(() => useGestureLocks(vi.fn(), vi.fn(), heartbeatLockElement));

    act(() => {
      result.current.lockElementsForGesture(['a', 'b']);
    });
    expect(heartbeatLockElement).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(GESTURE_LOCK_HEARTBEAT_MS);
    });
    expect(heartbeatLockElement).toHaveBeenCalledWith('a');
    expect(heartbeatLockElement).toHaveBeenCalledWith('b');

    act(() => {
      result.current.unlockGestureElements();
    });
    heartbeatLockElement.mockClear();
    act(() => {
      vi.advanceTimersByTime(GESTURE_LOCK_HEARTBEAT_MS * 3);
    });
    expect(heartbeatLockElement).not.toHaveBeenCalled();
  });

  it('stops the heartbeat on unmount so orphaned locks sweep server-side', () => {
    const heartbeatLockElement = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGestureLocks(vi.fn(), vi.fn(), heartbeatLockElement)
    );

    act(() => {
      result.current.lockElementsForGesture(['a']);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(GESTURE_LOCK_HEARTBEAT_MS * 2);
    });
    expect(heartbeatLockElement).not.toHaveBeenCalled();
  });
});
