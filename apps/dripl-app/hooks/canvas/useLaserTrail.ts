'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export interface LaserPoint {
  x: number;
  y: number;
  createdAt: number;
}

export interface LaserTrail {
  /**
   * Live array of points in the current trail. The renderer reads
   * this ref each animation frame to avoid going through React.
   * Never assign to `trail.points.current` from outside the hook.
   */
  readonly points: MutableRefObject<ReadonlyArray<LaserPoint>>;
  /** Bumps on laser start / end so the renderer can react. */
  isActive: boolean;
  append: (x: number, y: number) => void;
  end: () => void;
  prune: (maxAgeMs: number) => void;
  clear: () => void;
}

const MAX_POINTS_PER_TRAIL = 160;
const LASER_EVENT_START = 'dripl:laser-start';
const LASER_EVENT_MOVE = 'dripl:laser-move';
const LASER_EVENT_END = 'dripl:laser-end';

interface LaserStartDetail {
  x: number;
  y: number;
}

interface LaserMoveDetail {
  x: number;
  y: number;
}

/**
 * Owns the laser-pointer trail state for a single user. The component
 * using this hook is responsible for rendering; the hook is
 * responsible for:
 *
 *   1. Subscribing to the three `dripl:laser-*` window events that
 *      the collaboration broadcast layer emits.
 *   2. Accumulating points in a ref (avoiding re-renders on every
 *      pointer move).
 *   3. Exposing a stable ref that the renderer reads each animation
 *      frame without going through React.
 *   4. Bounding memory with a sliding cap on points per trail and an
 *      age-based prune.
 *
 * Putting the state behind a hook means the renderer can be a pure
 * paint loop that reads `trail.points.current` each frame, and the
 * accumulation / event / cleanup logic is testable in isolation
 * without a canvas.
 */
export function useLaserTrail(): LaserTrail {
  const pointsRef = useRef<ReadonlyArray<LaserPoint>>([]);
  const [isActive, setIsActive] = useState(false);
  // Mirror isActive into a ref so the event listener closure can read
  // it without re-subscribing on every state change.
  const isActiveRef = useRef(false);

  const append = useCallback((x: number, y: number) => {
    const point: LaserPoint = { x, y, createdAt: Date.now() };
    const next = pointsRef.current.slice(-MAX_POINTS_PER_TRAIL + 1);
    next.push(point);
    pointsRef.current = next;
  }, []);

  const end = useCallback(() => {
    setIsActive(false);
    isActiveRef.current = false;
  }, []);

  const prune = useCallback((maxAgeMs: number) => {
    const cutoff = Date.now() - maxAgeMs;
    const next = pointsRef.current.filter(p => p.createdAt >= cutoff);
    if (next.length !== pointsRef.current.length) {
      pointsRef.current = next;
    }
  }, []);

  const clear = useCallback(() => {
    if (pointsRef.current.length === 0) {
      setIsActive(false);
      isActiveRef.current = false;
      return;
    }
    pointsRef.current = [];
    setIsActive(false);
    isActiveRef.current = false;
  }, []);

  useEffect(() => {
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<LaserStartDetail>).detail;
      if (!detail) return;
      pointsRef.current = [{ x: detail.x, y: detail.y, createdAt: Date.now() }];
      isActiveRef.current = true;
      setIsActive(true);
    };

    const handleMove = (event: Event) => {
      // Only append if a laser is active. A stray dripl:laser-move
      // without a corresponding dripl:laser-start (e.g. a duplicate
      // event after unmount-remount) would otherwise leak a stray
      // point with no start.
      if (!isActiveRef.current) return;
      const detail = (event as CustomEvent<LaserMoveDetail>).detail;
      if (!detail) return;
      append(detail.x, detail.y);
    };

    const handleEnd = () => {
      isActiveRef.current = false;
      setIsActive(false);
    };

    window.addEventListener(LASER_EVENT_START, handleStart);
    window.addEventListener(LASER_EVENT_MOVE, handleMove);
    window.addEventListener(LASER_EVENT_END, handleEnd);

    return () => {
      window.removeEventListener(LASER_EVENT_START, handleStart);
      window.removeEventListener(LASER_EVENT_MOVE, handleMove);
      window.removeEventListener(LASER_EVENT_END, handleEnd);
    };
  }, [append]);

  return {
    points: pointsRef,
    isActive,
    append,
    end,
    prune,
    clear,
  };
}
