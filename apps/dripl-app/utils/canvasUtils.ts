import type { DriplElement } from '@dripl/common';
import { getDefaultFontFamily } from './fontPreferences';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Normalizes an element to ensure all required fields exist and have valid values
 * Fixes rendering inconsistencies by standardizing element structure
 */
export function normalizeElement(element: DriplElement): DriplElement {
  const normalized = {
    // Copy all properties first
    ...element,
    // Ensure all required fields are present
    id: element.id || generateId(),
    type: element.type || 'rectangle',
    x: element.x ?? 0,
    y: element.y ?? 0,
    width: element.width ?? 100,
    height: element.height ?? 100,
    // Finiteness, not type: `typeof NaN === 'number'` and so is `typeof Infinity`, so a
    // `typeof` guard waves all three through. The modulo then yields `NaN` for each and
    // `NaN < 0` is false, so nothing corrects them — and an element leaving here with a
    // `NaN` rotation produces `NaN` coordinates everywhere downstream, which is far
    // harder to trace back than a zeroed angle. `JSON.stringify` renders these as
    // `null`, so they cannot arrive from a stored scene or a remote delta; the live
    // path is an in-process producer, e.g. `computeRotationAngle` returning `NaN` when
    // a pointer coordinate has gone non-finite mid-gesture.
    angle: Number.isFinite(element.angle) ? element.angle : 0,
    version: element.version || 1,
    versionNonce: element.versionNonce || Math.floor(Math.random() * 2_147_483_647),
    opacity: typeof element.opacity === 'number' ? element.opacity : 1,
    strokeColor: element.strokeColor || '#000000',
    strokeWidth: element.strokeWidth ?? 2,
    strokeStyle: element.strokeStyle || 'solid',
    backgroundColor: element.backgroundColor || 'transparent',
    fillStyle: element.fillStyle || 'hachure',
    roughness: element.roughness ?? 1,
    isDeleted: element.isDeleted || false,
    updated: element.updated || Date.now(),
  } as DriplElement;

  // Ensure width and height are at least 1px to avoid rendering issues
  normalized.width = Math.max(normalized.width, 1);
  normalized.height = Math.max(normalized.height, 1);

  // Ensure angle is between 0 and 2π. The guard is finiteness for the same reason as
  // above — by this point `normalized.angle` is already known finite, so the `else` is
  // unreachable and exists only as a type narrowing.
  if (typeof normalized.angle === 'number' && Number.isFinite(normalized.angle)) {
    normalized.angle = normalized.angle % (2 * Math.PI);
    if (normalized.angle < 0) {
      normalized.angle += 2 * Math.PI;
    }
  } else {
    normalized.angle = 0;
  }

  // Ensure points array exists for line-based elements
  if (
    (normalized.type === 'line' || normalized.type === 'arrow' || normalized.type === 'freedraw') &&
    (!normalized.points || !Array.isArray(normalized.points))
  ) {
    normalized.points = [];
  }

  // For text elements, ensure text property exists
  if (normalized.type === 'text' && !normalized.text) {
    normalized.text = '';
    normalized.fontSize = normalized.fontSize || 20;
    normalized.fontFamily = normalized.fontFamily || getDefaultFontFamily();
  }

  // For image elements, ensure src property exists
  if (normalized.type === 'image' && !normalized.src) {
    normalized.src = '';
  }

  // For frame elements, ensure padding property exists
  if (normalized.type === 'frame' && typeof normalized.padding !== 'number') {
    normalized.padding = 20;
  }

  return normalized;
}
