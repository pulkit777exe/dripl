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
