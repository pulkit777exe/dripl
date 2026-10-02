import type { DriplElement } from '@dripl/common';

/**
 * Style transfer (copy/paste styles) — pure snapshot builders extracted
 * for the feature. The clipboard itself lives in `useStyleTransfer`
 * (memory-only, per tab); the bulk apply lives in the store as
 * `applyStyleToElements` (one history entry).
 */

export type StrokeStyleName = 'solid' | 'dashed' | 'dotted';
export type FillStyleName =
  'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';

export interface ElementStyleSnapshot {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyleName;
  roughness: number;
  opacity: number;
  fillStyle: FillStyleName;
  fontFamily?: string;
  fontSize?: number;
}

export interface CurrentStyleInput {
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentStrokeStyle: StrokeStyleName;
  currentRoughness: number;
  currentFillStyle: FillStyleName;
}

/** Snapshot the element's visual style, falling back to current defaults. */
export function snapshotStyleFromElement(
  element: DriplElement,
  fallback: CurrentStyleInput
): ElementStyleSnapshot {
  const snapshot: ElementStyleSnapshot = {
    strokeColor:
      typeof element.strokeColor === 'string' ? element.strokeColor : fallback.currentStrokeColor,
    backgroundColor:
      typeof element.fillColor === 'string'
        ? element.fillColor
        : typeof element.backgroundColor === 'string'
          ? element.backgroundColor
          : fallback.currentBackgroundColor,
    strokeWidth:
      typeof element.strokeWidth === 'number' ? element.strokeWidth : fallback.currentStrokeWidth,
    strokeStyle:
      element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted'
        ? element.strokeStyle
        : 'solid',
    roughness:
      typeof element.roughness === 'number' ? element.roughness : fallback.currentRoughness,
    opacity: typeof element.opacity === 'number' ? element.opacity : 1,
    fillStyle:
      element.fillStyle === 'hachure' ||
      element.fillStyle === 'solid' ||
      element.fillStyle === 'zigzag' ||
      element.fillStyle === 'cross-hatch' ||
      element.fillStyle === 'dots' ||
      element.fillStyle === 'dashed' ||
      element.fillStyle === 'zigzag-line'
        ? element.fillStyle
        : fallback.currentFillStyle,
  };
  if (element.type === 'text') {
    if (typeof element.fontFamily === 'string') snapshot.fontFamily = element.fontFamily;
    if (typeof element.fontSize === 'number') snapshot.fontSize = element.fontSize;
  }
  return snapshot;
}

/**
 * Project a snapshot onto a target element. Fonts apply to text elements
 * only so shapes never collect stray font props (keeps exports clean).
 */
export function projectStyleForElement(
  snapshot: ElementStyleSnapshot,
  target: DriplElement
): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    strokeColor: snapshot.strokeColor,
    backgroundColor: snapshot.backgroundColor,
    fillColor: snapshot.backgroundColor,
    strokeWidth: snapshot.strokeWidth,
    strokeStyle: snapshot.strokeStyle,
    roughness: snapshot.roughness,
    opacity: snapshot.opacity,
    fillStyle: snapshot.fillStyle,
  };
  if (target.type === 'text') {
    if (snapshot.fontFamily !== undefined) projected.fontFamily = snapshot.fontFamily;
    if (snapshot.fontSize !== undefined) projected.fontSize = snapshot.fontSize;
  }
  return projected;
}
