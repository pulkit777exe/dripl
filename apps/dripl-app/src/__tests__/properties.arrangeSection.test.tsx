import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { ArrangeSection } from '@/components/canvas/properties/ArrangeSection';
import type { DriplElement } from '@dripl/common';

/**
 * `ArrangeSection` is the multi-selection arrange grid: six align buttons in a
 * 3x2 grid and two distribute buttons beneath it.
 *
 * `propertiesPanel.test.tsx` asserts that the grid *appears* for two or more
 * selections and clicks the first of the two "Align left" buttons on screen. That
 * click may well be the single-selection `AlignSection`, not this grid, so nothing
 * in the repo currently proves which store method each of these eight buttons
 * calls. Since all eight render as one-letter buttons with nothing but a `title`
 * and an `aria-label` to tell them apart, a transposed handler here would be
 * completely invisible -- which is what this file exists to rule out.
 *
 * Two things are asserted per control:
 *   - the *label* contract. The horizontal-centre button says "Align horizontal
 *     centers" while the vertical one says "Align vertical centers"; both are also
 *     titled "Align center"/"Align middle". Getting the pair the wrong way round
 *     would put "vertical centers" on the horizontal button.
 *   - the *outcome*, read back off the store's geometry rather than off a spy, so
 *     the assertion is about the alignment the user gets.
 */

function element(id: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: 'solid',
    version: 1,
    versionNonce: 1,
    fractionalIndex: `a${id}`,
    ...overrides,
  } as DriplElement;
}

/**
 * The arrange grid is rendered only for multi-selections, so the store is seeded
 * with the selection each test needs. Positions are staggered on both axes so a
 * horizontal and a vertical alignment can never produce the same geometry.
 */
function seed(elements: DriplElement[]) {
  act(() => {
    useCanvasStore.setState({
      elements: [],
      elementsById: new Map(),
      past: [],
      future: [],
      spatialVersion: 0,
      spatialChangedIds: [],
      spatialChangedIdsVersion: 0,
    });
    useCanvasStore.getState().setElements(elements, { skipHistory: true });
    useCanvasStore.getState().setSelectedIds(new Set(elements.map(el => el.id)));
  });
}

/** Three staggered boxes, enough for distribute to be meaningful. */
function trio() {
  return [
    element('a', { x: 0, y: 0, width: 40, height: 40 }),
    element('b', { x: 200, y: 300, width: 80, height: 20 }),
    element('c', { x: 500, y: 100, width: 20, height: 60 }),
  ];
}

function byId(id: string) {
  const found = useCanvasStore.getState().elements.find(el => el.id === id);
  if (!found) throw new Error(`element ${id} is missing from the store`);
  return found;
}

beforeEach(() => {
  useCanvasStore.setState({ canvasBackground: null });
});

describe('ArrangeSection grid structure', () => {
  // Regression: the section is a labelled `<section>`, and
  // `PropertiesPanel`'s "is the arrange grid visible" gate queries exactly that
  // label. Changing the label string would silently hide the grid for every
  // multi-selection -- the panel would render nothing and no error anywhere.
  it('exposes the section by the label the panel gates on', () => {
    seed(trio());
    render(<ArrangeSection />);

    expect(screen.getByLabelText('Align and distribute selected elements')).toBeInTheDocument();
    expect(screen.getByText('Arrange')).toBeInTheDocument();
  });

  // Regression: the eight buttons are letter-only, so `title` *and* `aria-label`
  // are the only way they are distinguishable. Each is asserted as a pair, and
  // the four that share a word ("center"/"centers", "middle") are pinned
  // individually -- the horizontal/vertical pair is precisely where a swap would
  // be invisible to a substring query.
  it('gives every button a matching title and accessible label', () => {
    seed(trio());
    render(<ArrangeSection />);

    const expected: Array<[string, string, string]> = [
      // [label, title, visible text]
      ['Align left', 'Align left', 'L'],
      ['Align horizontal centers', 'Align horizontal centers', 'C'],
      ['Align right', 'Align right', 'R'],
      ['Align top', 'Align top', 'T'],
      ['Align vertical centers', 'Align vertical centers', 'M'],
      ['Align bottom', 'Align bottom', 'B'],
      ['Distribute horizontally', 'Distribute horizontally', 'Distribute H'],
      ['Distribute vertically', 'Distribute vertically', 'Distribute V'],
    ];

    for (const [label, title, text] of expected) {
      const button = screen.getByRole('button', { name: label });
      expect(button.getAttribute('title')).toBe(title);
      expect(button).toHaveTextContent(text);
    }
    // Exactly eight buttons -- a duplicated or dropped control would change this.
    expect(screen.getAllByRole('button')).toHaveLength(8);
  });

  // Regression: the grid layout is three columns for the six align buttons and two
  // for the two distribute buttons. The column count is what makes the 3x2 grid
  // readable, and a wrong value would reflow it into a single column on narrow
  // panels.
  it('lays the controls out as a 3x2 grid above a 2-column distribute row', () => {
    seed(trio());
    const { container } = render(<ArrangeSection />);

    const grids = container.querySelectorAll('div.grid');
    expect(grids).toHaveLength(2);
    expect(grids[0]?.className).toContain('grid-cols-3');
    expect(grids[1]?.className).toContain('grid-cols-2');
    // The align grid holds six buttons, the distribute row two.
    expect(grids[0]?.querySelectorAll('button')).toHaveLength(6);
    expect(grids[1]?.querySelectorAll('button')).toHaveLength(2);
  });

  // Regression: every button carries `type="button"`. Without it a button inside
  // the properties `<form>` would submit on click -- and the grid is rendered
  // inside that form by `PropertiesPanel`. Asserted by counting, since a single
  // missing one is a one-character fix with a whole-form failure mode.
  it('marks every button type=button so none can submit a form', () => {
    seed(trio());
    render(<ArrangeSection />);

    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});

describe('ArrangeSection horizontal alignment', () => {
  // Regression: "Align left" collapses every left edge onto the selection's
  // minimum x. Asserted on the actual x values -- a handler wired to a vertical
  // mode would leave the x's untouched and be caught here.
  it('aligns left edges', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));

    expect(new Set(useCanvasStore.getState().elements.map(el => el.x)).size).toBe(1);
    expect(byId('a').x).toBe(0);
  });

  // Regression: "Align horizontal centers" collapses the *centres* (x + w/2), not
  // the left edges. The two differ because the trio has three different widths --
  // a test that aligned left edges here would still see three distinct values, so
  // asserting a single distinct centre is what distinguishes the two modes.
  it('aligns horizontal centres', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align horizontal centers' }));

    const centres = useCanvasStore.getState().elements.map(el => el.x + el.width / 2);
    expect(new Set(centres).size).toBe(1);
    // Left edges must remain distinct -- the mode moved centres, not edges.
    expect(new Set(useCanvasStore.getState().elements.map(el => el.x)).size).toBe(3);
  });

  // Regression: "Align right" collapses every right edge (x + w).
  it('aligns right edges', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

    const rights = useCanvasStore.getState().elements.map(el => el.x + el.width);
    expect(new Set(rights).size).toBe(1);
  });
});

describe('ArrangeSection vertical alignment', () => {
  // Regression: "Align top" collapses every top edge. The trio's y values are
  // staggered independently of x, so a handler wired to a horizontal mode would
  // leave these three distinct.
  it('aligns top edges', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align top' }));

    expect(new Set(useCanvasStore.getState().elements.map(el => el.y)).size).toBe(1);
    expect(byId('a').y).toBe(0);
  });

  // Regression: "Align vertical centers" collapses y + h/2. The heights differ
  // across the trio, so the distinction from top-alignment is observable.
  it('aligns vertical centres', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align vertical centers' }));

    const middles = useCanvasStore.getState().elements.map(el => el.y + el.height / 2);
    expect(new Set(middles).size).toBe(1);
    // Top edges stay distinct.
    expect(new Set(useCanvasStore.getState().elements.map(el => el.y)).size).toBe(3);
  });

  // Regression: "Align bottom" collapses every bottom edge (y + h).
  it('aligns bottom edges', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align bottom' }));

    const bottoms = useCanvasStore.getState().elements.map(el => el.y + el.height);
    expect(new Set(bottoms).size).toBe(1);
  });

  // Regression: the horizontal and vertical modes are genuinely independent --
  // aligning horizontally must not disturb y at all. Asserted on the full y
  // vector before and after, which is what rules out a handler that passed the
  // wrong mode string *and* happened to still produce a valid alignment.
  it('leaves the other axis untouched', () => {
    seed(trio());
    render(<ArrangeSection />);

    const before = useCanvasStore.getState().elements.map(el => el.y);
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
    expect(useCanvasStore.getState().elements.map(el => el.y)).toEqual(before);

    const xs = useCanvasStore.getState().elements.map(el => el.x);
    fireEvent.click(screen.getByRole('button', { name: 'Align top' }));
    expect(useCanvasStore.getState().elements.map(el => el.x)).toEqual(xs);
  });
});

describe('ArrangeSection distribute', () => {
  // Regression: horizontal distribute equalises the *gaps between x positions*.
  // The store needs three or more selected elements, which the trio provides --
  // with two there is nothing to distribute and the action is a documented no-op.
  it('equalises horizontal gaps', () => {
    seed(trio());
    render(<ArrangeSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Distribute horizontally' }));

    const sorted = [...useCanvasStore.getState().elements].sort((a, b) => a.x - b.x);
    const gaps = sorted.slice(1).map((el, i) => el.x - (sorted[i]!.x + sorted[i]!.width));
    // All gaps equal, and the outer extremes are untouched.
    expect(new Set(gaps.map(g => Math.round(g)))).toHaveLength(1);
    expect(sorted[0]?.x).toBe(0);
    expect(sorted.at(-1)?.x).toBe(500);
  });

  // Regression: vertical distribute does the same on y, and leaves x alone.
  // Asserting the untouched axis is what rules out a handler that passed the
  // wrong axis string and silently did nothing.
  it('equalises vertical gaps and leaves x alone', () => {
    seed(trio());
    render(<ArrangeSection />);

    const xs = useCanvasStore.getState().elements.map(el => el.x);
    fireEvent.click(screen.getByRole('button', { name: 'Distribute vertically' }));

    expect(useCanvasStore.getState().elements.map(el => el.x)).toEqual(xs);

    const sorted = [...useCanvasStore.getState().elements].sort((a, b) => a.y - b.y);
    const gaps = sorted.slice(1).map((el, i) => el.y - (sorted[i]!.y + sorted[i]!.height));
    expect(new Set(gaps.map(g => Math.round(g)))).toHaveLength(1);
  });

  // Regression: with only two elements selected, both distribute buttons are
  // no-ops. The store bails below three, and the panel shows the grid from two --
  // so this is a user-reachable state where two of the eight buttons do nothing.
  // Asserted as an unchanged geometry rather than as an absent button, since the
  // buttons *are* rendered.
  it('is a no-op below three selected elements', () => {
    seed([trio()[0]!, trio()[1]!]);
    render(<ArrangeSection />);

    const before = useCanvasStore.getState().elements.map(el => ({ id: el.id, x: el.x, y: el.y }));

    for (const name of ['Distribute horizontally', 'Distribute vertically']) {
      expect(() => fireEvent.click(screen.getByRole('button', { name }))).not.toThrow();
    }

    expect(useCanvasStore.getState().elements.map(el => ({ id: el.id, x: el.x, y: el.y }))).toEqual(
      before
    );
  });
});

describe('ArrangeSection with an empty selection', () => {
  // Regression: the section takes no props and reads the store, so with nothing
  // selected every one of the eight buttons must be inert rather than throwing.
  // A bare `state.selectedIds` destructure followed by `.map` would throw here,
  // and React would surface it as an unhandled error rather than a silent no-op.
  it('leaves all eight controls inert with nothing selected', () => {
    seed(trio());
    act(() => {
      useCanvasStore.getState().setSelectedIds(new Set());
    });
    render(<ArrangeSection />);

    const before = useCanvasStore.getState().elements.map(el => ({ id: el.id, x: el.x, y: el.y }));

    for (const button of screen.getAllByRole('button')) {
      expect(() => fireEvent.click(button)).not.toThrow();
    }

    expect(useCanvasStore.getState().elements.map(el => ({ id: el.id, x: el.x, y: el.y }))).toEqual(
      before
    );
  });

  // Regression: align is also a no-op below two selected elements, which is the
  // other user-reachable state the panel can present this grid in.
  it('is a no-op for align with a single selected element', () => {
    seed(trio());
    act(() => {
      useCanvasStore.getState().setSelectedIds(new Set(['b']));
    });
    render(<ArrangeSection />);

    const before = useCanvasStore.getState().elements.map(el => el.x);
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));

    expect(useCanvasStore.getState().elements.map(el => el.x)).toEqual(before);
  });

  // Regression: the section renders its eight controls unconditionally, so a
  // `disabled` sweep would be a behaviour change the panel cannot see. Asserted
  // as the count of *enabled* buttons.
  it('renders every control enabled regardless of selection size', () => {
    seed(trio());
    render(<ArrangeSection />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(8);
    for (const button of buttons) {
      expect(button).toBeEnabled();
    }
  });
});
