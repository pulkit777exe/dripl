import { describe, it, expect, beforeEach } from 'vitest';
import type { LinearElement, DriplElement } from '@dripl/common';
import {
  findBindableElementAtPoint,
  bindArrowToElement,
  unbindArrowFromElement,
  unbindAffectedByDeletion,
} from '../arrow-binding';
import { repairBindings } from '@dripl/common/arrow-binding';

let idCounter = 0;

function resetIdCounter() {
  idCounter = 0;
}

function createRectangleElement(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: `rect-${idCounter++}`,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    ...overrides,
  };
}

function createArrowElement(
  points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }, { x: 100, y: 100 }],
  overrides: Partial<DriplElement> = {}
): DriplElement {
  return {
    id: `arrow-${idCounter++}`,
    type: 'arrow',
    x: points[0]?.x ?? 0,
    y: points[0]?.y ?? 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    points,
    ...overrides,
  };
}

beforeEach(() => {
  resetIdCounter();
});

describe('findBindableElementAtPoint', () => {
  it('finds nearby shape within threshold', () => {
    const rect = createRectangleElement({ id: 'r1', x: 0, y: 0, width: 100, height: 100 });
    const result = findBindableElementAtPoint({ x: 50, y: 50 }, [rect], 'other');
    expect(result?.id).toBe('r1');
  });

  it('returns null when no shape nearby', () => {
    const rect = createRectangleElement({ id: 'r1', x: 0, y: 0, width: 100, height: 100 });
    const result = findBindableElementAtPoint({ x: 500, y: 500 }, [rect], 'other');
    expect(result).toBeNull();
  });

  it('prefers smaller shape on overlap', () => {
    const big = createRectangleElement({ id: 'big', x: 0, y: 0, width: 200, height: 200 });
    const small = createRectangleElement({ id: 'small', x: 50, y: 50, width: 50, height: 50 });
    const result = findBindableElementAtPoint({ x: 75, y: 75 }, [big, small], 'other');
    expect(result?.id).toBe('small');
  });

  it('excludes specified element', () => {
    const rect = createRectangleElement({ id: 'r1', x: 0, y: 0, width: 100, height: 100 });
    const result = findBindableElementAtPoint({ x: 50, y: 50 }, [rect], 'r1');
    expect(result).toBeNull();
  });

  it('skips non-bindable types', () => {
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 100, y: 100 }], { id: 'a1' });
    const result = findBindableElementAtPoint({ x: 50, y: 50 }, [arrow], 'other');
    expect(result).toBeNull();
  });

  it('skips deleted elements', () => {
    const rect = createRectangleElement({ id: 'r1', x: 0, y: 0, width: 100, height: 100, isDeleted: true });
    const result = findBindableElementAtPoint({ x: 50, y: 50 }, [rect], 'other');
    expect(result).toBeNull();
  });
});

describe('bindArrowToElement', () => {
  it('creates bidirectional binding', () => {
    const rect = createRectangleElement({ id: 'r1' });
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }) as LinearElement;
    const result = bindArrowToElement(arrow, 'r1', 'end', { x: 0.5, y: 0.5 }, 'orbit', [rect, arrow]);

    const a = result.find(e => e.id === 'a1') as LinearElement;
    const r = result.find(e => e.id === 'r1');

    expect(a.endBinding).toEqual({ elementId: 'r1', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' });
    expect((r as any).boundElements).toContainEqual({ id: 'a1', type: 'arrow' });
  });

  it('does not duplicate boundElements entry', () => {
    const rect = createRectangleElement({ id: 'r1', boundElements: [{ id: 'a1', type: 'arrow' }] } as any);
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }) as LinearElement;
    const result = bindArrowToElement(arrow, 'r1', 'start', { x: 0.5, y: 0.5 }, 'orbit', [rect, arrow]);

    const r = result.find(e => e.id === 'r1');
    const bounds = (r as any).boundElements;
    expect(bounds.filter((b: any) => b.id === 'a1')).toHaveLength(1);
  });

  it('sets binding even if target not found (deferred validation)', () => {
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }) as LinearElement;
    const result = bindArrowToElement(arrow, 'nonexistent', 'end', { x: 0.5, y: 0.5 }, 'orbit', [arrow]);
    const a = result.find(e => e.id === 'a1') as LinearElement;
    expect(a.endBinding).toEqual({ elementId: 'nonexistent', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' });
  });

  it('sets startBinding correctly', () => {
    const rect = createRectangleElement({ id: 'r1' });
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }) as LinearElement;
    const result = bindArrowToElement(arrow, 'r1', 'start', { x: 0.2, y: 0.3 }, 'inside', [rect, arrow]);

    const a = result.find(e => e.id === 'a1') as LinearElement;
    expect(a.startBinding).toEqual({ elementId: 'r1', fixedPoint: { x: 0.2, y: 0.3 }, mode: 'inside' });
  });
});

describe('unbindArrowFromElement', () => {
  it('removes binding cleanly', () => {
    const rect = createRectangleElement({ id: 'r1', boundElements: [{ id: 'a1', type: 'arrow' }] } as any);
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      endBinding: { elementId: 'r1', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = unbindArrowFromElement(arrow, 'end', [rect, arrow]);
    const a = result.find(e => e.id === 'a1') as LinearElement;
    const r = result.find(e => e.id === 'r1');

    expect(a.endBinding).toBeNull();
    expect((r as any).boundElements).toEqual([]);
  });

  it('does not remove from boundElements if other end bound to same element', () => {
    const rect = createRectangleElement({ id: 'r1', boundElements: [{ id: 'a1', type: 'arrow' }] } as any);
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      startBinding: { elementId: 'r1', fixedPoint: { x: 0, y: 0 }, mode: 'orbit' as const },
      endBinding: { elementId: 'r1', fixedPoint: { x: 1, y: 1 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = unbindArrowFromElement(arrow, 'start', [rect, arrow]);
    const r = result.find(e => e.id === 'r1');
    expect((r as any).boundElements).toContainEqual({ id: 'a1', type: 'arrow' });
  });

  it('returns original elements if no binding exists', () => {
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }) as LinearElement;
    const result = unbindArrowFromElement(arrow, 'end', [arrow]);
    expect(result).toEqual([arrow]);
  });

  it('returns original elements if target not found', () => {
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      endBinding: { elementId: 'nonexistent', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = unbindArrowFromElement(arrow, 'end', [arrow]);
    const a = result.find(e => e.id === 'a1') as LinearElement;
    expect(a.endBinding).toBeNull();
  });
});

describe('unbindAffectedByDeletion', () => {
  it('unbinds arrow when bound shape is deleted', () => {
    const rect = createRectangleElement({ id: 'r1', boundElements: [{ id: 'a1', type: 'arrow' }] } as any);
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      endBinding: { elementId: 'r1', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = unbindAffectedByDeletion(['r1'], [rect, arrow]);
    const a = result.find(e => e.id === 'a1') as LinearElement;

    expect(a.endBinding).toBeNull();
    expect(a.isDeleted).toBeFalsy();
  });

  it('does not affect unbound arrows', () => {
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }) as LinearElement;
    const result = unbindAffectedByDeletion(['r1'], [arrow]);
    expect(result).toEqual([arrow]);
  });

  it('unbinds both ends if both targets deleted', () => {
    const rect1 = createRectangleElement({ id: 'r1', boundElements: [{ id: 'a1', type: 'arrow' }] } as any);
    const rect2 = createRectangleElement({ id: 'r2', boundElements: [{ id: 'a1', type: 'arrow' }] } as any);
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      startBinding: { elementId: 'r1', fixedPoint: { x: 0, y: 0 }, mode: 'orbit' as const },
      endBinding: { elementId: 'r2', fixedPoint: { x: 1, y: 1 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = unbindAffectedByDeletion(['r1', 'r2'], [rect1, rect2, arrow]);
    const a = result.find(e => e.id === 'a1') as LinearElement;

    expect(a.startBinding).toBeNull();
    expect(a.endBinding).toBeNull();
    expect(a.isDeleted).toBeFalsy();
  });
});

describe('repairBindings', () => {
  it('removes binding to non-existent element', () => {
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      endBinding: { elementId: 'deleted', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = repairBindings([arrow]);
    const a = result[0] as LinearElement;
    expect(a.endBinding).toBeUndefined();
  });

  it('removes stale boundElements entries', () => {
    const rect = createRectangleElement({
      id: 'r1',
      boundElements: [
        { id: 'deleted', type: 'arrow' },
        { id: 'a1', type: 'arrow' },
      ],
    } as any);
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' });

    const result = repairBindings([rect, arrow]);
    const r = result.find(e => e.id === 'r1');
    expect((r as any).boundElements).toEqual([{ id: 'a1', type: 'arrow' }]);
  });

  it('deduplicates boundElements', () => {
    const rect = createRectangleElement({
      id: 'r1',
      boundElements: [
        { id: 'a1', type: 'arrow' },
        { id: 'a1', type: 'arrow' },
      ],
    } as any);
    const arrow = createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' });

    const result = repairBindings([rect, arrow]);
    const r = result.find(e => e.id === 'r1');
    expect((r as any).boundElements).toHaveLength(1);
  });

  it('preserves valid bindings', () => {
    const rect = createRectangleElement({
      id: 'r1',
      boundElements: [{ id: 'a1', type: 'arrow' }],
    } as any);
    const arrow = {
      ...createArrowElement([{ x: 0, y: 0 }, { x: 50, y: 50 }], { id: 'a1' }),
      endBinding: { elementId: 'r1', fixedPoint: { x: 0.5, y: 0.5 }, mode: 'orbit' as const },
    } as unknown as LinearElement;

    const result = repairBindings([rect, arrow]);
    const a = result.find(e => e.id === 'a1') as LinearElement;
    const r = result.find(e => e.id === 'r1');

    expect(a.endBinding?.elementId).toBe('r1');
    expect((r as any).boundElements).toEqual([{ id: 'a1', type: 'arrow' }]);
  });
});
