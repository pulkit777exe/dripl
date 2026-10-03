import { describe, expect, it } from 'vitest';
import { isBindableElement, repairBindings } from '../arrow-binding';
import { collectCascadeDeleteIds } from '../cascade-delete';
import type {
  DriplElement,
  LinearElement,
  NormalizedBinding,
  RectangleElement,
  TextElement,
} from '../types/element';

/**
 * Coverage for `packages/common`'s two load-time / delete-time helpers.
 *
 * `isBindableElement` and `collectCascadeDeleteIds` had no direct tests at all.
 * That matters more than the raw numbers suggest: `repairBindings` runs on the
 * **server** admission path (`apps/ws-server/src/rooms.ts`, on every parsed
 * scene) as well as on client load, and `collectCascadeDeleteIds` decides what
 * gets deleted. A silent wrong answer in either is data loss or a corrupt room,
 * not a cosmetic bug.
 */

type RectExtras = { boundElements?: NonNullable<RectangleElement['boundElements']> };
type LinearExtras = {
  labelId?: string;
  startBinding?: NormalizedBinding;
  endBinding?: NormalizedBinding;
};
type TextExtras = { containerId?: string; boundElementId?: string };

function rect(id: string, extras: RectExtras = {}): RectangleElement {
  return { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, ...extras };
}

function linear(id: string, extras: LinearExtras = {}): LinearElement {
  return { id, type: 'arrow', x: 0, y: 0, width: 10, height: 10, points: [], ...extras };
}

function text(id: string, extras: TextExtras = {}): TextElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    text: 'label',
    fontSize: 20,
    fontFamily: 'Virgil',
    ...extras,
  };
}

/** A binding as the type actually declares it: elementId + fixedPoint + mode. */
function binding(elementId: string): NormalizedBinding {
  return { elementId, fixedPoint: { x: 0, y: 0 }, mode: 'orbit' };
}

/** Any element type, for the bindable-set assertions. */
function anyType(type: string, id = 'e'): DriplElement {
  return { ...rect(id), type } as unknown as DriplElement;
}

describe('isBindableElement', () => {
  // The bindable set is a product decision, not an implementation detail: an
  // arrow may bind to a shape but not to text, and `frame` was added later.
  // These assertions exist so changing the set is a deliberate act.
  it.each(['rectangle', 'ellipse', 'diamond', 'image', 'frame'] as const)(
    'treats %s as bindable',
    type => {
      expect(isBindableElement(anyType(type))).toBe(true);
    }
  );

  it.each(['text', 'embed', 'freedraw', 'arrow', 'line'] as const)(
    'treats %s as NOT bindable',
    type => {
      expect(isBindableElement(anyType(type))).toBe(false);
    }
  );
});

describe('collectCascadeDeleteIds', () => {
  it('returns nothing for no seeds, without scanning', () => {
    expect(collectCascadeDeleteIds([], [rect('r')])).toEqual([]);
  });

  it('returns a seed that has no matching element', () => {
    // A delete request can name an id the scene no longer contains (stale
    // selection, concurrent delete). Dropping it silently would leave the
    // caller believing a deletion happened.
    expect(collectCascadeDeleteIds(['ghost'], [rect('r')])).toEqual(['ghost']);
  });

  it('deduplicates seeds', () => {
    expect(collectCascadeDeleteIds(['r', 'r', 'r'], [rect('r')])).toEqual(['r']);
  });

  it('cascades an arrow to its label', () => {
    const ids = collectCascadeDeleteIds(['a'], [linear('a', { labelId: 'lbl' }), text('lbl')]);
    expect(ids).toContain('lbl');
  });

  it('cascades a line to its label, not just an arrow', () => {
    const ids = collectCascadeDeleteIds(
      ['l'],
      [{ ...linear('l', { labelId: 'lbl' }), type: 'line' }, text('lbl')]
    );
    expect(ids).toContain('lbl');
  });

  it('cascades text bound to a deleted container', () => {
    const ids = collectCascadeDeleteIds(['r'], [rect('r'), text('t', { containerId: 'r' })]);
    expect(ids).toContain('t');
  });

  it('leaves text alone when its container survives', () => {
    const ids = collectCascadeDeleteIds(
      ['r'],
      [rect('r'), rect('keep'), text('t', { containerId: 'keep' })]
    );
    expect(ids).not.toContain('t');
  });

  /**
   * The reason the implementation loops until nothing changes rather than
   * making a single pass. With the elements ordered child-before-parent, one
   * pass sees that `t`'s container `c` is not yet marked for deletion and stops
   * early, leaving `t` behind even though the whole chain is going away. The
   * ordering below is deliberately adversarial for that single-pass version.
   */
  it('follows a multi-level text chain regardless of array order', () => {
    const chain = [text('t', { containerId: 'c' }), text('c', { containerId: 'r' }), rect('r')];
    expect(collectCascadeDeleteIds(['r'], chain).sort()).toEqual(['c', 'r', 't']);

    const reversed = [rect('r'), text('c', { containerId: 'r' }), text('t', { containerId: 'c' })];
    expect(collectCascadeDeleteIds(['r'], reversed).sort()).toEqual(['c', 'r', 't']);
  });

  it('cascades through an arrow label that is itself bound to a deleted shape', () => {
    const ids = collectCascadeDeleteIds(
      ['r'],
      [rect('r'), linear('a', { labelId: 'lbl' }), text('lbl', { containerId: 'r' }), text('a')]
    );
    expect(ids).toContain('lbl');
  });

  it('reaches a fixpoint on a binding cycle instead of looping forever', () => {
    // `a -> b -> c -> a`. Seeding `a` legitimately cascades to `b` and then `c`,
    // and the closing reference back to `a` adds nothing new. The loop therefore
    // terminates only because it stops when a full pass adds no id — a version
    // that did not check for a fixpoint would not return at all.
    const cycle = [
      text('a', { containerId: 'b' }),
      text('b', { containerId: 'c' }),
      text('c', { containerId: 'a' }),
    ];
    expect(collectCascadeDeleteIds(['a'], cycle).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('repairBindings', () => {
  it('keeps a binding whose target is present', () => {
    const target = binding('r');
    const [arrow] = repairBindings([linear('a', { startBinding: target }), rect('r')]);
    expect(arrow?.startBinding).toEqual(target);
  });

  it('clears a start binding whose target is gone', () => {
    const [arrow] = repairBindings([linear('a', { startBinding: binding('ghost') })]);
    expect(arrow?.startBinding).toBeUndefined();
  });

  it('clears an end binding whose target is gone', () => {
    const [arrow] = repairBindings([linear('a', { endBinding: binding('ghost') })]);
    expect(arrow?.endBinding).toBeUndefined();
  });

  it('clears both bindings independently', () => {
    const [arrow] = repairBindings([
      linear('a', {
        startBinding: binding('ghost'),
        endBinding: binding('r'),
      }),
      rect('r'),
    ]);
    const a = arrow as LinearElement;
    expect(a.startBinding).toBeUndefined();
    expect(a.endBinding).toEqual(binding('r'));
  });

  it('removes stale and duplicate boundElements entries', () => {
    // `ghost` is dropped because no such element is in the scene, and the
    // repeated `a` collapses to one entry. Both the duplicate and the stale
    // checks read the same `elementsById`, so `a` only survives because the
    // arrow is actually present below.
    const [r] = repairBindings([
      rect('r', {
        boundElements: [
          { id: 'a', type: 'arrow' },
          { id: 'a', type: 'arrow' },
          { id: 'ghost', type: 'text' },
        ],
      }),
      linear('a'),
    ]);
    expect(r?.boundElements).toEqual([{ id: 'a', type: 'arrow' }]);
  });

  it('leaves an empty boundElements array alone', () => {
    const [r] = repairBindings([rect('r', { boundElements: [] })]);
    expect(r?.boundElements).toEqual([]);
  });

  it('ignores non-linear elements carrying start/end bindings', () => {
    // Only arrows and lines have bindings. A stray key on a rectangle is not
    // this function's business, and must not be stripped.
    const odd = { ...rect('r'), startBinding: binding('ghost') };
    const [out] = repairBindings([odd as DriplElement]);
    expect(out?.startBinding).toEqual(binding('ghost'));
  });

  /**
   * This runs on the ws-server admission path, so applying it twice must not
   * differ from applying it once — a repair pass that is not idempotent would
   * make load results depend on how many times a scene round-tripped.
   */
  it('is idempotent', () => {
    const scene = [
      rect('r', {
        boundElements: [
          { id: 'a', type: 'arrow' },
          { id: 'a', type: 'arrow' },
          { id: 'ghost', type: 'text' },
        ],
      }),
      linear('a', {
        startBinding: binding('ghost'),
        endBinding: binding('r'),
        labelId: 'lbl',
      }),
      text('lbl'),
    ];
    const once = repairBindings(scene);
    const twice = repairBindings(once);
    expect(twice).toEqual(once);
  });

  it('does not add a back-reference that the arrow claims but the target lacks', () => {
    // Pinned deliberately: the function removes stale `boundElements` but never
    // adds missing ones, so the two directions can legitimately disagree after
    // a repair. Documented here so a future "fix" is a conscious change.
    const [r, arrow] = repairBindings([rect('r'), linear('a', { startBinding: binding('r') })]);
    expect(arrow?.startBinding).toBeDefined();
    expect(r?.boundElements).toBeUndefined();
  });
});
