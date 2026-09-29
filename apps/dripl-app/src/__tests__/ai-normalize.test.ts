import { describe, it, expect } from 'vitest';
import { normalizeModelElements } from '@/lib/ai/normalize';

const rect = (overrides: Record<string, unknown> = {}) => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  ...overrides,
});

describe('normalizeModelElements', () => {
  it('normalizes a well-formed element with defaults', () => {
    const { elements, droppedCount } = normalizeModelElements([rect()]);
    expect(droppedCount).toBe(0);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: rect().id, type: 'rectangle', x: 10, y: 20 });
  });

  it('defaults a missing type to rectangle and drops unknown types', () => {
    const { elements, droppedCount } = normalizeModelElements([
      { ...rect(), type: undefined },
      { ...rect(), id: '223e4567-e89b-42d3-a456-426614174001', type: 'spaceship' },
    ]);
    expect(elements.map(e => e.type)).toEqual(['rectangle']);
    expect(droppedCount).toBe(1);
  });

  it('drops arrows with fewer than two points and caps the element count', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...rect(),
      id: `323e4567-e89b-42d3-a456-42661417${String(i).padStart(4, '0')}`,
    }));
    const { elements, truncatedCount } = normalizeModelElements([
      {
        ...rect(),
        id: '423e4567-e89b-42d3-a456-426614174002',
        type: 'arrow',
        points: [{ x: 0, y: 0 }],
      },
      ...many,
    ]);
    expect(elements.length).toBeLessThanOrEqual(100);
    expect(truncatedCount).toBeGreaterThan(0);
    expect(elements.some(e => e.type === 'arrow')).toBe(false);
  });

  it('wires bound labels to their owner', () => {
    const { elements } = normalizeModelElements([{ ...rect(), text: 'Hello label' }]);
    const label = elements.find(e => e.type === 'text');
    expect(label).toBeDefined();
    const owner = elements.find(e => e.id === rect().id);
    expect(owner?.labelId).toBe(label?.id);
  });

  it('clamps hostile geometry instead of dropping', () => {
    const { elements, droppedCount } = normalizeModelElements([
      rect({ x: 1e12, strokeWidth: 1e6, opacity: 5 }),
    ]);
    expect(droppedCount).toBe(0);
    expect(elements[0]?.x).toBe(100_000);
    expect(elements[0]?.strokeWidth).toBe(20);
    expect(elements[0]?.opacity).toBe(1);
  });
});
