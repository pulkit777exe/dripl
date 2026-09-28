export const COLORS = {
  primary: '#000000',
  secondary: '#888888',
  selection: '#6965db',
  background: '#ffffff',
};

export const USER_COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#45b7d1',
  '#ffa07a',
  '#98d8c8',
  '#f7dc6f',
  '#bb8fce',
  '#85c1e2',
] as const;

export function pickUserColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)] ?? '#45b7d1';
}

/**
 * Shape vocabulary. Kept in step with `ElementTypeSchema` in ./schemas.ts, which
 * is the canonical list. `path` and `embed` were missing here, which made
 * `ShapeType` a strictly narrower union than the element type it is supposed to
 * describe - a `ShapeType` value could never name a path or an embed element.
 */
export const SHAPES = {
  RECTANGLE: 'rectangle',
  ELLIPSE: 'ellipse',
  PATH: 'path',
  DIAMOND: 'diamond',
  ARROW: 'arrow',
  LINE: 'line',
  TEXT: 'text',
  FREEDRAW: 'freedraw',
  IMAGE: 'image',
  FRAME: 'frame',
  EMBED: 'embed',
} as const;

export type ShapeType = (typeof SHAPES)[keyof typeof SHAPES];

// MAX_ELEMENTS_PER_ROOM and MAX_ELEMENT_PAYLOAD_BYTES used to live here at
// 10_000 / 50_000 with zero references. The live caps are 5_000 in both
// ws-server (MAX_ELEMENTS_PER_SCENE) and http-server (MAX_SCENE_ELEMENTS), so a
// constant advertising 10_000 was a trap: the next person to reconcile the
// three would have "fixed" the real limit in the wrong direction. There is one
// scene-element cap per service today, and this package no longer claims a
// third value.
// Scene-element cap, single owner. ws-server (rooms.ts), http-server
// (sceneValidation.ts), and the app's import/share/canvas validation all
// enforce this same value; it lives here so the three cannot drift.
export const MAX_SCENE_ELEMENTS = 5_000;
export const MAX_MESSAGE_BYTES = 200_000;
export const MAX_FILE_CONTENT_BYTES = 2_000_000;
export const ROOM_SIZE_WARNING_THRESHOLD = 0.8;
