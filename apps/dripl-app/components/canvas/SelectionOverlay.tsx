'use client';

import { DriplElement, Point } from '@dripl/common';
import { getElementBounds } from '@dripl/math';

interface SelectionOverlayProps {
  zoom: number;
  panX: number;
  panY: number;
  elements: DriplElement[];
  selectedIds: Set<string>;
  onResizeStart: (handle: ResizeHandle, e: React.PointerEvent) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  marqueeSelection?: { start: Point; end: Point; active: boolean } | null;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const H = 12;

const CORNER_HANDLES: { id: ResizeHandle; css: React.CSSProperties }[] = [
  { id: 'nw', css: { top: -H / 2, left: -H / 2, cursor: 'nw-resize' } },
  { id: 'ne', css: { top: -H / 2, right: -H / 2, cursor: 'ne-resize' } },
  { id: 'se', css: { bottom: -H / 2, right: -H / 2, cursor: 'se-resize' } },
  { id: 'sw', css: { bottom: -H / 2, left: -H / 2, cursor: 'sw-resize' } },
];

const EDGE_HANDLES: { id: ResizeHandle; css: React.CSSProperties }[] = [
  {
    id: 'n',
    css: {
      top: -H / 2,
      left: '50%',
      transform: 'translateX(-50%)',
      cursor: 'n-resize',
    },
  },
  {
    id: 'e',
    css: {
      top: '50%',
      right: -H / 2,
      transform: 'translateY(-50%)',
      cursor: 'e-resize',
    },
  },
  {
    id: 's',
    css: {
      bottom: -H / 2,
      left: '50%',
      transform: 'translateX(-50%)',
      cursor: 's-resize',
    },
  },
  {
    id: 'w',
    css: {
      top: '50%',
      left: -H / 2,
      transform: 'translateY(-50%)',
      cursor: 'w-resize',
    },
  },
];

const baseHandle: React.CSSProperties = {
  width: H,
  height: H,
  backgroundColor: 'transparent',
  border: 'none',
  position: 'absolute',
  pointerEvents: 'auto',
  zIndex: 20,
  boxSizing: 'border-box',
};

export function SelectionOverlay({
  zoom,
  panX,
  panY,
  elements,
  selectedIds,
  onResizeStart,
  onRotateStart,
  marqueeSelection,
}: SelectionOverlayProps) {
  if (marqueeSelection?.active) return null;

  if (selectedIds.size === 0) return null;

  const selected = elements.filter(el => selectedIds.has(el.id));
  if (selected.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  selected.forEach(el => {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  });

  const PAD = 6;
  const sx = minX * zoom + panX - PAD;
  const sy = minY * zoom + panY - PAD;
  const sw = (maxX - minX) * zoom + PAD * 2;
  const sh = (maxY - minY) * zoom + PAD * 2;

  const showHandles = selected.length === 1;

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        transform: `translate(${sx}px, ${sy}px)`,
        width: sw,
        height: sh,
        zIndex: 10,
      }}
    >
      {showHandles && (
        <>
          {CORNER_HANDLES.map(({ id, css }) => (
            <div
              key={id}
              className="resize-handle"
              style={{ ...baseHandle, ...css }}
              onPointerDown={e => onResizeStart(id, e)}
            />
          ))}

          {EDGE_HANDLES.map(({ id, css }) => (
            <div
              key={id}
              className="resize-handle"
              style={{
                ...baseHandle,
                ...css,
              }}
              onPointerDown={e => onResizeStart(id, e)}
            />
          ))}

          <div
            className="rotate-handle"
            style={{
              width: 18,
              height: 18,
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 9,
              position: 'absolute',
              top: -30,
              left: '50%',
              transform: 'translateX(-50%)',
              cursor: 'grab',
              pointerEvents: 'auto',
              zIndex: 20,
            }}
            onPointerDown={onRotateStart}
          />
        </>
      )}
    </div>
  );
}
