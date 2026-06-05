'use client';

import React from 'react';
import { DriplElement, Point } from '@dripl/common';
import { getElementBounds, elementLocalPointToWorld } from '@dripl/math/intersection';

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

export type ResizeHandle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'arrow-start'
  | 'arrow-end'
  | `arrow-point-${number}`;

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

  const customStyleSheet = `
    .dripl-corner-handle {
      width: 10px;
      height: 10px;
      background-color: var(--color-panel-bg, #FAFAF7);
      border: 1.5px solid var(--color-primary, #E8462A);
      border-radius: 3px;
      position: absolute;
      pointer-events: auto;
      z-index: 20;
      box-sizing: border-box;
      transition: transform 0.1s cubic-bezier(0.3, 0, 0, 1), background-color 0.1s ease;
    }

    .dripl-corner-handle:hover {
      transform: scale(1.3);
      background-color: var(--color-primary, #E8462A);
      border-color: var(--color-primary, #E8462A);
    }

    .dripl-corner-handle.nw-handle { top: -6px; left: -6px; cursor: nw-resize; }
    .dripl-corner-handle.ne-handle { top: -6px; right: -6px; cursor: ne-resize; }
    .dripl-corner-handle.se-handle { bottom: -6px; right: -6px; cursor: se-resize; }
    .dripl-corner-handle.sw-handle { bottom: -6px; left: -6px; cursor: sw-resize; }

    .dripl-rotate-handle {
      width: 10px;
      height: 10px;
      background-color: var(--color-panel-bg, #FAFAF7);
      border: 1.5px solid var(--color-primary, #E8462A);
      border-radius: 50%;
      position: absolute;
      pointer-events: auto;
      z-index: 20;
      box-sizing: border-box;
      cursor: grab;
      top: -24px;
      left: 50%;
      transform: translateX(-50%);
      transition: transform 0.1s cubic-bezier(0.3, 0, 0, 1), background-color 0.1s ease;
    }

    .dripl-rotate-handle:hover {
      transform: translateX(-50%) scale(1.3);
      background-color: var(--color-primary, #E8462A);
      border-color: var(--color-primary, #E8462A);
    }

    .dripl-rotate-handle:active {
      cursor: grabbing;
    }

    .dripl-linear-handle {
      width: 12px;
      height: 12px;
      background-color: var(--color-tool-active-bg, rgba(232, 70, 42, 0.25));
      border: 1.5px solid var(--color-primary, #E8462A);
      border-radius: 50%;
      position: absolute;
      pointer-events: auto;
      z-index: 20;
      box-sizing: border-box;
      cursor: move;
      transition: transform 0.1s cubic-bezier(0.3, 0, 0, 1), background-color 0.1s ease;
    }

    .dripl-linear-handle:hover {
      transform: scale(1.3);
      background-color: var(--color-primary, #E8462A);
    }

    .dripl-linear-mid-handle {
      width: 10px;
      height: 10px;
      background-color: var(--color-tool-active-bg, rgba(232, 70, 42, 0.25));
      border: 1.5px solid var(--color-primary, #E8462A);
      border-radius: 50%;
      position: absolute;
      pointer-events: none;
      z-index: 19;
      box-sizing: border-box;
      opacity: 0.85;
    }
  `;

  // Case 1: Multiple elements are selected.
  if (selected.length > 1) {
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

    const sx = minX * zoom + panX;
    const sy = minY * zoom + panY;
    const sw = (maxX - minX) * zoom;
    const sh = (maxY - minY) * zoom;

    const containerStyle: React.CSSProperties = {
      position: 'absolute',
      left: sx,
      top: sy,
      width: sw,
      height: sh,
      zIndex: 10,
      pointerEvents: 'none',
      border: '1.5px dashed var(--color-primary, #E8462A)',
      boxSizing: 'border-box',
    };

    return (
      <>
        {/* Render each individual selected element's border with no handles */}
        {selected.map(el => {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const angle = el.angle || 0;

          const elW = el.width * zoom;
          const elH = el.height * zoom;
          const elCX = cx * zoom + panX;
          const elCY = cy * zoom + panY;

          return (
            <div
              key={`indiv-${el.id}`}
              style={{
                position: 'absolute',
                left: elCX,
                top: elCY,
                width: elW,
                height: elH,
                transform: `translate(-50%, -50%) rotate(${angle}rad)`,
                border: '1px solid var(--color-primary, #E8462A)',
                opacity: 0.45,
                boxSizing: 'border-box',
                pointerEvents: 'none',
                zIndex: 9,
              }}
            />
          );
        })}

        {/* Combined bounding box for the entire group with corner handles and a rotation handle */}
        <div style={containerStyle}>
          <style dangerouslySetInnerHTML={{ __html: customStyleSheet }} />
          {/* Corner handles */}
          <div className="dripl-corner-handle nw-handle" onPointerDown={e => onResizeStart('nw', e)} />
          <div className="dripl-corner-handle ne-handle" onPointerDown={e => onResizeStart('ne', e)} />
          <div className="dripl-corner-handle se-handle" onPointerDown={e => onResizeStart('se', e)} />
          <div className="dripl-corner-handle sw-handle" onPointerDown={e => onResizeStart('sw', e)} />
          {/* Floating Rotation Handle */}
          <div className="dripl-rotate-handle" onPointerDown={onRotateStart} />
        </div>
      </>
    );
  }

  // Case 2: Exactly one element is selected.
  const el = selected[0]!;
  const isLinear = el.type === 'arrow' || el.type === 'line';

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const b = getElementBounds(el);
  minX = b.x;
  minY = b.y;
  maxX = b.x + b.width;
  maxY = b.y + b.height;

  if (isLinear) {
    // Linear elements (arrows & lines) display custom circle handles at their endpoints
    // and midpoints, but no bounding box rectangle.
    const containerStyle: React.CSSProperties = {
      position: 'absolute',
      left: minX * zoom + panX,
      top: minY * zoom + panY,
      width: (maxX - minX) * zoom,
      height: (maxY - minY) * zoom,
      zIndex: 10,
      pointerEvents: 'none',
      border: 'none',
      boxSizing: 'border-box',
    };

    const arrowEndpoints = (() => {
      if (!('points' in el) || !el.points || el.points.length < 2) return [];
      const points = el.points as Point[];

      return points.map((pt, i) => {
        const worldPt = elementLocalPointToWorld(el, pt);
        const isEndpoint = i === 0 || i === points.length - 1;
        const handleId: ResizeHandle =
          i === 0 ? 'arrow-start' : i === points.length - 1 ? 'arrow-end' : `arrow-point-${i}`;
        return {
          id: handleId,
          left: (worldPt.x - minX) * zoom,
          top: (worldPt.y - minY) * zoom,
          isEndpoint,
        };
      });
    })();

    return (
      <div style={containerStyle}>
        <style dangerouslySetInnerHTML={{ __html: customStyleSheet }} />
        {arrowEndpoints.map(({ id, left, top, isEndpoint }) => (
          <div
            key={id}
            className={isEndpoint ? 'dripl-linear-handle' : 'dripl-linear-mid-handle'}
            style={{
              left: isEndpoint ? left - 6 : left - 5,
              top: isEndpoint ? top - 6 : top - 5,
              pointerEvents: 'auto',
              cursor: 'move',
            }}
            onPointerDown={e => onResizeStart(id, e)}
          />
        ))}
      </div>
    );
  }

  // Standard shapes (rectangles, diamonds, ellipses, text, images, frames)
  // use a solid border that is perfectly rotated alongside the element.
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const angle = el.angle || 0;

  const screenCX = cx * zoom + panX;
  const screenCY = cy * zoom + panY;
  const screenW = el.width * zoom;
  const screenH = el.height * zoom;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: screenCX,
    top: screenCY,
    width: screenW,
    height: screenH,
    transform: `translate(-50%, -50%) rotate(${angle}rad)`,
    zIndex: 10,
    pointerEvents: 'none',
    border: '1.5px solid var(--color-primary, #E8462A)',
    boxSizing: 'border-box',
  };

  return (
    <div style={containerStyle}>
      <style dangerouslySetInnerHTML={{ __html: customStyleSheet }} />
      {/* 4 Corner handles */}
      <div className="dripl-corner-handle nw-handle" onPointerDown={e => onResizeStart('nw', e)} />
      <div className="dripl-corner-handle ne-handle" onPointerDown={e => onResizeStart('ne', e)} />
      <div className="dripl-corner-handle se-handle" onPointerDown={e => onResizeStart('se', e)} />
      <div className="dripl-corner-handle sw-handle" onPointerDown={e => onResizeStart('sw', e)} />
      {/* Floating Rotation Handle */}
      <div className="dripl-rotate-handle" onPointerDown={onRotateStart} />
    </div>
  );
}
