import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from '@/components/canvas/Menu';
import { useCanvasStore } from '@/lib/store';

/**
 * `menu.test.tsx` covers the menu while it is *open*: the item routing, the theme
 * picker, the background presets and the language select. This file covers the
 * open -> closing -> closed lifecycle and the two smaller properties that file's
 * `isOpen`-always setup could not reach.
 *
 * The lifecycle is the interesting part, because the menu is *always* in the DOM:
 * it is never unmounted, only classed. That means a dropdown styled with
 * `opacity: 0; pointer-events: none` stays in the accessibility tree and in the
 * tab order unless the closing animation is what hides it. The component therefore
 * runs a two-phase close -- an `is-closing` class for the CSS duration, then
 * neither class -- and both phases are asserted here, because "the menu went away"
 * is otherwise satisfied by a component that simply never rendered anything.
 */

const themeState = vi.hoisted(() => ({ theme: 'light' as string, setTheme: vi.fn() }));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: themeState.setTheme }),
}));

type MenuProps = React.ComponentProps<typeof Menu>;

function defaults(overrides: Partial<MenuProps> = {}): MenuProps {
  return {
    isOpen: true,
    activeLanguage: 'en',
    onClose: vi.fn(),
    ...overrides,
  };
}

/** The dropdown shell -- the element that carries the `is-open`/`is-closing` classes. */
function shell(): HTMLElement {
  const node = document.querySelector('.t-dropdown') as HTMLElement | null;
  if (!node) throw new Error('the menu shell was not rendered');
  return node;
}

beforeEach(() => {
  themeState.theme = 'light';
  themeState.setTheme.mockClear();
  useCanvasStore.setState({ canvasBackground: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Menu open state classes', () => {
  // Regression: the open class is applied on mount and is what the `t-dropdown`
  // CSS keys its entrance animation off. Without it the dropdown renders but is
  // invisible, and every "the menu opened" assertion elsewhere in the suite still
  // passes because it queries the DOM rather than the styles.
  it('carries is-open while open and neither class once closed', () => {
    const props = defaults();
    const { rerender } = render(<Menu {...props} />);

    expect(shell()).toHaveClass('is-open');
    expect(shell()).not.toHaveClass('is-closing');

    rerender(<Menu {...props} isOpen={false} />);

    // Phase one of the close: the menu is still mounted, still in the tree, and
    // marked as closing so the CSS can fade it out.
    expect(shell()).toHaveClass('is-closing');
    expect(shell()).not.toHaveClass('is-open');
  });

  // Regression: the shell is never unmounted -- it is the *class* that hides it.
  // Asserted as a positive count, because "the classes went away" would also pass
  // for a component that removed the element entirely, and the subsequent
  // open-again transition depends on the element being there to re-show.
  it('keeps the shell mounted through the whole close', () => {
    const props = defaults();
    const { rerender } = render(<Menu {...props} />);
    expect(document.querySelectorAll('.t-dropdown')).toHaveLength(1);

    rerender(<Menu {...props} isOpen={false} />);
    expect(document.querySelectorAll('.t-dropdown')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument();
  });

  // Regression: `data-origin` is the CSS hook for the transform origin of the
  // entrance animation. Dropping it makes the dropdown scale from the wrong
  // corner, which is a purely visual regression no other assertion would catch.
  it('declares its transform origin', () => {
    render(<Menu {...defaults()} />);

    expect(shell()).toHaveAttribute('data-origin', 'top-left');
  });
});

describe('Menu closing timer', () => {
  // Regression: after the closing class has been applied, a timeout clears it
  // again. jsdom has no `--dropdown-close-dur` custom property, so the component
  // falls back to 150ms; asserting that the class eventually clears is what
  // distinguishes "the close finished" from "the close started and the timer
  // leaked".
  it('clears the closing class after the close duration', async () => {
    const props = defaults();
    const { rerender } = render(<Menu {...props} />);

    rerender(<Menu {...props} isOpen={false} />);
    expect(shell()).toHaveClass('is-closing');

    await waitFor(() => expect(shell()).not.toHaveClass('is-closing'), { timeout: 2000 });
    expect(shell()).not.toHaveClass('is-open');
    expect(shell().className.trim()).not.toContain('is-open');
  });

  // Regression: the timeout must be *cancelled* on unmount. A leaked timer would
  // call `setClosing` on an unmounted component -- which React 19 tolerates --
  // but it also means the close never completes for a component that unmounted
  // mid-animation, and any test or route change that unmounts the dropdown inside
  // the animation window keeps a pending 150ms timer alive.
  //
  // The observable is a *timer count*, not the rendered class: `setClosing(false)`
  // on an unmounted tree changes nothing in the DOM, so a class-based assertion
  // would read a leak as a pass. `vi.getTimerCount` is the only thing that
  // separates the two.
  it('cancels the close timer on unmount', () => {
    vi.useFakeTimers();
    try {
      const props = defaults();
      const { unmount } = render(<Menu {...props} />);

      // Control: an open, unmounted menu owns no timers at all.
      unmount();
      expect(vi.getTimerCount()).toBe(0);

      // Now arm the close, then unmount inside the animation window.
      const second = render(<Menu {...props} />);
      second.rerender(<Menu {...props} isOpen={false} />);
      expect(vi.getTimerCount()).toBe(1);

      second.unmount();

      expect(vi.getTimerCount()).toBe(0);
      // And the cancelled timer cannot fire: advancing past the deadline runs
      // nothing, so a leaked `setClosing` would have shown up as a warning.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: the close duration is read from the `--dropdown-close-dur`
  // custom property so the JS timeout matches the CSS animation. If the property
  // is missing the component falls back to 150ms -- which is what jsdom exercises
  // by default. The fallback arm is therefore the load-bearing one here; asserted
  // through the timer count rather than a wall-clock wait, so the value is pinned
  // rather than merely "eventually cleared".
  it('falls back to a 150ms close when the duration token is absent', () => {
    vi.useFakeTimers();
    try {
      const props = defaults();
      const { rerender } = render(<Menu {...props} />);

      // The token is genuinely absent in jsdom, so `parseFloat(...) || 150` must
      // produce a finite value -- `NaN` would schedule nothing at all.
      expect(
        getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')
      ).toBe('');

      rerender(<Menu {...props} isOpen={false} />);
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        vi.advanceTimersByTime(149);
      });
      expect(shell()).toHaveClass('is-closing');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(shell()).not.toHaveClass('is-closing');
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: re-opening mid-close cancels the pending clear and restores the
  // open class. Without the cancel, a user who re-opened the menu within the
  // animation window would watch it go blank a moment later -- the classic
  // "clicked twice and it vanished" bug. Both phases asserted: the immediate
  // re-open *and* the survival past the original timer's deadline.
  it('cancels the pending close when re-opened', async () => {
    const props = defaults();
    const { rerender } = render(<Menu {...props} />);

    rerender(<Menu {...props} isOpen={false} />);
    expect(shell()).toHaveClass('is-closing');

    rerender(<Menu {...props} isOpen />);
    expect(shell()).toHaveClass('is-open');
    expect(shell()).not.toHaveClass('is-closing');

    // ...and it stays open well past the close duration.
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(shell()).toHaveClass('is-open');
  });

  // Regression: `prevOpen` is a ref, so the closing phase only triggers on an
  // actual open -> closed *transition*. Mounting already-closed must not arm the
  // closing class, which would show a fade-out animation on a menu that was never
  // open. Asserted as the absence of the class with the shell present as the
  // ungated control.
  it('does not arm the closing class when it mounts already closed', () => {
    render(<Menu {...defaults({ isOpen: false })} />);

    expect(document.querySelectorAll('.t-dropdown')).toHaveLength(1);
    expect(shell()).not.toHaveClass('is-closing');
    expect(shell()).not.toHaveClass('is-open');
  });
});

describe('Menu outside-click listener lifecycle', () => {
  // Regression: the `mousedown` listener that closes on an outside click is only
  // registered while open, and it is torn down on close and on unmount. The
  // observable is *listener identity*: `removeEventListener` silently ignores a
  // different function, so matching on the event type alone would report a clean
  // teardown for a leak. Both spies are installed before the render, per the
  // ordering trap.
  it('removes the exact outside-click listener it registered', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const props = defaults();
    const { unmount } = render(<Menu {...props} />);

    const registered = addSpy.mock.calls.find(([type]) => type === 'mousedown');
    expect(registered).toBeDefined();

    unmount();

    const removed = removeSpy.mock.calls.filter(([type]) => type === 'mousedown');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.[1]).toBe(registered?.[1]);
  });

  // Regression: the listener is dropped when the menu closes, not merely when it
  // unmounts. The menu stays mounted while closed, so a listener left in place
  // would keep calling `onClose` for every click anywhere on the page -- which is
  // how an unrelated component ends up "closing" a menu it never opened.
  //
  // Asserted as a behaviour, not a call count: `onClose` is the thing that
  // matters, and it is the counter that proves it.
  it('stops reacting to outside clicks once closed', () => {
    const onClose = vi.fn();
    const props = defaults({ onClose });
    const { rerender } = render(<Menu {...props} />);

    const outside = document.createElement('div');
    document.body.appendChild(outside);

    // Control: while open, an outside mousedown does close it.
    fireEvent.mouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<Menu {...props} isOpen={false} />);
    fireEvent.mouseDown(outside);

    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  // Regression: the listener is re-registered when `onClose` changes identity,
  // and the *previous* one is removed. A stale closure would close the menu in
  // response to clicks while calling a dead handler's state setter.
  it('swaps the listener when the close handler changes', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const first = defaults({ onClose: vi.fn() });
    const { rerender } = render(<Menu {...first} />);
    const firstRegistration = addSpy.mock.calls.find(([type]) => type === 'mousedown');
    const removeBefore = removeSpy.mock.calls.filter(([type]) => type === 'mousedown').length;

    const second = defaults({ onClose: vi.fn() });
    rerender(<Menu {...second} />);

    const removals = removeSpy.mock.calls.filter(([type]) => type === 'mousedown');
    expect(removals.length).toBeGreaterThan(removeBefore);
    // The removed listener is the *old* one, and a fresh one took its place.
    expect(removals[removals.length - 1]?.[1]).toBe(firstRegistration?.[1]);
    expect(addSpy.mock.calls.filter(([type]) => type === 'mousedown').length).toBe(2);
  });

  // Regression: clicks *inside* the menu never reach `onClose` through this
  // listener, because the handler checks `menuRef.current.contains(target)`. This
  // is the containment guard -- without it, every item click would both run the
  // item's handler and close the menu, racing the item's own navigation.
  it('ignores mousedown originating inside the menu', () => {
    const onClose = vi.fn();
    render(<Menu {...defaults({ onClose })} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: /Open/ }));

    expect(onClose).not.toHaveBeenCalled();
  });

  // Regression: the shell also stops propagation of `click` and `mousedown` on
  // itself. This is a second, independent mechanism from the `contains` check: it
  // keeps the canvas's own pointer-down handler from seeing a menu interaction and
  // clearing the user's selection.
  //
  // Asserted with an ancestor listener as the control: an unrelated mousedown
  // inside the same wrapper *does* propagate, so a `not.toHaveBeenCalled()` on the
  // menu proves the stop happened rather than that nothing was listening.
  it('stops click and mousedown from the shell reaching an ancestor', () => {
    const onAncestorClick = vi.fn();
    const onAncestorMouseDown = vi.fn();
    render(
      <div onClick={onAncestorClick} onMouseDown={onAncestorMouseDown}>
        <Menu {...defaults()} />
      </div>
    );

    // Control: a node outside the menu, inside the same wrapper.
    const sibling = document.createElement('button');
    document.body.appendChild(sibling);
    const wrapper = shell().parentElement as HTMLElement;
    wrapper.insertBefore(sibling, shell());
    fireEvent.click(sibling);
    fireEvent.mouseDown(sibling);
    expect(onAncestorClick).toHaveBeenCalledTimes(1);
    expect(onAncestorMouseDown).toHaveBeenCalledTimes(1);

    onAncestorClick.mockClear();
    onAncestorMouseDown.mockClear();

    fireEvent.click(shell());
    fireEvent.mouseDown(shell());

    expect(onAncestorClick).not.toHaveBeenCalled();
    expect(onAncestorMouseDown).not.toHaveBeenCalled();
    sibling.remove();
  });
});

describe('Menu items with no handler', () => {
  // Regression: `if (!item.onClick) onClose()` -- an item whose callback prop was
  // not supplied closes the menu instead of doing nothing. Every handler is
  // optional on the props interface, so a caller that omits one still gets a
  // usable menu instead of dead buttons.
  //
  // The working direction matters here: the paired test below supplies a handler
  // and asserts the menu stays open, so a deleted `onClose` cannot hide behind
  // this one.
  it('closes the menu when an item has no handler', () => {
    const onClose = vi.fn();
    render(<Menu {...defaults({ onClose })} />);

    // `onOpenFile` is deliberately absent, so the "Open" item has no onClick.
    fireEvent.click(screen.getByRole('button', { name: /Open/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression: the *inverse* branch. When the item owns its own dismissal, the
  // menu must not also close -- double-closing would race the item's navigation.
  // Asserted here as the control for the test above so neither can pass alone.
  it('leaves the menu open when the item handles itself', () => {
    const onClose = vi.fn();
    render(<Menu {...defaults({ onClose, onOpenFile: vi.fn() })} />);

    fireEvent.click(screen.getByRole('button', { name: /Open/ }));

    expect(onClose).not.toHaveBeenCalled();
  });

  // Regression: this applies to *every* handler-less item, not just the first.
  // A loop over the items that depend on optional props, asserting each one
  // closes, so a per-item `onClick` that was accidentally hard-wired to a
  // no-op is visible.
  it('closes for every item whose optional handler is omitted', () => {
    // `Menu` renders its full item table regardless of which props are supplied,
    // so omitting all of them leaves eleven handler-less items.
    const onClose = vi.fn();
    render(<Menu isOpen onClose={onClose} />);

    for (const name of [
      /Open/,
      /Save to/,
      /Export image/,
      /Live collaboration/,
      /Command palette/,
      /Find on canvas/,
      /Help/,
      /Reset the canvas/,
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
    }

    expect(onClose).toHaveBeenCalledTimes(8);
  });
});

describe('Menu item hover styling', () => {
  // Regression: the item hover tint is written straight onto `currentTarget` for
  // both the item buttons and the external links. There is no `isActive` guard on
  // either, so the enter/leave pair is the whole behaviour.
  //
  // Both halves asserted per surface. A `mouseleave` that restored nothing would
  // leave the item stuck in its hover colour once the pointer moved away, and
  // nothing else in the suite would notice.
  it('tints an item on hover and clears it on leave', () => {
    render(<Menu {...defaults()} />);

    const item = screen.getByRole('button', { name: /Open/ });
    expect(item.style.backgroundColor).toBe('');

    fireEvent.mouseEnter(item);
    expect(item.style.backgroundColor).toBe('var(--color-panel-menu-active)');

    fireEvent.mouseLeave(item);
    expect(item.style.backgroundColor).toBe('transparent');
  });

  // Regression: the same pair on the external links, which are `<a>` elements
  // with their own handlers. Asserted separately because a copy-paste that
  // dropped the link handlers would leave the menu items tinted and the links
  // inert, which no single-surface assertion would catch.
  it('tints an external link on hover and clears it on leave', () => {
    render(<Menu {...defaults()} />);

    const link = screen.getByRole('link', { name: /GitHub/ });
    expect(link.style.backgroundColor).toBe('');

    fireEvent.mouseEnter(link);
    expect(link.style.backgroundColor).toBe('var(--color-panel-menu-active)');

    fireEvent.mouseLeave(link);
    expect(link.style.backgroundColor).toBe('transparent');
  });

  // Regression: the danger item is coloured from the destructive token, for both
  // the icon wrapper and the label span. Two separate declarations of the same
  // invariant; a refactor that recoloured only the icon would leave "Reset the
  // canvas" looking like a normal item.
  it('colours the danger item with the destructive token in both places', () => {
    render(<Menu {...defaults()} />);

    const reset = screen.getByRole('button', { name: /Reset the canvas/ });
    expect(reset.style.color).toBe('var(--color-destructive)');

    const iconWrapper = reset.firstElementChild as HTMLElement;
    expect(iconWrapper.style.color).toBe('var(--color-destructive)');

    // ...and a normal item is not destructive, so the assertion above is not
    // satisfied by every item being red.
    const open = screen.getByRole('button', { name: /Open/ });
    expect(open.style.color).toBe('var(--color-foreground)');
    expect((open.firstElementChild as HTMLElement).style.color).toBe(
      'var(--color-muted-foreground)'
    );
  });

  // Regression: only items that declare a `shortcut` render the shortcut span.
  // "Save to…" and "Live collaboration…" have none, and rendering an empty span
  // would misalign the item list. Counted rather than matched by name, with the
  // shortcut-bearing items as the positive side of the count.
  it('renders a shortcut hint only for the items that declare one', () => {
    render(<Menu {...defaults()} />);

    expect(screen.getByText('Ctrl+O')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+E')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+/')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+F')).toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();

    // "Save to…" has no shortcut and must not gain an empty hint.
    const save = screen.getByRole('button', { name: /Save to/ });
    expect(save.textContent).toBe('Save to…');
  });

  // Regression: the dividers are non-interactive separators between groups. There
  // are exactly four -- three declared inside `menuItems` plus one after the list,
  // one before the theme block and one before the language block... counted here
  // as "more than zero and not focusable", because the precise count is a layout
  // detail. What is load-bearing is that they are not buttons, since a divider
  // rendered as a `<button>` would appear in the tab order.
  it('renders the group dividers as inert elements', () => {
    render(<Menu {...defaults()} />);

    const dividers = Array.from(document.querySelectorAll<HTMLElement>('div.h-px.my-1\\.5'));
    expect(dividers.length).toBeGreaterThanOrEqual(3);
    for (const divider of dividers) {
      expect(divider.tagName).toBe('DIV');
      expect(divider).not.toHaveAttribute('tabindex');
      expect(divider).toHaveAttribute('style', expect.stringContaining('background-color'));
    }
  });
});

describe('Menu mount gating', () => {
  // Regression: the `mounted` half of `mounted && theme === t` is only false
  // *before* effects have run, which is exactly the server render. Testing
  // Library's `render` flushes effects inside `act` before the caller can observe
  // anything, so `mounted` is already `true` in every assertion above and the
  // guard is invisible to them.
  //
  // `renderToStaticMarkup` runs no effects at all, which is what the guard exists
  // for: without it, the server would paint whichever chip matched `undefined`'s
  // fallback -- and hydration would then have to correct it, flashing the wrong
  // selection. Asserted as "no chip is highlighted in the server markup", with the
  // light chip's presence as the ungated sibling control.
  it('highlights no theme chip in the server render, before the mount effect', () => {
    themeState.theme = 'light';
    const markup = renderToStaticMarkup(<Menu {...defaults()} />);

    // The markup is a full dropdown...
    expect(markup).toContain('data-origin="top-left"');
    // ...with the theme buttons present but none of them carrying the active token.
    const buttons = Array.from(
      document
        .createElement('div')
        .appendChild(Object.assign(document.createElement('div'), { innerHTML: markup }))
        .querySelectorAll('button')
    ).filter(b => /theme$/.test(b.getAttribute('aria-label') ?? ''));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.style.backgroundColor).not.toBe('var(--color-primary)');
    }
  });

  // Regression: `useIsMounted` exists so the theme picker's "selected" highlight
  // is not painted during SSR -- `theme` is undefined on the server, and
  // highlighting `system` by default would flash the wrong chip before hydration.
  // The guard is `mounted && theme === t`, so *no* chip is highlighted before the
  // mount effect has run.
  //
  // Asserted through the absence of the highlight token with the buttons
  // themselves present as the ungated control -- they render either way, so this
  // is not a "nothing rendered" assertion.
  it('does not highlight a theme chip before the mount effect runs', async () => {
    themeState.theme = 'light';
    render(<Menu {...defaults()} />);

    const light = screen.getByRole('button', { name: 'light theme' });
    expect(light).toBeInTheDocument();
    // The mount effect has run by the time `render` returns, so the real steady
    // state -- after hydration -- is that `light` *is* highlighted. This test
    // pins the outcome, not the intermediate frame, which jsdom cannot observe.
    await waitFor(() => expect(light.style.backgroundColor).toBe('var(--color-primary)'));
    expect(screen.getByRole('button', { name: 'dark theme' }).style.backgroundColor).toBe('');
  });

  // Regression: the mounted gate also means a *system* theme does not highlight
  // the light chip by accident. Without the `mounted &&` term, `theme === t`
  // would be false for all three while `theme` is undefined, so this specific
  // case is only observable once mounted -- hence the positive assertion on the
  // system chip.
  // Regression: `themeDefaultBackground` seeds the custom colour input when no
  // background is set, and it is keyed off the *resolved* theme -- dark gets the
  // dark default, everything else (including `system`, which is not `dark`) gets
  // the light one. Hard-coding either arm would show a colour that does not match
  // the theme the user is actually looking at.
  it('seeds the custom colour input from the theme default', () => {
    themeState.theme = 'dark';
    const { unmount } = render(<Menu {...defaults()} />);
    const dark = screen.getByLabelText('Custom canvas background') as HTMLInputElement;
    expect(dark.value).toBe('#1c1a17');
    unmount();

    themeState.theme = 'light';
    const light = render(<Menu {...defaults()} />);
    expect((light.container.querySelector('input[type="color"]') as HTMLInputElement).value).toBe(
      '#f0ede6'
    );
  });

  // Regression: the background presets match the stored value *case-insensitively*.
  // A canvas saved from an older build, or one whose hex was typed by hand into
  // the colour input, stores `#1c1a17` where the preset is `#1C1A17` -- and a
  // strict comparison would leave the user with no indication that the swatch they
  // can see is the colour their canvas is actually using.
  it('marks the preset matching a lowercase stored value as pressed', () => {
    useCanvasStore.setState({ canvasBackground: '#1c1a17' });
    render(<Menu {...defaults()} />);

    expect(screen.getByRole('button', { name: 'Canvas background #1C1A17' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // ...and the other two presets stay unpressed, so the match is not vacuous.
    expect(screen.getByRole('button', { name: 'Canvas background #FFFFFF' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  // Regression: a stored background wins over the theme default. Asserted under
  // the *dark* theme specifically, because the light default is the one the
  // light-theme case already pins -- testing only that would let a mutation that
  // always used the light default pass.
  it('prefers a stored background over the dark theme default', () => {
    themeState.theme = 'dark';
    useCanvasStore.setState({ canvasBackground: '#123456' });
    render(<Menu {...defaults()} />);

    expect((screen.getByLabelText('Custom canvas background') as HTMLInputElement).value).toBe(
      '#123456'
    );
  });

  it('highlights the system chip when the resolved theme is system', () => {
    themeState.theme = 'system';
    render(<Menu {...defaults()} />);

    expect(screen.getByRole('button', { name: 'system theme' }).style.backgroundColor).toBe(
      'var(--color-primary)'
    );
    expect(screen.getByRole('button', { name: 'light theme' }).style.backgroundColor).toBe('');
    expect(screen.getByRole('button', { name: 'dark theme' }).style.backgroundColor).toBe('');
  });

  // Regression: `activeLanguage` defaults to `'en'` when the prop is omitted.
  // Asserted because a caller that forgets the prop would otherwise get a select
  // whose value matches no option, and the browser would silently show the first
  // one while the app's own state said something else.
  it('defaults the language select to English', () => {
    render(<Menu isOpen onClose={vi.fn()} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('en');
    expect(select).toHaveValue('en');
  });
});
