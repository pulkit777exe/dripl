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

export const SHAPES = {
  RECTANGLE: 'rectangle',
  ELLIPSE: 'ellipse',
  DIAMOND: 'diamond',
  ARROW: 'arrow',
  LINE: 'line',
  TEXT: 'text',
  FREEDRAW: 'freedraw',
  IMAGE: 'image',
  FRAME: 'frame',
} as const;

export type ShapeType = (typeof SHAPES)[keyof typeof SHAPES];

export const MAX_ELEMENTS_PER_ROOM = 10_000;
export const MAX_ELEMENT_PAYLOAD_BYTES = 50_000;
export const MAX_MESSAGE_BYTES = 200_000;
export const MAX_FILE_CONTENT_BYTES = 2_000_000;
export const ROOM_SIZE_WARNING_THRESHOLD = 0.8;
