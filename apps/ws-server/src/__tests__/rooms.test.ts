import { describe, expect, it } from 'vitest';
import { parseStoredElements } from '../rooms';

describe('stored room scene parsing', () => {
  it('normalizes legacy boolean arrowheads before schema validation', () => {
    const elements = parseStoredElements(
      JSON.stringify([
        {
          id: 'legacy-arrow',
          type: 'arrow',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 50 },
          ],
          arrowHeads: { start: false, end: true },
        },
      ])
    );

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      id: 'legacy-arrow',
      arrowHeads: { start: 'none', end: 'triangle' },
    });
  });

  it('drops invalid stored elements instead of trusting persisted JSON', () => {
    const elements = parseStoredElements(
      JSON.stringify([
        { id: 'valid', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
        { id: 'invalid', type: 'rectangle', x: 0, y: 0, width: Number.NaN, height: 10 },
      ])
    );

    expect(elements.map(element => element.id)).toEqual(['valid']);
  });
});
