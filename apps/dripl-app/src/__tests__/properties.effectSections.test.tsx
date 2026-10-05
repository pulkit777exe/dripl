import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import {
  ActionsSection,
  AlignSection,
  GlobalExportSection,
  LayersSection,
  OpacitySection,
} from '@/components/canvas/properties/EffectSections';
import type { DriplElement } from '@dripl/common';

/**
 * `propertiesPanel.test.tsx` reaches `EffectSections` only through
 * `PropertiesPanel`, and only for its "is this section rendered for this element
 * type" gating plus one align click taken from the first of two grids. This file
 * renders the sections directly and covers what the panel cannot isolate:
 *
 *   - `LayersSection`'s four ordering actions. All four funnel through the same
 *     `selectedElement && …` shape, so a guard dropped from any one of them is
 *     indistinguishable from the panel -- the buttons simply stop working. Each is
 *     asserted against the *store outcome*, not just the click.
 *   - `OpacitySection`'s "no selection" arm. With no element the slider renders at
 *     full opacity and its `onChange` is a no-op, which is a different code path
 *     from the one the panel exercises (it always has an element).
 *   - `AlignSection`'s four modes and `GlobalExportSection`'s hover styling.
 *
 * The real store is used throughout, because the assertions are about what the
 * arrange actions do to the element list.
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
    ...overrides,
  } as DriplElement;
}

function seedElements(elements: DriplElement[], selectedIds: string[]) {
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
    useCanvasStore.getState().setSelectedIds(new Set(selectedIds));
  });
}

/**
 * The store orders elements by their fractional index, not by array position -- so
 * every fixture element carries an explicit one and the draw order is read back
 * from the array the store re-sorts.
 */
function ordered(id: string, index: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return element(id, { fractionalIndex: index, ...overrides });
}

/** The draw order the store renders in: `elements` array order. */
function drawOrder(): string[] {
  return useCanvasStore.getState().elements.map(el => el.id);
}

/**
 * Reset the store to a known-empty state before every test.
 *
 * This was previously only `canvasBackground`, which left `elements` and
 * `selectedIds` to leak between tests. A file that renders a section without seeding
 * first — the export-button hover pair, for one — then asserts against whatever the
 * previous test happened to leave behind. That is invisible when the file runs alone
 * and produces a *different* failure each time the full suite runs, because the
 * leftover state depends on which worker the file lands in.
 */
beforeEach(() => {
  useCanvasStore.setState({
    canvasBackground: null,
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
});

describe('LayersSection ordering', () => {
  // Regression: all four layer actions are wired, and each is asserted against the
  // resulting draw order rather than the click. The store keeps `elements` in
  // paint order, so "Send to back" moving an id from the front of that array to the
  // back is the observable.
  it('sends the selection to the back and brings it to the front', () => {
    // `b` sits in the middle, so every assertion below is a real move rather
    // than a no-op the store would absorb.
    const [a, b, c] = [
      ordered('a', 'a0'),
      ordered('b', 'a1', { x: 200 }),
      ordered('c', 'a2', { x: 400 }),
    ];
    seedElements([a, b, c], ['b']);
    expect(drawOrder()).toEqual(['a', 'b', 'c']);

    const { unmount } = render(<LayersSection selectedElement={b} updateProp={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to back' }));
    expect(drawOrder()).toEqual(['b', 'a', 'c']);

    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }));
    expect(drawOrder()).toEqual(['a', 'c', 'b']);
    unmount();
  });

  // Regression: the one-step actions, which are separate store methods from the
  // two-step ones above. A transposition between "send backward" and "send to
  // back" would keep both buttons pressable and only be visible in the order.
  it('steps the selection one position at a time', () => {
    // Four elements with the selection in the *third* slot. This is what makes the
    // one-step actions distinguishable from the two-step ones: "send backward"
    // from slot 2 lands in slot 1, whereas "send to back" would jump to slot 0.
    // Selecting from slot 0 or slot 1 would make the two buttons produce the same
    // order, and a transposition between them would go unnoticed -- which is
    // exactly what a three-element fixture with the selection in the middle does.
    const [a, b, c, d] = [
      ordered('a', 'a0'),
      ordered('b', 'a1', { x: 200 }),
      ordered('c', 'a2', { x: 400 }),
      ordered('d', 'a3', { x: 600 }),
    ];
    seedElements([a, b, c, d], ['c']);

    const { unmount } = render(<LayersSection selectedElement={c} updateProp={vi.fn()} />);

    // One step back: `c` swaps with `b` and stops in the middle.
    fireEvent.click(screen.getByRole('button', { name: 'Send backward' }));
    expect(drawOrder()).toEqual(['a', 'c', 'b', 'd']);

    // Bring-forward is the exact inverse, so the pair round-trips.
    fireEvent.click(screen.getByRole('button', { name: 'Bring forward' }));
    expect(drawOrder()).toEqual(['a', 'b', 'c', 'd']);

    // ...and two more backward steps reach the very front -- the full journey the
    // one-step button must *not* make in a single press.
    fireEvent.click(screen.getByRole('button', { name: 'Send backward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send backward' }));
    expect(drawOrder()).toEqual(['c', 'a', 'b', 'd']);
    unmount();
  });

  // Regression: every layer action passes *only the selected element's id*, not
  // the whole selection. `Bring to front` on a multi-selection is wrong -- it
  // would lift every selected element above the unselected ones. Asserted by
  // pressing the action with two ids selected and checking the third stays put.
  it('moves only the one selected element, even when more are selected', () => {
    const [a, b, c] = [
      ordered('a', 'a0'),
      ordered('b', 'a1', { x: 200 }),
      ordered('c', 'a2', { x: 400 }),
    ];
    seedElements([a, b, c], ['b', 'c']);

    // `selectedElement` is `b`, and the section forwards only `[b.id]`.
    const { unmount } = render(<LayersSection selectedElement={b} updateProp={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to back' }));

    // `a` is unselected and stays put; only `b` moves, in front of it.
    expect(drawOrder()).toEqual(['b', 'a', 'c']);
    unmount();
  });

  // Regression: the `selectedElement && …` guard. With nothing selected the four
  // buttons render but do nothing -- and, critically, do not throw. A bare
  // `selectedElement.id` would throw a TypeError inside the click handler, which
  // React surfaces as an unhandled error rather than a silent no-op.
  //
  // Asserted as an unchanged draw order, and the buttons themselves are asserted
  // present so this is not vacuously "nothing happened because nothing rendered".
  it('does nothing when no element is selected', () => {
    const [a, b] = [ordered('a', 'a0'), ordered('b', 'a1', { x: 200 })];
    seedElements([a, b], []);

    const { unmount } = render(<LayersSection selectedElement={null} updateProp={vi.fn()} />);

    for (const name of ['Send to back', 'Send backward', 'Bring forward', 'Bring to front']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeInTheDocument();
      expect(() => fireEvent.click(button)).not.toThrow();
    }
    expect(drawOrder()).toEqual(['a', 'b']);
    unmount();
  });
});

describe('OpacitySection', () => {
  // Regression: the slider reports a *fraction*, not the percentage the DOM
  // carries. `Number(value) / 100` is the whole contract between the range input
  // and the element, and sending `50` would set opacity to 50 and vanish the shape.
  it('writes a 0..1 fraction to updateProp', () => {
    const updateProp = vi.fn<(property: string, value: unknown) => void>();
    const selected = element('a');
    render(<OpacitySection selectedElement={selected} updateProp={updateProp} />);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.value).toBe('100');

    fireEvent.change(slider, { target: { value: '35' } });

    expect(updateProp).toHaveBeenCalledTimes(1);
    expect(updateProp).toHaveBeenCalledWith('opacity', 0.35);
  });

  // Regression: the displayed value is rounded to a whole percentage, so an
  // element stored at 0.456 shows 46 and the slider tracks it. Without the round
  // the `<input type=range>` would reject the fractional value and snap to 100.
  it('rounds the stored opacity for display and for the slider value', () => {
    const updateProp = vi.fn<(property: string, value: unknown) => void>();
    render(
      <OpacitySection selectedElement={element('a', { opacity: 0.456 })} updateProp={updateProp} />
    );

    expect(screen.getByRole('slider')).toHaveValue('46');
    expect(screen.getByText('46')).toBeInTheDocument();
  });

  // Regression: the no-selection arm. The slider still renders -- at full opacity
  // -- but its `onChange` writes nothing, because there is nothing to write to.
  // Asserted as a zero call count on `updateProp` (a counter, not an absence of
  // output) with the slider present as the ungated sibling control.
  it('renders at full opacity and stays inert with nothing selected', () => {
    const updateProp = vi.fn<(property: string, value: unknown) => void>();
    render(<OpacitySection selectedElement={null} updateProp={updateProp} />);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider).toHaveValue('100');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');

    fireEvent.change(slider, { target: { value: '10' } });
    expect(updateProp).not.toHaveBeenCalled();
  });

  // Regression: an element stored with `opacity` absent falls back to 1 rather
  // than rendering an empty value. A `NaN` here would produce an empty slider and
  // a blank readout, which is what a partially-migrated element looks like.
  it('falls back to full opacity when the field is absent', () => {
    const withoutOpacity = element('a');
    delete (withoutOpacity as Partial<DriplElement>).opacity;
    render(
      <OpacitySection
        selectedElement={withoutOpacity}
        updateProp={vi.fn<(property: string, value: unknown) => void>()}
      />
    );

    expect(screen.getByRole('slider')).toHaveValue('100');
    expect(screen.getByText('100')).toBeInTheDocument();
  });
});

describe('AlignSection', () => {
  // Regression: each of the four align buttons dispatches its own mode. The store
  // bails below two selected elements, so the fixture selects two and the
  // assertion is the resulting geometry.
  //
  // The *values* are asserted, not just "the values became uniform". All four
  // modes produce a set of identical coordinates, so a `toBe`-on-`size`-1 check
  // would be satisfied by any of the other three modes -- which is how a
  // transposed handler hides. The fixture's widths differ so left, centre and
  // right all land on different numbers.
  it('aligns horizontally and vertically with the right mode per button', () => {
    // Zero stroke keeps `getElementBounds` equal to the declared frame, so the
    // expected numbers below are readable arithmetic rather than a guess: with a
    // 2px stroke every bound is padded by 1px on each side.
    //   a: x 0..100,  y 0..100
    //   b: x 200..260, y 300..380   (so the x and y extremes differ, and so do
    //                               the widths and heights)

    const { unmount } = render(<AlignSection />);

    /**
     * Each mode is pressed from the *same* starting scene. The modes compose --
     * after "align left" both boxes sit at x 0, so a following "align right" sees
     * a maxX of 100 rather than 260 -- and asserting them cumulatively would
     * therefore pin arithmetic that depends on the order of the clicks rather
     * than on the mode each button dispatches.
     */
    const freshScene = () =>
      seedElements(
        [
          element('a', { width: 100, height: 100, strokeWidth: 0 }),
          element('b', { x: 200, y: 300, width: 60, height: 80, strokeWidth: 0 }),
        ],
        ['a', 'b']
      );
    const xs = () => useCanvasStore.getState().elements.map(el => el.x);
    const rightEdges = () => useCanvasStore.getState().elements.map(el => el.x + el.width);
    const xCentres = () => useCanvasStore.getState().elements.map(el => el.x + el.width / 2);
    const yCentres = () => useCanvasStore.getState().elements.map(el => el.y + el.height / 2);

    // Align left -> every left edge at minX = 0.
    freshScene();
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
    expect(xs()).toEqual([0, 0]);

    // Align right -> every right edge at maxX = 260.
    freshScene();
    fireEvent.click(screen.getByRole('button', { name: 'Align right' }));
    expect(rightEdges()).toEqual([260, 260]);

    // Align center -> every centre at (minX + maxX) / 2 = 130.
    freshScene();
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
    expect(xCentres()).toEqual([130, 130]);

    // Align middle -> every vertical centre at (minY + maxY) / 2 = 190.
    freshScene();
    fireEvent.click(screen.getByRole('button', { name: 'Align middle' }));
    expect(yCentres()).toEqual([190, 190]);
    unmount();
  });

  // Regression: `AlignSection` takes *no* props at all -- it reads the store's
  // selection directly, unlike `LayersSection`. Asserted by rendering it bare and
  // pressing it, which is only type-correct because the signature really is empty.
  it('reads the selection from the store rather than from props', () => {
    seedElements([element('a'), element('b', { x: 200 })], ['a', 'b']);
    render(<AlignSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));

    expect(new Set(useCanvasStore.getState().elements.map(el => el.x)).size).toBe(1);
  });
});

describe('ActionsSection', () => {
  // Regression: the three action buttons forward their optional callbacks. Each
  // is clicked so a transposed `onClick` is visible -- the row is three
  // same-looking buttons, so nothing about the render distinguishes them.
  it('routes duplicate, delete and export to their own callbacks', () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onExport = vi.fn();

    render(<ActionsSection onDuplicate={onDuplicate} onDelete={onDelete} onExport={onExport} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  // Regression: `onDuplicate` and `onDelete` are optional, because the panel hides
  // this row entirely for an unknown element type and a caller may omit them. The
  // buttons must still render and stay clickable without throwing.
  it('renders with only the required export callback', () => {
    const onExport = vi.fn();
    render(<ActionsSection onExport={onExport} />);

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))).not.toThrow();
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Delete' }))).not.toThrow();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  // Regression: Delete is the danger action and is the only one flagged as such.
  // Asserted on the hover treatment, which is where `ActionBtn` consumes the flag
  // -- so a dropped `danger` prop here is invisible until the user hovers.
  it('marks only the delete action as dangerous', () => {
    render(<ActionsSection onDuplicate={vi.fn()} onDelete={vi.fn()} onExport={vi.fn()} />);

    const del = screen.getByRole('button', { name: 'Delete' });
    fireEvent.mouseEnter(del);
    expect(del.style.color).toBe('var(--color-destructive)');

    const dup = screen.getByRole('button', { name: 'Duplicate' });
    fireEvent.mouseEnter(dup);
    expect(dup.style.color).not.toBe('var(--color-destructive)');
  });

  // Regression: the row is preceded by a divider, which is what separates the
  // element-editing sections from the destructive actions. Its presence is a
  // layout contract with `PropertiesPanel`, so it is asserted rather than assumed.
  it('separates the actions from the editing sections with a divider', () => {
    const { container } = render(<ActionsSection onExport={vi.fn()} />);

    const divider = container.querySelector('div.h-px') as HTMLElement | null;
    expect(divider).not.toBeNull();
    expect(divider?.style.backgroundColor).toBe('var(--color-panel-divider)');
  });
});

describe('GlobalExportSection', () => {
  // Regression: the full-width export button below the panel border is a *plain*
  // `<button>`, not an `ActionBtn` -- it has its own token set and its own hover
  // handlers. Asserted separately from `ActionsSection` because a refactor that
  // routed it through `ActionBtn` would drop the border and the full-width layout.
  it('renders a full-width export button below a top border', () => {
    const { container } = render(<GlobalExportSection onExport={vi.fn()} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.borderTop).toBe('1px solid var(--color-panel-divider)');
    expect(wrapper.className).toContain('pt-2');

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button.className).toContain('w-full');
    expect(button.style.border).toBe('1px solid var(--color-panel-border)');
  });

  // Regression: the hover pair on that button. The leave handler restores the
  // resting token rather than clearing it, so the button does not drift a shade
  // lighter after every hover. Both halves asserted.
  it('tints the export button on hover and restores it on leave', () => {
    const onExport = vi.fn();
    render(<GlobalExportSection onExport={onExport} />);

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-bg)');

    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-hover)');

    fireEvent.mouseLeave(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-bg)');

    // ...and the click still lands after the hover round-trip.
    fireEvent.click(button);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  // Regression: this button is not gated on a selection. With nothing selected it
  // is the *only* way to export the canvas, which is why `PropertiesPanel` renders
  // it unconditionally. Asserted with an empty store as the control.
  it('stays available with nothing selected', () => {
    seedElements([], []);
    const onExport = vi.fn();
    render(<GlobalExportSection onExport={onExport} />);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });
});
