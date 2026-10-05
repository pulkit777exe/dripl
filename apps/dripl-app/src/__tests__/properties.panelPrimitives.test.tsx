import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ARRANGE_BUTTON_CLASS,
  BACKGROUND_COLORS,
  RowBtn,
  SectionLabel,
  STROKE_COLORS,
  ActionBtn,
} from '@/components/canvas/properties/PanelPrimitives';

/**
 * `PanelPrimitives` is the shared presentational layer under the properties
 * panel: the section label, the segmented `RowBtn`, and the `ActionBtn` used by
 * every section in `EffectSections` and `ArrangeSection`.
 *
 * `propertiesPanel.test.tsx` renders these through `PropertiesPanel`, but its
 * assertions are about what reaches `updateProp` -- never about the primitives'
 * own styling contract. Two things live only here:
 *
 *   - the hover guards. `RowBtn` suppresses its hover tint when `active`, and
 *     `ActionBtn` has no such guard but branches on `danger`. A guard dropped
 *     from either is invisible from the panel, because the panel queries the
 *     DOM and not the inline styles.
 *   - the palette constants. `STROKE_COLORS` and `BACKGROUND_COLORS` are the
 *     data behind the swatch grids; a dropped swatch or a `None` entry that is no
 *     longer `transparent` is a data bug no interaction test would surface.
 *
 * Note the contrast with `SectionLabel.test.tsx`, which covers a *different*
 * `SectionLabel` (`components/canvas/SectionLabel.tsx` -- medium weight, gray).
 * This file covers the panel-local one, which is uppercase, semibold and reads a
 * design token.
 */

/**
 * `RowBtn` and `ActionBtn` are icon buttons with no accessible name -- the glyph
 * is an SVG and the tooltip is a `title`. They are therefore queried by that
 * title, which is also the string the user reads. Each render gets its own
 * container so a test can mount both the active and the inactive variant and
 * still address them separately.
 */
function renderRowBtn(active: boolean) {
  const onClick = vi.fn();
  const { container } = render(
    <RowBtn active={active} onClick={onClick} title="Solid">
      S
    </RowBtn>
  );
  const button = container.querySelector('button') as HTMLButtonElement;
  return { button, onClick };
}

function renderActionBtn(options: { danger?: boolean; onClick?: () => void } = {}) {
  const onClick = options.onClick ?? vi.fn();
  const { container } = render(
    <ActionBtn onClick={onClick} title="Delete" danger={options.danger}>
      X
    </ActionBtn>
  );
  const button = container.querySelector('button') as HTMLButtonElement;
  return { button, onClick };
}

describe('SectionLabel (panel primitive)', () => {
  // Regression: the label is a `<label>` with no `htmlFor`, so it is a *style*
  // element rather than a form binding. Asserted as a tag because a refactor to
  // a `<span>` would leave the uppercase/tracking styling intact and silently drop
  // the control's click-to-focus affordance for a paired input.
  it('renders an uppercase, semibold label styled with the panel token', () => {
    render(<SectionLabel>Opacity</SectionLabel>);

    const label = screen.getByText('Opacity');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toBe('text-[11px] font-semibold uppercase tracking-wider select-none');
    expect(label.style.color).toBe('var(--color-panel-label)');
    // `select-none` keeps the label from being drag-selected over the panel.
    expect(label.className).toContain('select-none');
  });

  // Regression: `SectionLabel` renders arbitrary node children, not just a string
  // -- the sections wrap the rotate control's value in one. Asserted with a
  // non-string child so a `String(children)` coercion would fail.
  it('renders non-string children', () => {
    render(
      <SectionLabel>
        <span data-testid="nested">Nested</span>
      </SectionLabel>
    );

    expect(screen.getByTestId('nested')).toHaveTextContent('Nested');
  });
});

describe('RowBtn styling', () => {
  // Regression: the active and inactive branches use *different* token sets. The
  // active branch adds an inset shadow and the active text token; the inactive
  // one does not. Merging the two would render a pressed segment indistinguishable
  // from an unpressed one -- which is the entire purpose of the control.
  it('paints the active branch with the active tokens and the inactive with its own', () => {
    const { button: active } = renderRowBtn(true);
    expect(active.style.backgroundColor).toBe('var(--color-panel-btn-active)');
    expect(active.style.color).toBe('var(--color-panel-btn-active-text, #fff)');
    expect(active.style.boxShadow).toBe('inset 0 1px 2px rgba(0,0,0,0.15)');

    const { button: inactive } = renderRowBtn(false);
    expect(inactive.style.backgroundColor).toBe('var(--color-panel-btn-bg)');
    expect(inactive.style.color).toBe('var(--color-panel-text)');
    expect(inactive.style.boxShadow).toBe('');
  });

  // Regression: the hover guard on an *inactive* button. Both halves asserted:
  // enter sets the hover token, leave restores the inactive token. A `mouseleave`
  // that restored nothing would leave the segment stuck tinted.
  it('tints an inactive button on hover and restores it on leave', () => {
    const { button } = renderRowBtn(false);

    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-hover)');

    fireEvent.mouseLeave(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-bg)');
  });

  // Regression: the same hover guard on an *active* button. This is the direction
  // the guard exists for -- an active segment must not repaint on hover, or the
  // user loses the pressed state the moment they rest the pointer on it.
  //
  // The inactive render above is the control that proves the handlers are live,
  // so this `not.toBe(...)` cannot pass merely because nothing was listening.
  it('leaves an active button untouched by hover', () => {
    const { button } = renderRowBtn(true);

    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-active)');

    fireEvent.mouseLeave(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-active)');
  });

  // Regression: `title` and `onClick` are both forwarded, and the button has the
  // `flex-1` sizing class so a row of segments fills the panel width. The class is
  // asserted exactly -- `flex-1` is what stops a two-option control from
  // collapsing to its label width.
  it('forwards the click handler and the title, and flexes to fill the row', () => {
    const { button, onClick } = renderRowBtn(false);

    expect(button.getAttribute('title')).toBe('Solid');
    expect(button.className).toContain('flex-1');
    expect(button.className).toContain('h-7');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // Regression: `title` is optional on the interface. A missing title must not
  // produce `title="undefined"` in the DOM, which is what a naive spread of
  // `{title}` into the attribute would do and what a screen reader would read
  // aloud.
  it('omits the title attribute when none was supplied', () => {
    const { container } = render(
      <RowBtn active={false} onClick={vi.fn()}>
        S
      </RowBtn>
    );

    expect(container.querySelector('button')).not.toHaveAttribute('title');
  });
});

describe('ActionBtn styling', () => {
  // Regression: `ActionBtn` has a single resting style regardless of `danger` --
  // the destructive treatment appears only on hover. Asserted on both the danger
  // and the plain variant, because "danger is styled red at rest" is exactly the
  // sort of change a sweep over these buttons would introduce.
  it('rests on the neutral tokens, danger or not', () => {
    const { button: danger } = renderActionBtn({ danger: true });
    expect(danger.style.backgroundColor).toBe('var(--color-panel-btn-bg)');
    expect(danger.style.color).toBe('var(--color-panel-text)');

    const { button: plain } = renderActionBtn();
    expect(plain.style.backgroundColor).toBe('var(--color-panel-btn-bg)');
    expect(plain.style.color).toBe('var(--color-panel-text)');
  });

  // Regression: the danger hover tints *and* recolours the text. Two separate
  // writes on the same event; a version that only tinted would leave the trash
  // icon's text colour unchanged, which is the half a user actually notices.
  it('tints and recolours a danger button on hover, then restores both on leave', () => {
    const { button } = renderActionBtn({ danger: true });

    fireEvent.mouseEnter(button);
    // jsdom normalises the comma spacing in the rgba() it stores, so the expected
    // string is written the way the DOM will report it rather than the way the
    // source spells it.
    expect(button.style.backgroundColor).toBe('rgba(224, 49, 49, 0.15)');
    expect(button.style.color).toBe('var(--color-destructive)');

    fireEvent.mouseLeave(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-bg)');
    expect(button.style.color).toBe('var(--color-panel-text)');
  });

  // Regression: the non-danger hover tint only. Asserted separately so the danger
  // test above cannot pass because *every* hover produced the danger treatment.
  it('tints a plain button with the neutral hover token', () => {
    const { button } = renderActionBtn();

    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-hover)');
    expect(button.style.color).not.toBe('var(--color-destructive)');

    fireEvent.mouseLeave(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-bg)');
  });

  // Regression: unlike `RowBtn`, `ActionBtn` has **no** `isActive` guard -- its
  // handlers are unconditional. Asserted on the plain variant, which is the one
  // every caller uses without a `danger` flag.
  it('has no active guard, so a non-danger button still tints on hover', () => {
    const { button } = renderActionBtn();

    // The plain ActionBtn has no `active` prop at all, so this documents the
    // asymmetry with RowBtn rather than testing a state the type does not have.
    expect('active' in button).toBe(false);
    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe('var(--color-panel-btn-hover)');
  });

  // Regression: `onClick` and `title` are both *optional* on this component, and
  // the sections pass them through as `onClick={onDuplicate}` where the prop may
  // be undefined. A button with no handler must still render and must not gain a
  // `title="undefined"`.
  it('renders a handler-less, title-less button without spurious attributes', () => {
    const { container } = render(<ActionBtn>x</ActionBtn>);

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).toHaveTextContent('x');
    expect(button).not.toHaveAttribute('title');
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});

describe('Panel palette constants', () => {
  // Regression: `STROKE_COLORS` is the data behind the stroke swatch grid. The
  // count, the presence of both a true black and a true white, and the uniqueness
  // of every value are all load-bearing: a duplicate value would render two
  // identical swatches that are indistinguishable but set the same colour.
  it('offers eight distinct stroke colours including black and white', () => {
    expect(STROKE_COLORS).toHaveLength(8);
    const values = STROKE_COLORS.map(c => c.value);
    expect(new Set(values).size).toBe(8);
    expect(values).toContain('#1e1e1e');
    expect(values).toContain('#ffffff');
    // Every entry carries a human label -- the tooltip the user reads.
    for (const entry of STROKE_COLORS) {
      expect(entry.label.length).toBeGreaterThan(0);
    }
    // ...and the labels are distinct too. Two swatches with different hex values
    // but the same label would render as two identical tooltips, leaving the user
    // unable to tell which is which.
    const labels = STROKE_COLORS.map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    // The palette is the full named set, so a renamed or dropped colour is caught
    // by name rather than by count alone.
    expect(labels).toEqual(['Black', 'Red', 'Green', 'Blue', 'Orange', 'Purple', 'Pink', 'White']);
  });

  // Regression: `BACKGROUND_COLORS` leads with `transparent` labelled 'None'.
  // That first entry is how a user clears a fill; renaming it or changing its
  // value to an opaque colour would make "no fill" unpickable.
  it('offers a transparent "None" background followed by five tints', () => {
    expect(BACKGROUND_COLORS).toHaveLength(6);
    expect(BACKGROUND_COLORS[0]).toEqual({ value: 'transparent', label: 'None' });
    const values = BACKGROUND_COLORS.map(c => c.value);
    expect(new Set(values).size).toBe(6);
    // The tints are all light, all distinct from the None entry.
    expect(values.slice(1)).not.toContain('transparent');
    // ...and the labels are the full named set, so a mislabelled tint (a "Red"
    // entry pointing at the green hex) is caught by name.
    expect(BACKGROUND_COLORS.map(c => c.label)).toEqual([
      'None',
      'Light Red',
      'Light Green',
      'Light Blue',
      'Light Yellow',
      'Light Purple',
    ]);
    expect(values.slice(1)).toEqual(['#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#e0dcff']);
  });

  // Regression: `ARRANGE_BUTTON_CLASS` is the shared sizing class for the
  // multi-select arrange grid. Asserted as the exact string because a drop of
  // `h-7` or the `transition-colors` would be a purely visual regression that no
  // behavioural assertion reaches -- and because the class is exported and shared,
  // so a change here silently restyles every button in that grid at once.
  it('exports the shared arrange button class verbatim', () => {
    expect(ARRANGE_BUTTON_CLASS).toBe('h-7 rounded text-[11px] transition-colors hover:opacity-80');
  });
});
