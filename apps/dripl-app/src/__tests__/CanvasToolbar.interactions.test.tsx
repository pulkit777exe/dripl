import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import type { ComponentProps } from 'react';

/**
 * `CanvasToolbar` is the drawing-tool switcher. The pre-existing suites reach it
 * only through `canvasControls.test.tsx`-style store assertions and the keyboard
 * map, which bypass the buttons themselves. Everything below is a property of the
 * *buttons*:
 *
 *   - `onPointerDown` calls `preventDefault()`. This is the load-bearing line:
 *     without it the browser starts a text selection or scrolls the container on
 *     the first millisecond of a drag before the canvas ever sees the gesture.
 *   - the read-only gate is *per tool*, not global: `hand` and `select` stay live
 *     so a read-only viewer can still pan and select. One `readOnly` guard across
 *     all buttons would be a worse product and an easy regression.
 *   - the hover styling is gated on `!isActive`, so hovering the current tool does
 *     not repaint it. Asserted in both directions, since "style unchanged" is
 *     otherwise indistinguishable from "hover handler never ran".
 *   - the live region and the lock button's own press state.
 */

type ToolbarProps = ComponentProps<typeof CanvasToolbar>;
/** Tool ids come from the toolbar's own table; the type is the store's. */
const TOOL_IDS: ActiveTool[] = [
  'hand',
  'select',
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'eraser',
];

function toolButton(id: ActiveTool) {
  // The toolbar sets `id={`tool-btn-${id}`}` -- a stable hook that survives a
  // relabel, unlike the accessible name which includes the label word "tool".
  const node = document.getElementById(`tool-btn-${id}`);
  if (!node) throw new Error(`no button for tool ${id}`);
  return node as HTMLButtonElement;
}

function seed(
  overrides: { activeTool?: ActiveTool; toolLocked?: boolean; readOnly?: boolean } = {}
) {
  useCanvasStore.setState({
    activeTool: overrides.activeTool ?? 'select',
    toolLocked: overrides.toolLocked ?? false,
    readOnly: overrides.readOnly ?? false,
  });
}

/** Rendered with the real store; the extra-tools dropdown is stubbed out. */
function renderToolbar(_overrides: Partial<ToolbarProps> = {}) {
  return render(<CanvasToolbar />);
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CanvasToolbar tool selection', () => {
  // Regression: clicking a tool writes it to the store. Asserted on the store
  // value and on `aria-pressed` together: the pressed state is the only thing the
  // user sees, and a button that highlights without selecting (or vice versa) is
  // the failure this pins.
  it('selects a tool on click and marks it pressed', () => {
    renderToolbar();

    fireEvent.click(toolButton('rectangle'));

    expect(useCanvasStore.getState().activeTool).toBe('rectangle');
    expect(toolButton('rectangle')).toHaveAttribute('aria-pressed', 'true');
    expect(toolButton('select')).toHaveAttribute('aria-pressed', 'false');
  });

  // Regression: every one of the eleven tools is wired to the store. A loop over
  // the ids rather than eleven separate cases, because the failure mode is a
  // missing or mistyped `onClick`, and a per-tool test would bury that in
  // boilerplate. The count assertion makes a *dropped* tool visible too.
  it('wires every declared tool to setActiveTool', () => {
    renderToolbar();

    expect(document.querySelectorAll('[id^="tool-btn-"]')).toHaveLength(TOOL_IDS.length);

    for (const id of TOOL_IDS) {
      seed({ activeTool: 'select' });
      fireEvent.click(toolButton(id));
      expect(useCanvasStore.getState().activeTool).toBe(id);
    }
  });

  // Regression: `onPointerDown` calls `preventDefault()`. Without it the browser
  // begins a native drag/selection on the toolbar before the canvas's own
  // pointer-down runs, so a fast drag out of the toolbar draws a stray element.
  // jsdom does not implement native selection, so the only observable is
  // `defaultPrevented` on a cancelable event -- and the event must be cancelable
  // for that to mean anything, which is asserted too.
  it('prevents the default action on pointer down', () => {
    renderToolbar();

    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    toolButton('ellipse').dispatchEvent(event);

    expect(event.cancelable).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  // Regression: `preventDefault` on pointer-down must *not* swallow the click.
  // Adding it to `click` as well would make every tool button inert.
  it('still selects the tool after preventing the pointer-down default', () => {
    renderToolbar();

    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    toolButton('diamond').dispatchEvent(down);
    fireEvent.click(toolButton('diamond'));

    expect(down.defaultPrevented).toBe(true);
    expect(useCanvasStore.getState().activeTool).toBe('diamond');
  });

  // Regression: only the tool buttons carry `preventDefault`. The lock button
  // does not, and asserting that here keeps the "which controls prevent the
  // default" contract from drifting silently -- a blanket `preventDefault` on the
  // toolbar would block the lock toggle's own click in some engines.
  it('leaves the lock button pointer-down unprevented', () => {
    renderToolbar();

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: /lock current tool/i }).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe('CanvasToolbar read-only gate', () => {
  // Regression: read-only disables the *mutating* tools but leaves `hand` and
  // `select` live, because a read-only viewer must still be able to pan and
  // inspect. Asserted per tool so a single broad `disabled` cannot pass.
  it('disables the mutating tools but keeps hand and select usable', () => {
    seed({ readOnly: true });
    renderToolbar();

    for (const id of TOOL_IDS) {
      const isLive = id === 'hand' || id === 'select';
      expect(toolButton(id).disabled).toBe(!isLive);
    }
  });

  // Regression: a read-only viewer really can still change to the live tools.
  // The disabled assertion above only reads an attribute; this fires the click.
  it('still switches to hand and select while read-only', () => {
    seed({ readOnly: true });
    renderToolbar();

    fireEvent.click(toolButton('hand'));
    expect(useCanvasStore.getState().activeTool).toBe('hand');

    fireEvent.click(toolButton('select'));
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  // Regression: a disabled tool button changes nothing. `fireEvent.click` on a
  // disabled button does not dispatch React's handler in the DOM, so this is a
  // real observation rather than a re-run of the attribute check above.
  it('ignores clicks on the disabled tools', () => {
    seed({ activeTool: 'select', readOnly: true });
    renderToolbar();

    fireEvent.click(toolButton('text'));
    fireEvent.click(toolButton('eraser'));

    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  // Regression: the lock button is disabled read-only too, even though the tool
  // buttons are not uniformly disabled. A read-only viewer must not be able to
  // pin a tool they cannot then use.
  it('disables the lock button read-only', () => {
    seed({ readOnly: true, toolLocked: false });
    renderToolbar();

    const lock = screen.getByRole('button', { name: /lock current tool/i });
    expect(lock).toBeDisabled();

    fireEvent.click(lock);
    expect(useCanvasStore.getState().toolLocked).toBe(false);
  });
});

describe('CanvasToolbar lock toggle', () => {
  // Regression: the lock button is a *toggle* over `toolLocked`, not a set. The
  // close half is asserted, because a `setToolLocked(true)` mutation would pass
  // every open-only assertion and leave no way to release a locked tool.
  it('toggles the lock on and back off', () => {
    seed({ toolLocked: false });
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: /lock current tool/i }));
    expect(useCanvasStore.getState().toolLocked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /unlock current tool/i }));
    expect(useCanvasStore.getState().toolLocked).toBe(false);
  });

  // Regression: the accessible name *and* `aria-pressed` follow the lock state.
  // The name is what a screen reader announces, so a stale label would tell a
  // user the button does the opposite of what it does.
  it('renames and re-presses itself with the lock state', () => {
    seed({ toolLocked: false });
    renderToolbar();

    const locked = screen.getByRole('button', { name: /lock current tool/i });
    expect(locked).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(locked);

    const unlocked = screen.getByRole('button', { name: /^unlock current tool$/i });
    expect(unlocked).toHaveAttribute('aria-pressed', 'true');
    // The exact "Lock" name is gone -- matched exactly, because
    // `/lock current tool/i` is a *substring* of "Unlock current tool" and would
    // happily match the renamed button too.
    expect(screen.queryByRole('button', { name: /^lock current tool$/i })).not.toBeInTheDocument();
  });

  // Regression: the two stacked lock glyphs are swapped with a `data-state` on
  // the wrapper rather than by conditional rendering. That CSS-driven swap is the
  // whole animation; dropping `data-state` would leave both glyphs stacked with
  // no way to tell which is showing.
  it('drives the glyph crossfade from a single data-state attribute', () => {
    seed({ toolLocked: false });
    renderToolbar();

    const swap = () =>
      screen
        .getByRole('button', { name: /lock current tool|unlock current tool/i })
        .querySelector('.t-icon-swap') as HTMLElement;
    expect(swap().dataset.state).toBe('a');

    fireEvent.click(screen.getByRole('button', { name: /lock current tool/i }));

    expect(swap().dataset.state).toBe('b');
  });
});

describe('CanvasToolbar hover styling', () => {
  // Regression: the hover tint is gated on `!isActive`. Repainting the *active*
  // tool on hover would give a pressed tool a hover affordance it does not have,
  // and losing the `!isActive` guard is exactly that. Asserted with the non-active
  // sibling as the control, so "the handler never ran" cannot pass as "the guard
  // held".
  it('tints an inactive tool on hover and clears it on leave', () => {
    seed({ activeTool: 'select' });
    renderToolbar();

    const inactive = toolButton('line');
    const active = toolButton('select');

    fireEvent.mouseEnter(inactive);
    expect(inactive.style.backgroundColor).toBe('var(--color-tool-hover-bg)');

    fireEvent.mouseLeave(inactive);
    expect(inactive.style.backgroundColor).toBe('transparent');

    // Control: the handler is live and the active tool is exempt from it. The
    // active tool carries its own token, which the hover must not overwrite.
    expect(active.style.backgroundColor).toBe('var(--color-tool-active-bg)');
    fireEvent.mouseEnter(active);
    fireEvent.mouseLeave(active);
    expect(active.style.backgroundColor).toBe('var(--color-tool-active-bg)');
  });

  // Regression: the hover tint must be *cleared* on leave, not merely replaced by
  // another tint -- so the sequence matters. Entering twice and leaving once must
  // still clear, which is what distinguishes a handler that runs from one that
  // only ever sets a value.
  it('clears the tint after repeated hovers on the same button', () => {
    seed({ activeTool: 'select' });
    renderToolbar();

    const inactive = toolButton('text');
    fireEvent.mouseEnter(inactive);
    fireEvent.mouseEnter(inactive);
    expect(inactive.style.backgroundColor).toBe('var(--color-tool-hover-bg)');

    fireEvent.mouseLeave(inactive);
    expect(inactive.style.backgroundColor).toBe('transparent');
  });

  // Regression: hovering a *different* tool after leaving the first leaves both
  // buttons at rest. The inline styles are per-element, so a stale tint on the
  // abandoned button would follow the pointer around the toolbar.
  it('leaves the previously hovered tool at rest when another is hovered', () => {
    seed({ activeTool: 'select' });
    renderToolbar();

    fireEvent.mouseEnter(toolButton('text'));
    fireEvent.mouseLeave(toolButton('text'));
    fireEvent.mouseEnter(toolButton('line'));

    expect(toolButton('text').style.backgroundColor).toBe('transparent');
    expect(toolButton('line').style.backgroundColor).toBe('var(--color-tool-hover-bg)');
  });

  // Regression: the active tool's own styling is a distinct set of tokens from
  // the inactive ones. A merge of the two branches would render an active tool
  // with the inactive foreground and lose the selection entirely -- so the token
  // values themselves are asserted, not just that "something is highlighted".
  it('paints the active tool with the active tokens and others with inactive ones', () => {
    seed({ activeTool: 'rectangle' });
    renderToolbar();

    const active = toolButton('rectangle');
    expect(active.style.backgroundColor).toBe('var(--color-tool-active-bg)');
    expect(active.style.color).toBe('var(--color-tool-active-text)');
    expect(active.style.boxShadow).toContain('var(--color-tool-active-shadow)');

    const inactive = toolButton('ellipse');
    expect(inactive.style.backgroundColor).toBe('');
    expect(inactive.style.color).toBe('var(--color-tool-inactive-text)');
    expect(inactive.style.boxShadow).toBe('');
  });
});

describe('CanvasToolbar affordances', () => {
  // Regression: the active tool is announced through a polite live region, so a
  // screen-reader user learns the tool changed without hunting for the pressed
  // state. The *label* is resolved from the tool table, not the raw id, and the
  // `?? activeTool` fallback covers an id the table does not know.
  it('announces the active tool by its table label', () => {
    seed({ activeTool: 'freedraw' });
    const { container } = renderToolbar();

    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).not.toBeNull();
    expect(live).toHaveClass('sr-only');
    expect(live).toHaveTextContent('Freehand tool active');
  });

  // Regression: the fallback arm. An unknown tool id must still be announced --
  // silently showing nothing would leave the user with no confirmation at all.
  it('falls back to the raw tool id when the table has no label', () => {
    seed({ activeTool: 'unlisted-tool' as ActiveTool });
    const { container } = renderToolbar();

    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).toHaveTextContent('unlisted-tool tool active');
  });

  // Regression: every tool button publishes its full shortcut list through
  // `aria-keyshortcuts`, space separated, and its `title` shows the same list
  // slash separated. Asserted for one multi-shortcut tool and one single-shortcut
  // tool, because the join separator is the part a `join(' ')` -> `join(',')`
  // change would break, and only the multi case has two entries.
  it('publishes each tool shortcuts for both the tooltip and assistive tech', () => {
    seed();
    renderToolbar();

    const select = toolButton('select');
    expect(select.getAttribute('aria-keyshortcuts')).toBe('v 1');
    expect(select.getAttribute('title')).toBe('Selection [v / 1]');

    // `hand` has no numeric shortcut, so it contributes only the letter.
    const hand = toolButton('hand');
    expect(hand.getAttribute('aria-keyshortcuts')).toBe('h');
    expect(hand.getAttribute('title')).toBe('Hand [h]');
  });

  // Regression: the numeric badge is rendered only for the tools that declare
  // one, and it carries the declared digit -- not the tool's index. A mismatch
  // would put "9" on a tool whose shortcut is "5".
  it('shows the declared numeric shortcut badge only where one exists', () => {
    seed();
    renderToolbar();

    // The badge's own positioning class is the hook. It appears once per tool
    // that declares a numeric shortcut -- ten of the eleven; `hand` declares only
    // a letter.
    const badges = (button: HTMLElement) => button.querySelectorAll('[class*="bottom-[2px]"]');
    expect(document.querySelectorAll('[class*="bottom-[2px]"]')).toHaveLength(10);

    // The badge carries the declared digit itself, not the tool's index.
    expect(badges(toolButton('eraser'))).toHaveLength(1);
    expect(toolButton('eraser')).toHaveTextContent('0');
    expect(toolButton('image')).toHaveTextContent('9');
    expect(toolButton('select')).toHaveTextContent('1');

    // `hand` must get *no badge element*. Asserting on `textContent` here would be
    // vacuous: an always-rendered badge containing an undefined digit also reads
    // as empty text, so a dropped `{tool.numericShortcut && …}` guard would pass.
    expect(badges(toolButton('hand'))).toHaveLength(0);
    // The button's own accessible name is the ungated sibling control: it is
    // present for every tool regardless of the badge.
    expect(toolButton('hand').getAttribute('aria-label')).toBe('Hand tool');
  });

  // Regression: the toolbar is a labelled horizontal toolbar with a separator
  // between the lock control and the tools. The separator's orientation is what
  // tells a screen reader the lock is not one of the drawing tools.
  it('exposes a horizontal toolbar with an oriented separator', () => {
    seed();
    renderToolbar();

    const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' });
    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');

    const separator = screen.getByRole('separator');
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  });

  // Regression: `ExtraToolsDropdown` is rendered *inside* the toolbar and
  // receives the live `readOnly` value. It is the only child that reads the flag
  // itself rather than getting disabled buttons, so a stale `false` would leave
  // the AI and embed entry points open to a read-only viewer.
  //
  // Asserted through the real dropdown's own consequence for that prop -- its
  // trigger goes disabled -- rather than by stubbing the child. A stub rendering
  // `null` would make the negative half of this vacuous, so the control is the
  // same trigger in the non-read-only case, right below.
  it('passes the live read-only flag to the extra-tools dropdown', () => {
    seed({ readOnly: false });
    renderToolbar();
    const live = screen.getByRole('button', { name: /frame and library tools/i });
    expect(live).toBeEnabled();
    expect(live).toHaveAttribute('aria-expanded', 'false');

    seed({ readOnly: true });
    renderToolbar();
    const gated = screen.getAllByRole('button', { name: /frame and library tools/i })[1]!;
    expect(gated).toBeDisabled();
    // The toolbar's own read-only gate is the ungated sibling control: the tool
    // buttons above were re-read too, so this is a real difference and not a
    // toolbar that failed to render.
    expect(screen.getAllByRole('button', { name: 'Rectangle tool' })[1]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Hand tool' })[1]).toBeEnabled();
  });
});
