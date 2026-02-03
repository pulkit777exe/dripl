"use client";

import { useRef, useEffect, useState } from "react";

interface CursorPosition {
  x: number;
  y: number;
  color: string;
  userName: string;
}

interface InterpolatedCursor extends CursorPosition {
  targetX: number;
  targetY: number;
}

export function useInterpolatedCursors(
  remoteCursors: Map<string, CursorPosition>,
  lerpFactor: number = 0.15,
) {
  const [interpolatedCursors, setInterpolatedCursors] = useState<
    Map<string, InterpolatedCursor>
  >(new Map());
  const cursorsRef = useRef<Map<string, InterpolatedCursor>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    remoteCursors.forEach((cursor, userId) => {
      const existing = cursorsRef.current.get(userId);
      if (existing) {
        cursorsRef.current.set(userId, {
          ...existing,
          targetX: cursor.x,
          targetY: cursor.y,
          color: cursor.color,
          userName: cursor.userName,
        });
      } else {
        cursorsRef.current.set(userId, {
          x: cursor.x,
          y: cursor.y,
          targetX: cursor.x,
          targetY: cursor.y,
          color: cursor.color,
          userName: cursor.userName,
        });
      }
    });

    cursorsRef.current.forEach((_, userId) => {
      if (!remoteCursors.has(userId)) {
        cursorsRef.current.delete(userId);
      }
    });
  }, [remoteCursors]);

  useEffect(() => {
    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      let hasChanges = false;

      cursorsRef.current.forEach((cursor, userId) => {
        const dx = cursor.targetX - cursor.x;
        const dy = cursor.targetY - cursor.y;

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          cursor.x += dx * lerpFactor;
          cursor.y += dy * lerpFactor;
          hasChanges = true;
        } else {
          cursor.x = cursor.targetX;
          cursor.y = cursor.targetY;
        }
      });

      if (hasChanges) {
        setInterpolatedCursors(new Map(cursorsRef.current));
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      isRunning = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [lerpFactor]);

  return interpolatedCursors;
}

export function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor;
}
