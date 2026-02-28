"use client";

import { useInterpolatedCursors } from "@/hooks/useInterpolatedCursors";
import { useCanvasStore } from "@/lib/canvas-store";

export function RemoteCursors() {
  const remoteCursors = useCanvasStore((state) => state.remoteCursors);
  const userId = useCanvasStore((state) => state.userId);
  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);

  // Use interpolated cursors for smooth movement
  const interpolatedCursors = useInterpolatedCursors(remoteCursors);

  // Filter out our own cursor to avoid duplicate display
  const cursorsToRender = userId
    ? Array.from(interpolatedCursors.entries()).filter(
        ([uid]) => uid !== userId,
      )
    : Array.from(interpolatedCursors.entries());

  return (
    <>
      {cursorsToRender.map(([userIdKey, cursor]) => (
        <div
          key={userIdKey}
          className="absolute pointer-events-none z-50"
          style={{
            left: `${cursor.x * zoom + panX}px`,
            top: `${cursor.y * zoom + panY}px`,
            transform: "translate(-50%, -50%)",
            // No CSS transition - using requestAnimationFrame interpolation
          }}
        >
          {/* Cursor pointer */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5.65376 12.3673L11.6856 18.3991C12.2253 18.9388 13.0706 18.9388 13.6103 18.3991L19.6421 12.3673C20.1818 11.8276 20.1818 10.9823 19.6421 10.4426L13.6103 4.41079C13.0706 3.87109 12.2253 3.87109 11.6856 4.41079L5.65376 10.4426C5.11406 10.9823 5.11406 11.8276 5.65376 12.3673Z"
              fill={cursor.color}
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>

          {/* User name label */}
          <div
            className="absolute top-6 left-0 px-2 py-1 rounded text-xs text-white whitespace-nowrap shadow-lg"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.userName}
          </div>
        </div>
      ))}
    </>
  );
}
