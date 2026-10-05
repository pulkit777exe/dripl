import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoizedSelectionOverlay,
  SelectionOverlay,
  type ResizeHandle,
} from '@/components/canvas/SelectionOverlay';
import type { DriplElement } from '@dripl/common';

/**
 * `selectionOverlay.test.tsx` covers what the overlay *draws*. This file covers
 * the two things it does around the drawing:
 *
 *   1. The memo comparator behind `MemoizedSelectionOverlay`. The overlay sits
 *      over a canvas that re-renders on every pointer sample, so the comparator
 *      is the difference between a smooth drag and a re-render per mousemove.
 *      It has eight independent fields and each one is a *separate* way to be
 *      wrong, so each is exercised on both sides: a changed field must re-render,
 *      and an identical field must not.
 *   2. The two `ne`/`sw` corner handles, which the pre-existing suite skipped by
 *      only pressing `nw` and `se`. A transposed handle id here resizes the
 *      wrong corner, and there is no visual difference to catch it.
 *
 * Render counting needs an observation the DOM cannot give, since a skipped
 * render and a performed render produce the same markup. The component's first
 * statement on every render is `elements.filter(...)`, so a `Proxy` over the
 * array counts renders directly instead of inferring them.
 */

function rect(id: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    // Zero stroke keeps getElementBounds equal to the declared frame.
    strokeWidth: 0,
    opacity: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

function arrow(id: string, points: Array<{ x: number; y: number }>): DriplElement {
  return {
    id,
    type: 'arrow',
    x: 100,
    y: 50,
    width: points[points.length - 1]!.x,
    height: points[points.length - 1]!.y,
    points,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as unknown as DriplElement;
}

type ResizeStart = ReturnType<typeof vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>>;

/**
 * Render counting. The component's first statement on every render is
 * `elements.filter(el => selectedIds.has(el.id))`, so a `Proxy` that counts reads
 * of `filter` counts renders directly -- which is the only way to observe a memo
 * that skipped, since a skipped render and a performed one produce identical DOM.
 *
 * `counted` is used for every array the component might read in a given test, and
 * the counter is module-level, so a test that swaps `elements` for a *new* array
 * still sees the render. `tracked` is the same idea with a per-array reader, for
 * the tests that assert against one specific array.
 */
let renderCount = 0;

function counted<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === 'filter') renderCount += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
}

beforeEach(() => {
  renderCount = 0;
});

function tracked(elements: DriplElement[]): { elements: DriplElement[]; renders: () => number } {
  let filters = 0;
  const proxy = new Proxy(elements, {
    get(target, prop, receiver) {
      if (prop === 'filter') filters += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { elements: proxy, renders: () => filters };
}

type OverlayProps = React.ComponentProps<typeof SelectionOverlay>;

function propsFor(elements: DriplElement[], overrides: Partial<OverlayProps> = {}): OverlayProps {
  return {
    zoom: 1,
    panX: 0,
    panY: 0,
    elements,
    selectedIds: new Set(['a']),
    onResizeStart: vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>(),
    onRotateStart: vi.fn<(e: React.PointerEvent) => void>(),
    marqueeSelection: null,
    ...overrides,
  };
}

/**
 * Props built *once*, so a re-render can hand down a fresh props object while
 * every field keeps its identity. `propsFor` allocates a new `Set` on each call,
 * which is why the skip test cannot use it: a new Set is a changed field, and the
 * comparator is supposed to notice.
 */
function stableProps(elements: DriplElement[]): OverlayProps {
  return propsFor(elements);
}

describe('MemoizedSelectionOverlay comparator', () => {
  // Regression: the memo is what makes the overlay cheap. A comparator that
  // always returned `true` would render the *first* frame and then never again,
  // freezing the selection box in place for the whole session -- the negative
  // side of this test (identical props skip the render) would still pass, which
  // is why the positive side is asserted in every field test below.
  it('re-renders when the viewport changes', () => {
    const { elements, renders } = tracked([rect('a')]);
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const onRotateStart = vi.fn<(e: React.PointerEvent) => void>();
    // Every field except the viewport under test keeps its identity across these
    // renders. `stableProps` is called *once* and its result spread each time:
    // calling it inside `build` would allocate a fresh `selectedIds` Set per
    // render, which invalidates the memo on its own and would make every step
    // below "invalidate" whether or not the comparator looked at the viewport.
    const base = { ...stableProps(elements), onResizeStart, onRotateStart };
    const build = (overrides: Partial<OverlayProps>) => ({ ...base, ...overrides });

    const { rerender } = render(<MemoizedSelectionOverlay {...build({})} />);
    expect(renders()).toBe(1);

    rerender(<MemoizedSelectionOverlay {...build({ zoom: 2 })} />);
    expect(renders()).toBe(2);

    rerender(<MemoizedSelectionOverlay {...build({ zoom: 2, panX: 40 })} />);
    expect(renders()).toBe(3);

    rerender(<MemoizedSelectionOverlay {...build({ zoom: 2, panX: 40, panY: 5 })} />);
    expect(renders()).toBe(4);
  });

  // Regression: a *new but shallow-equal* props object must be skipped. This is
  // the normal case on every canvas re-render: the parent re-renders and hands
  // down a fresh props object, but nothing the overlay draws has changed. If the
  // comparator compared props by identity instead of field by field, this
  // assertion fails -- which is the whole point of a custom comparator.
  it('skips the render when every field is unchanged', () => {
    const { elements, renders } = tracked([rect('a')]);
    const base = stableProps(elements);

    const { rerender } = render(<MemoizedSelectionOverlay {...base} />);
    expect(renders()).toBe(1);

    // A *different* props object every time, spreading the same field values.
    // This is the shape a parent re-render produces, and it is the case the
    // custom comparator exists for: an identity-based comparison would re-render.
    for (let i = 0; i < 3; i += 1) {
      rerender(<MemoizedSelectionOverlay {...{ ...base }} />);
    }
    expect(renders()).toBe(1);
  });

  // Regression: `elements` is compared by *reference*, not by contents. The
  // overlay is not memoised on element content because reading every element
  // would cost more than the render it saves. Asserted as a re-render: a
  // content-comparing comparator here would let a mutated-in-place element
  // render stale geometry.
  it('re-renders when the elements array identity changes', () => {
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const onRotateStart = vi.fn<(e: React.PointerEvent) => void>();

    const first = tracked([rect('a')]);
    const second = tracked([rect('a')]); // same content, new array

    const { rerender } = render(
      <MemoizedSelectionOverlay {...propsFor(first.elements, { onResizeStart, onRotateStart })} />
    );
    expect(first.renders()).toBe(1);

    rerender(
      <MemoizedSelectionOverlay {...propsFor(second.elements, { onResizeStart, onRotateStart })} />
    );
    expect(second.renders()).toBe(1);
  });

  // Regression: `selectedIds` is a Set, and the comparator uses reference
  // equality on it. The store hands out a new Set on every selection change, so
  // this is the comparator's most load-bearing field.
  it('re-renders when the selectedIds set identity changes', () => {
    const { elements, renders } = tracked([rect('a'), rect('b')]);
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const onRotateStart = vi.fn<(e: React.PointerEvent) => void>();

    const { rerender } = render(
      <MemoizedSelectionOverlay
        {...propsFor(elements, {
          onResizeStart,
          onRotateStart,
          selectedIds: new Set(['a']),
        })}
      />
    );
    expect(renders()).toBe(1);

    rerender(
      <MemoizedSelectionOverlay
        {...propsFor(elements, {
          onResizeStart,
          onRotateStart,
          selectedIds: new Set(['a', 'b']),
        })}
      />
    );
    expect(renders()).toBe(2);
  });

  // Regression: the identity-compared fields. Each is a *separate* clause in one
  // long `&&` chain, so each clause is a separate way to be wrong -- and every
  // clause is only load-bearing in the direction "a change here must redraw".
  //
  // The shape matters twice over. Each case re-renders from the *same* baseline
  // with exactly one field replaced: chaining the changes instead (change A, then
  // B, then C) would leave each step also reverting the previous field, so a
  // comparator missing the last clause would still see a difference in the one
  // before it and redraw. And each case skips one baseline re-render first, so a
  // redraw is attributable to the named field rather than to re-rendering at all.
  const identityCases: Array<[string, () => Partial<OverlayProps>]> = [
    ['elements', () => ({ elements: counted([rect('a'), rect('b', { x: 50 })]) })],
    ['selectedIds', () => ({ selectedIds: new Set(['a', 'b']) })],
    [
      'onResizeStart',
      () => ({ onResizeStart: vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>() }),
    ],
    ['onRotateStart', () => ({ onRotateStart: vi.fn<(e: React.PointerEvent) => void>() })],
    [
      'marqueeSelection',
      () => ({ marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, active: false } }),
    ],
    ['zoom', () => ({ zoom: 3 })],
    ['panX', () => ({ panX: 17 })],
    ['panY', () => ({ panY: 23 })],
  ];

  it.each(identityCases)('re-renders when only %s changes', (field, patch) => {
    const base = { ...stableProps(counted([rect('a')])), elements: counted([rect('a')]) };
    const before = renderCount;

    const { rerender } = render(<MemoizedSelectionOverlay {...base} />);
    expect(renderCount - before).toBe(1);

    // Control: re-rendering the same baseline skips.
    rerender(<MemoizedSelectionOverlay {...{ ...base }} />);
    expect(renderCount - before, `baseline re-render must skip`).toBe(1);

    rerender(<MemoizedSelectionOverlay {...{ ...base, ...patch() }} />);
    expect(renderCount - before, `${field} alone must invalidate the memo`).toBe(2);
  });

  // Regression: an *active* marquee makes the component return `null`, but the
  // memo still has to notice the prop change, or the overlay would stay hidden
  // after the drag ends.
  it('recovers from a hidden marquee state when the prop clears', () => {
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const onRotateStart = vi.fn<(e: React.PointerEvent) => void>();
    const marquee = { start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, active: true };

    const { container, rerender } = render(
      <MemoizedSelectionOverlay
        {...propsFor([rect('a')], { onResizeStart, onRotateStart, marqueeSelection: marquee })}
      />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <MemoizedSelectionOverlay
        {...propsFor([rect('a')], {
          onResizeStart,
          onRotateStart,
          marqueeSelection: { ...marquee, active: false },
        })}
      />
    );

    expect(container).not.toBeEmptyDOMElement();
    expect(container.querySelector('.dripl-rotate-handle')).not.toBeNull();
  });
});

describe('SelectionOverlay corner handle identities', () => {
  function renderSingle(onResizeStart: ResizeStart) {
    const utils = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[rect('a')]}
        selectedIds={new Set(['a'])}
        onResizeStart={onResizeStart}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );
    return { ...utils, onResizeStart };
  }

  // Regression: all four corner ids are reachable from the DOM. The pre-existing
  // suite pressed only `nw` and `se`, so `ne` and `sw` could report the wrong id
  // -- which resizes the diagonally opposite corner -- with every other test
  // still green. Each id is asserted against its own DOM class so a transposed
  // class and a transposed id are both caught.
  it('reports the matching id from all four single-selection corners', () => {
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const { container } = renderSingle(onResizeStart);

    const pairs: Array<[string, ResizeHandle]> = [
      ['nw-handle', 'nw'],
      ['ne-handle', 'ne'],
      ['se-handle', 'se'],
      ['sw-handle', 'sw'],
    ];

    for (const [className, expected] of pairs) {
      const node = container.querySelector(`.${className}`) as HTMLElement;
      expect(node).not.toBeNull();
      fireEvent.pointerDown(node);
      const call = onResizeStart.mock.calls.at(-1);
      expect(call?.[0]).toBe(expected);
    }
    expect(onResizeStart).toHaveBeenCalledTimes(4);
  });

  // Regression: the multi-selection group box has its own four handle divs, and
  // they are a *separate* set from the single-selection ones -- different render
  // branch, different JSX. Asserted here for the same reason: a swapped id in
  // the group branch would scale the group's bounding box from the wrong
  // corner.
  it('reports the matching id from all four group-box corners', () => {
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const { container } = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[rect('a'), rect('b', { x: 300, y: 300 })]}
        selectedIds={new Set(['a', 'b'])}
        onResizeStart={onResizeStart}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );

    const pairs: Array<[string, ResizeHandle]> = [
      ['nw-handle', 'nw'],
      ['ne-handle', 'ne'],
      ['se-handle', 'se'],
      ['sw-handle', 'sw'],
    ];

    for (const [className, expected] of pairs) {
      const node = container.querySelector(`.${className}`) as HTMLElement;
      expect(node).not.toBeNull();
      fireEvent.pointerDown(node);
      expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe(expected);
    }
    expect(onResizeStart).toHaveBeenCalledTimes(4);
  });

  // Regression: the group box carries an *axis-aligned* dashed border, not the
  // per-element rotated frame. That asymmetry is the point of the multi branch:
  // resizing the group box stretches the union, whereas the per-element frames
  // are drawn for reference only. Asserted so a refactor that reuses the
  // single-selection frame for the group is caught.
  it('keeps the group box unrotated and dashed while elements carry solid frames', () => {
    const { container } = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[rect('a', { angle: Math.PI / 6 }), rect('b', { x: 300, y: 300 })]}
        selectedIds={new Set(['a', 'b'])}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );

    const box = container.querySelector<HTMLElement>('div[style*="dashed"]');
    expect(box).not.toBeNull();
    expect(box?.style.transform).toBe('');

    // The per-element reference frames sit below the box in stacking order and
    // are rotated with their element.
    const individual = container.querySelector<HTMLElement>('div[style*="opacity: 0.45"]');
    expect(individual).not.toBeNull();
    expect(individual?.style.transform).toBe(`translate(-50%, -50%) rotate(${Math.PI / 6}rad)`);
    expect(individual?.style.zIndex).toBe('9');
    expect(box?.style.zIndex).toBe('10');
  });
});

describe('SelectionOverlay visibility guards', () => {
  // Regression: the three early returns sit in front of every branch below, so a
  // guard that stopped working would fall through into the single-selection path
  // with `selected[0] === undefined` and throw on `el.type`. Pinned here because
  // the comparator tests above only ever render with a live selection -- a
  // comparator file that never exercised the guards could not tell the difference.
  //
  // Each case asserts an *empty* container. That is not vacuous: the three cases
  // differ only in the input, so a component that returned a frame for all three
  // would fail.
  it('renders nothing for an empty selection, an absent element, or an active marquee', () => {
    const emptySelection = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[rect('a')]}
        selectedIds={new Set()}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );
    expect(emptySelection.container).toBeEmptyDOMElement();
    emptySelection.unmount();

    const missingElement = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[]}
        selectedIds={new Set(['ghost'])}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );
    expect(missingElement.container).toBeEmptyDOMElement();
    missingElement.unmount();

    const marqueeActive = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[rect('a')]}
        selectedIds={new Set(['a'])}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
        marqueeSelection={{ start: { x: 0, y: 0 }, end: { x: 9, y: 9 }, active: true }}
      />
    );
    expect(marqueeActive.container).toBeEmptyDOMElement();

    // ...and the same marquee with `active: false` renders, so the three cases are
    // separated by the guard rather than by the component being broken.
    marqueeActive.rerender(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[rect('a')]}
        selectedIds={new Set(['a'])}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
        marqueeSelection={{ start: { x: 0, y: 0 }, end: { x: 9, y: 9 }, active: false }}
      />
    );
    expect(marqueeActive.container).not.toBeEmptyDOMElement();
  });
});

describe('SelectionOverlay linear handle hit targets', () => {
  const polyline = arrow('line-1', [
    { x: 0, y: 0 },
    { x: 40, y: 20 },
    { x: 90, y: 0 },
    { x: 140, y: 60 },
  ]);

  function renderLine() {
    const onResizeStart = vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>();
    const utils = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[polyline]}
        selectedIds={new Set(['line-1'])}
        onResizeStart={onResizeStart}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );
    return { ...utils, onResizeStart };
  }

  // Regression: the three handle kinds are *distinguished by their class*, and
  // the class is what carries the interaction affordance -- endpoints move,
  // midpoints are drag targets, inserts add a point. The CSS in the injected
  // stylesheet sets `pointer-events: none` on the midpoint handle, so the class
  // is load-bearing rather than cosmetic. One test per kind, each asserting its
  // own class, so a class swap cannot pass on the strength of the count.
  it('gives endpoints, midpoints and inserts three distinct classes and hit targets', () => {
    const { container, onResizeStart } = renderLine();

    const endpoints = container.querySelectorAll<HTMLElement>('.dripl-linear-handle');
    const mids = container.querySelectorAll<HTMLElement>('.dripl-linear-mid-handle');
    const inserts = container.querySelectorAll<HTMLElement>('.dripl-linear-insert-handle');
    // 4 points -> 2 endpoints, 2 midpoints, 3 inserts.
    expect(endpoints).toHaveLength(2);
    expect(mids).toHaveLength(2);
    expect(inserts).toHaveLength(3);

    // The insert handles carry a visible '+' affordance; the other two do not.
    for (const node of inserts) expect(node).toHaveTextContent('+');
    for (const node of [...endpoints, ...mids]) expect(node.textContent).toBe('');

    // Every handle reports the id its class implies.
    fireEvent.pointerDown(endpoints[0]!);
    expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe('arrow-start');
    fireEvent.pointerDown(endpoints[1]!);
    expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe('arrow-end');
    fireEvent.pointerDown(mids[0]!);
    expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe('arrow-point-1');
    fireEvent.pointerDown(mids[1]!);
    expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe('arrow-point-2');
    fireEvent.pointerDown(inserts[0]!);
    expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe('arrow-insert-1');
    fireEvent.pointerDown(inserts[2]!);
    expect(onResizeStart.mock.calls.at(-1)?.[0]).toBe('arrow-insert-3');
  });

  // Regression: the insert handles are only ever shown for a polyline with more
  // than one point, because an insert between zero segments is meaningless. The
  // `points.length < 2` early return is the guard. Asserted as an emptiness
  // count with the container present as the ungated sibling control -- a stubbed
  // child returning `null` would make "nothing rendered" vacuous.
  it('renders an empty handle set for a single-point linear element', () => {
    const { container } = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[arrow('line-1', [{ x: 0, y: 0 }])]}
        selectedIds={new Set(['line-1'])}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );

    // The linear container itself is still rendered -- just with no handles.
    const box = container.firstElementChild as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.borderStyle).toBe('');
    expect(container.querySelectorAll('[class*="dripl-linear"]')).toHaveLength(0);
  });

  // Unreachability note for the insert loop's `if (!pt1 || !pt2) continue`.
  //
  // The loop bound `i < points.length - 1` already guarantees both indices, so the
  // guard can only fire for a *sparse* array -- and a sparse `points` array never
  // reaches it, because `getElementBounds` iterates the same array with `map`/
  // `reduce` and throws on the hole first (`packages/math/src/intersection.ts`,
  // `computeElementBounds`). Zod's `z.array` also produces dense arrays.
  //
  // Proven one-directionally by mutation: replacing the guard with `throw` changes
  // no observation in this file (mutation N22). The test below is the nearest
  // reachable neighbour -- the missing-`points` case, where the *earlier* guard
  // fires and the loop never runs at all.

  // Regression: `'points' in el` is the other half of that guard. A `line`
  // element that has not been given its `points` array yet must still render the
  // container without throwing, rather than reaching `el.points.length`.
  it('tolerates a linear element with no points property at all', () => {
    const bare = {
      ...rect('line-1'),
      type: 'line',
    } as DriplElement;

    const { container } = render(
      <SelectionOverlay
        zoom={1}
        panX={0}
        panY={0}
        elements={[bare]}
        selectedIds={new Set(['line-1'])}
        onResizeStart={vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>()}
        onRotateStart={vi.fn<(e: React.PointerEvent) => void>()}
      />
    );

    expect(container.firstElementChild).not.toBeNull();
    expect(container.querySelectorAll('[class*="dripl-linear"]')).toHaveLength(0);
  });

  // Regression: handle positions are relative to the polyline's bounding box,
  // not to the canvas, and endpoints are offset by 6px (half a 12px handle)
  // while non-endpoints use 5px. Asserted for both kinds because a shared offset
  // shifts every endpoint by a pixel without changing any count.
  it('centres each handle on its point using the per-kind offset', () => {
    const { container } = renderLine();

    const start = container.querySelector<HTMLElement>('.dripl-linear-handle');
    const mid = container.querySelector<HTMLElement>('.dripl-linear-mid-handle');
    const insert = container.querySelector<HTMLElement>('.dripl-linear-insert-handle');
    expect(start).not.toBeNull();
    expect(mid).not.toBeNull();
    expect(insert).not.toBeNull();

    // The 2px stroke puts the bounds at x 99, y 49, so the first point's
    // in-box position is (1, 1) and the endpoint's 6px offset puts it at -5.
    expect(parseFloat(start!.style.left)).toBeCloseTo(1 - 6, 6);
    expect(parseFloat(start!.style.top)).toBeCloseTo(1 - 6, 6);
    // Non-endpoints use the 5px offset instead: the second point sits at x 41
    // in-box, and the first insert handle at the midpoint x 21. A shared offset
    // would break these two without changing any handle count.
    expect(parseFloat(mid!.style.left)).toBeCloseTo(41 - 5, 6);
    expect(parseFloat(insert!.style.left)).toBeCloseTo(21 - 5, 6);
  });
});
