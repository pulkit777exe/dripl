import { describe, expect, it } from 'vitest';
import { addElementSchema, messageSchema } from '../validation';

const baseElement = {
  id: 'element-with-metadata',
  type: 'arrow' as const,
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  points: [
    { x: 0, y: 0 },
    { x: 200, y: 100 },
  ],
  version: 7,
  versionNonce: 123456,
  updated: 1710000000000,
  fractionalIndex: 'a0',
  arrowStyle: 'elbow' as const,
  arrowHeads: {
    start: 'bar' as const,
    end: 'diamond' as const,
  },
  startBinding: {
    elementId: 'shape-1',
    fixedPoint: { x: 0, y: 0.5 },
    mode: 'orbit' as const,
  },
};

describe('WebSocket element validation metadata', () => {
  it('preserves ordering and conflict-resolution metadata', () => {
    const result = addElementSchema.safeParse({ type: 'add_element', element: baseElement });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.element).toMatchObject({
      version: 7,
      versionNonce: 123456,
      fractionalIndex: 'a0',
      arrowStyle: 'elbow',
      arrowHeads: { start: 'bar', end: 'diamond' },
      startBinding: baseElement.startBinding,
    });
  });

  it('accepts a legacy text element without optional typography fields', () => {
    const result = messageSchema.safeParse({
      type: 'add_element',
      element: {
        id: 'text-1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        text: 'Legacy text',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== 'add_element') return;
    expect(result.data.element).toMatchObject({ fontSize: 20 });
  });
});
