import { DriplElement, ShapeType, SHAPES } from '@dripl/common';
import { generateId } from '@dripl/utils';

export const createElement = (
  type: ShapeType,
  x: number,
  y: number,
  width: number = 100,
  height: number = 100
): DriplElement => {
  const base = {
    id: generateId(),
    x,
    y,
    width,
    height,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 1,
    opacity: 1,
  };

  switch (type) {
    case SHAPES.RECTANGLE:
      return { ...base, type: 'rectangle' };
    case SHAPES.ELLIPSE:
      return { ...base, type: 'ellipse' };
    case SHAPES.TEXT:
      return { ...base, type: 'text', text: 'Text', fontSize: 20, fontFamily: 'Arial' };
    case SHAPES.ARROW:
      return { ...base, type: 'arrow', points: [{ x: 0, y: 0 }, { x: width, y: height }] };
    case SHAPES.LINE:
      return { ...base, type: 'line', points: [{ x: 0, y: 0 }, { x: width, y: height }] };
    case SHAPES.FREEDRAW:
      return { ...base, type: 'freedraw', points: [] };
    default:
      throw new Error(`Unknown shape type: ${type}`);
  }
};
