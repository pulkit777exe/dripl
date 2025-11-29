export const COLORS = {
  primary: '#000000',
  secondary: '#888888',
  selection: '#6965db',
  background: '#ffffff',
};

export const SHAPES = {
  RECTANGLE: 'rectangle',
  ELLIPSE: 'ellipse',
  ARROW: 'arrow',
  LINE: 'line',
  TEXT: 'text',
  FREEDRAW: 'freedraw',
} as const;

export type ShapeType = typeof SHAPES[keyof typeof SHAPES];
