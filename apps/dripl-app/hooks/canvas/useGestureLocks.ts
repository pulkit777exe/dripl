'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * How often held gesture locks re-assert while a gesture is active. Must
 * stay comfortably under the server's 10s lock sweep timeout so a slow
 * drag never loses its lock mid-gesture (which would let a remote replica
 * overwrite the element being edited).
 */
export const GESTURE_LOCK_HEARTBEAT_MS = 5_000;

/**
 * Tracks ids locked by the local in-progress gesture (drag/resize/rotate).
 *
 * Extracted from RoughCanvas: the ref owns the lock set, the callbacks mirror
 * it to the collaboration layer so remote reconciliation (`reconcileScene`)
 * never overwrites an element mid-gesture. While any lock is held, a
 * heartbeat re-asserts each id so the server sweep cannot expire it.
 */
export function useGestureLocks(
  lockElement: (id: string) => void,
  unlockElement: (id: string) => void,
  heartbeatLockElement: (id: string) => void = () => {}
) {
  const activeGestureLocksRef = useRef<Set<string>>(new Set());
  const heartbeatTimerRef = useRef<number | null>(null);
  const heartbeatRef = useRef(heartbeatLockElement);
  heartbeatRef.current = heartbeatLockElement;

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const ensureHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) return;
    heartbeatTimerRef.current = window.setInterval(() => {
      activeGestureLocksRef.current.forEach(id => {
        heartbeatRef.current(id);
      });
    }, GESTURE_LOCK_HEARTBEAT_MS);
  }, []);

  // Never leak the interval past unmount; the server sweep expires the
  // orphaned lock on its own timeout.
  useEffect(() => stopHeartbeat, [stopHeartbeat]);

  const lockElementsForGesture = useCallback(
    (ids: Iterable<string>) => {
      for (const id of ids) {
        activeGestureLocksRef.current.add(id);
        lockElement(id);
      }
      if (activeGestureLocksRef.current.size > 0) ensureHeartbeat();
    },
    [lockElement, ensureHeartbeat]
  );

  const unlockGestureElements = useCallback(() => {
    activeGestureLocksRef.current.forEach(id => {
      unlockElement(id);
    });
    activeGestureLocksRef.current.clear();
    stopHeartbeat();
  }, [unlockElement, stopHeartbeat]);

  const isGestureLocked = useCallback((id: string) => activeGestureLocksRef.current.has(id), []);

  return {
    activeGestureLocksRef,
    lockElementsForGesture,
    unlockGestureElements,
    isGestureLocked,
  };
}
