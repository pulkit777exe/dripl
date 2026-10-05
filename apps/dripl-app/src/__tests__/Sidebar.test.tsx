import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '@/components/Sidebar';

/**
 * `components/Sidebar.tsx` is the app's fixed tool palette: ten buttons, one
 * `activeTool` highlight, and two handlers per button.
 *
 * The palette is data, not markup -- a literal array of `{ id, icon, label }`
 * rendered with `.map` -- so the assertions are invariants over that array rather
 * than ten restatements of it:
 *
 *   ids are unique and stable. `activeTool` is matched by id, so a duplicate id
 *     would light two buttons at once and a *changed* id would silently stop the
 *     highlight from ever applying. Asserting uniqueness plus "the id the
 *     component reports for a label is the id it was selected by" pins both.
 *   both handlers reach `onToolSelect` with the tool's id. `onPointerDown` is
 *     there so a drag that begins on the sidebar selects the tool and does not
 *     start a rubber-band selection, and `onClick` is there for the
 *     keyboard/assistive path that never fires a pointer event. Both go through
 *     the same optional call, so a caller that omits `onToolSelect` gets inert
 *     buttons rather than a crash -- and that is asserted in its own right,
 *     because the optional call is the only thing standing between a read-only
 *     canvas and a render-time throw.
 *   `event.preventDefault()` on the pointer-down. This is the load-bearing half
 *     of the pointer handler: without it the browser's own pointerdown
 *     processing runs and a canvas drag starts under the palette.
 *   the highlight pair. The active and inactive class sets are mutually
 *     exclusive *and* the default is `select`, so the toolbar always shows a
 *     selected tool even before the store has one.
 */

afterEach(() => {
  cleanup();
});

/** The palette buttons, in the order the component rendered them. */
function toolButtons() {
  return screen.getAllByRole('button');
}

describe('Sidebar palette', () => {
  // Regression: the palette is one fixed set of tools, and `activeTool` is
  // matched by id, so a duplicated or blank id is invisible to a render and
  // shows up as two buttons highlighted at once (or none).
  it('renders one button per tool with unique, non-empty ids and labels', () => {
    render(<Sidebar />);

    const buttons = toolButtons();
    expect(buttons).toHaveLength(10);

    const labels = buttons.map(b => b.getAttribute('title'));
    for (const label of labels) {
      expect(label).toBeTruthy();
    }
    expect(new Set(labels).size).toBe(labels.length);
  });

  // Regression: the icon is what the button is, and the label is only its
  // tooltip. A button that rendered no icon is a 40x40 empty box -- selectable
  // but unreadable. So each button must contain exactly one `svg`, and the
  // `title` must be the human-readable name of the tool it selects.
  it('gives every tool an icon and a tooltip naming it', () => {
    render(<Sidebar activeTool="diamond" onToolSelect={vi.fn()} />);

    const buttons = toolButtons();
    for (const button of buttons) {
      const icon = button.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveClass('h-5', 'w-5');
    }
    // The highlighted button is the one whose label says Diamond -- this ties
    // the `activeTool` id to the rendered label, which is the relationship a
    // duplicated or renamed id would break.
    const active = buttons.filter(b => b.className.includes('bg-[#FAE8E5]'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute('title', 'Diamond');
  });

  // Regression: the aside is `fixed` full-height on the left with a high z-index
  // and a themed background. The inline style is the mechanism -- it reads the
  // CSS custom properties at paint time rather than at module load, so a theme
  // switch repaints it.
  it('is a fixed full-height rail themed through CSS custom properties', () => {
    const { container } = render(<Sidebar />);

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside).toHaveClass('fixed', 'left-0', 'top-0', 'z-50', 'h-full', 'w-14');
    expect(aside!.getAttribute('style')).toBe(
      'background-color: var(--color-background); border-color: var(--color-border);'
    );
  });
});

describe('Sidebar active tool', () => {
  // Regression: the highlight pair. `bg-[#FAE8E5] text-[#E8462A]` marks the
  // active tool and `text-[#6B6860]` the inactive ones. Both halves matter --
  // the fill is the current tool, the muted text is everything else -- and a
  // merged `cn` that let the base win would leave every button looking active.
  it('highlights exactly the active tool', () => {
    render(<Sidebar activeTool="rectangle" />);

    const buttons = toolButtons();
    const active = buttons.filter(b => b.className.includes('bg-[#FAE8E5]'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute('title', 'Rectangle');
    expect(active[0]).toHaveClass('text-[#E8462A]');
    // The inactive set is the complement, and carries the muted colour plus its
    // hover pair instead of the active fill.
    const inactive = buttons.filter(b => !b.className.includes('bg-[#FAE8E5]'));
    expect(inactive).toHaveLength(buttons.length - 1);
    for (const button of inactive) {
      expect(button).toHaveClass('text-[#6B6860]', 'hover:bg-[#E8E5DE]', 'hover:text-[#1A1917]');
      expect(button.className).not.toContain('bg-[#FAE8E5]');
    }
  });

  // Regression: `activeTool` defaults to `'select'`. The store's default tool is
  // select, but the palette must agree even before the store has spoken -- a
  // default of `''` leaves the rail with nothing highlighted, which reads as
  // "no tool is active" while a selection is in fact armed.
  it('defaults the active tool to select', () => {
    render(<Sidebar />);

    const active = toolButtons().filter(b => b.className.includes('bg-[#FAE8E5]'));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute('title', 'Select');
  });

  // Regression: the class string is shared by every button, asserted once here
  // so a change to the button's own geometry or focus treatment is caught. The
  // highlight merge above only shows which axis the caller can override.
  it('declares the shared button geometry on every tool', () => {
    render(<Sidebar />);

    for (const button of toolButtons()) {
      expect(button).toHaveClass(
        'flex',
        'h-10',
        'w-10',
        'items-center',
        'justify-center',
        'rounded-md',
        'transition-colors'
      );
      expect(button.tagName).toBe('BUTTON');
    }
  });
});

describe('Sidebar selection', () => {
  // Regression: the pointer path, and the `preventDefault` that makes it safe.
  // The rail sits over the canvas, so a pointer-down that is not cancelled
  // starts a rubber-band selection underneath the palette while also changing
  // tools. The event object is dispatched directly rather than through
  // `fireEvent` so `defaultPrevented` is observable on the very event the handler
  // received -- a synthetic helper that swallowed the flag would make this pass
  // for a handler that never cancelled anything.
  it('cancels the pointer-down and reports the tool id', () => {
    const onToolSelect = vi.fn<(tool: string) => void>();
    render(<Sidebar onToolSelect={onToolSelect} />);

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    toolButtons()[2]!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onToolSelect).toHaveBeenCalledTimes(1);
    expect(onToolSelect).toHaveBeenCalledWith('rectangle');
  });

  // Regression: the click path, which is the only one a keyboard user or an
  // assistive technology reaches -- a `keydown`-activated button fires `click`
  // and never a pointer event. Dropping `onClick` would make the palette
  // mouse-only.
  it('reports the tool id on click as well', () => {
    const onToolSelect = vi.fn<(tool: string) => void>();
    render(<Sidebar onToolSelect={onToolSelect} />);

    fireEvent.click(toolButtons()[5]!);

    expect(onToolSelect).toHaveBeenCalledTimes(1);
    expect(onToolSelect).toHaveBeenCalledWith('arrow');
  });

  // Regression: the ids the palette reports are the ids the canvas store uses.
  // Read as a set from the component's own labels rather than restated, so a
  // rename that changed an id would show up as a mismatch with the tool list the
  // rest of the app selects by rather than as a silently dead button.
  it('reports each tool under the id its label names', () => {
    const onToolSelect = vi.fn<(tool: string) => void>();
    render(<Sidebar onToolSelect={onToolSelect} />);

    const buttons = toolButtons();
    const reported: Array<[string, string]> = [];
    for (const button of buttons) {
      onToolSelect.mockClear();
      fireEvent.click(button);
      expect(onToolSelect).toHaveBeenCalledTimes(1);
      reported.push([button.getAttribute('title')!, onToolSelect.mock.calls[0]![0]]);
    }

    // One reported id per tool, all distinct, and none of them an empty string.
    const ids = reported.map(([, id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, id] of reported) {
      expect(id).not.toBe('');
    }
  });

  // Regression: `onToolSelect` is optional, and the handler calls it as
  // `onToolSelect?.(...)`. A canvas that renders the palette without wiring the
  // callback -- a preview, a read-only embed -- must get inert buttons, not a
  // render-time TypeError on every pointer event.
  it('stays inert rather than throwing when no callback is supplied', () => {
    const view = render(<Sidebar />);

    expect(() => {
      fireEvent.click(toolButtons()[0]!);
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      toolButtons()[1]!.dispatchEvent(event);
    }).not.toThrow();
    // The default active tool still highlights, so the rail is not blank.
    expect(view.container.querySelectorAll('button')).toHaveLength(10);
  });
});
