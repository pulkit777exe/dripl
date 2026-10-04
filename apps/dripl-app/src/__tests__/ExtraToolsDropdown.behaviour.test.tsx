import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ActiveToolName = 'select' | 'frame' | 'embed' | 'laser';

const mock = vi.hoisted(() => {
  const state = {
    activeTool: 'select' as ActiveToolName,
    setActiveTool: vi.fn(),
    setPendingEmbed: vi.fn(),
  };
  // The component both subscribes (selector form) and reads imperatively
  // (getState form) from the same store, so the double has to exist here too.
  const useCanvasStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return { state, useCanvasStore };
});

vi.mock('@/lib/store', () => ({ useCanvasStore: mock.useCanvasStore }));

// Stubbed so these tests can reach the dropdown's own wiring (which modal it
// opens, what it passes to onSubmit) without dragging in the real modals.
vi.mock('@/components/canvas/AIGenerateModal', () => ({
  AIGenerateModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="AI generate stub">
        <button type="button" onClick={onClose}>
          stub-dismiss-ai
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/canvas/EmbedUrlModal', () => ({
  EmbedUrlModal: ({
    isOpen,
    onClose,
    onSubmit,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (url: string, title?: string) => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Embed url stub">
        <button type="button" onClick={() => onSubmit('https://example.com', 'Example')}>
          stub-submit-embed
        </button>
        <button type="button" onClick={onClose}>
          stub-dismiss-embed
        </button>
      </div>
    ) : null,
}));

import { ExtraToolsDropdown } from '@/components/canvas/ExtraToolsDropdown';

const trigger = () => screen.getByRole('button', { name: /frame and library tools/i });
const menu = () => screen.queryByRole('menu', { name: /more drawing tools/i });
const open = () => fireEvent.click(trigger());
const frameItem = () => screen.getByRole('menuitem', { name: /^frame tool/i });
const webItem = () => screen.getByRole('menuitem', { name: /^web embed/i });
const laserItem = () => screen.getByRole('menuitem', { name: /^laser pointer/i });
const aiItem = () => screen.getByRole('menuitem', { name: /^text to diagram/i });
const mermaidItem = () => screen.getByRole('menuitem', { name: /^mermaid to dripl/i });

function renderWithTool(tool: ActiveToolName, readOnly = false) {
  mock.state.activeTool = tool;
  return render(<ExtraToolsDropdown readOnly={readOnly} />);
}

beforeEach(() => {
  mock.state.activeTool = 'select';
  mock.state.setActiveTool.mockClear();
  mock.state.setPendingEmbed.mockClear();
});

afterEach(() => {
  // Let RTL unmount first: the menu portals into document.body, so tearing the
  // timers down first would leave React detaching nodes from a dead scheduler.
  cleanup();
  vi.useRealTimers();
});

describe('ExtraToolsDropdown tool selection', () => {
  // Regression: a tool handler that sets activeTool but forgets setIsOpen(false)
  // leaves the popover stranded open over the canvas, and the next click on a
  // tool is swallowed by the menu's own outside-click handler.
  it('sets the active tool and closes the menu when the laser tool is chosen', () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.click(laserItem());

    expect(mock.state.setActiveTool).toHaveBeenCalledWith('laser');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  // Regression: the menu is rendered through a portal, so it is not a DOM child
  // of the trigger wrapper. Without the explicit menuRef containment check, the
  // mousedown that precedes every click unmounts the menu before the click
  // lands, and no tool in the menu can ever be activated.
  it('keeps the portal menu open when the press starts inside it, then activates the item', () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.mouseDown(frameItem());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(frameItem());
    expect(mock.state.setActiveTool).toHaveBeenCalledWith('frame');
  });

  // Regression: the press that toggles the trigger must not also count as an
  // outside click. If it did, closing and re-opening would need two clicks and
  // the menu would toggle twice per gesture.
  it('does not treat a press on the trigger as an outside click', () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.mouseDown(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  // Regression: the document mousedown listener is the only thing that closes
  // the menu on a canvas click; dropping it makes the popover unclosable by
  // mouse anywhere outside the menu itself.
  it('closes on a press outside the dropdown and the menu', () => {
    render(<ExtraToolsDropdown />);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    open();

    fireEvent.mouseDown(outside);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  // Regression: "Coming Soon" items must stay inert. If the disabled flag is
  // dropped, an item with no perform handler starts advertising itself as
  // actionable (title/aria-disabled flip) and looks clickable.
  it('leaves the coming-soon items inert and marked as such', () => {
    render(<ExtraToolsDropdown />);
    open();

    const mermaid = mermaidItem();
    expect(mermaid).toBeDisabled();
    expect(mermaid).toHaveAttribute('aria-disabled', 'true');
    expect(mermaid).toHaveAttribute('title', 'Coming Soon');

    fireEvent.click(mermaid);

    expect(mock.state.setActiveTool).not.toHaveBeenCalled();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('ExtraToolsDropdown close animation', () => {
  /** Stubs the CSS custom property the component reads its close delay from. */
  function stubCloseDuration(value: string) {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--dropdown-close-dur' ? value : ''),
    } as unknown as CSSStyleDeclaration);
  }

  // Regression: the menu has a CSS close transition, so it must stay mounted for
  // --dropdown-close-dur after isOpen flips false. A duration that is too short,
  // or one read from the wrong property, cuts the exit animation off.
  it('keeps the menu mounted for the close duration, then unmounts it', () => {
    vi.useFakeTimers();
    // Pinned to a distinctive value: jsdom reports '' for custom properties, so
    // the 150ms fallback would apply and a wrong duration would go unnoticed.
    stubCloseDuration('400ms');

    render(<ExtraToolsDropdown />);
    open();
    fireEvent.click(laserItem());

    // Still mounted, mid-animation.
    expect(menu()).toBeInTheDocument();
    expect(menu()).toHaveClass('is-closing');
    expect(menu()).not.toHaveClass('is-open');

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(menu()).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(menu()).not.toBeInTheDocument();

    vi.restoreAllMocks();
  });

  // Regression: `--dropdown-close-dur` is only defined once the theme CSS is
  // loaded. If the fallback for an unset value were 0 instead of 150, the menu
  // would unmount on the same tick it was closed and the transition would never
  // render — invisible in dev and a visible pop in production.
  it('falls back to a non-zero delay when the duration property is unset', () => {
    vi.useFakeTimers();
    stubCloseDuration('');

    render(<ExtraToolsDropdown />);
    open();
    fireEvent.click(laserItem());

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // A zero fallback would already be gone.
    expect(menu()).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(menu()).not.toBeInTheDocument();

    vi.restoreAllMocks();
  });

  // Regression: the closing effect's cleanup must clear its pending timer. If it
  // does not, a close that is interrupted (the menu reopened, or the whole
  // toolbar unmounted on navigation) leaves a timer that fires setClosing on a
  // state the component no longer owns, tearing down a reopened menu.
  it('clears a pending close timer when the menu is reopened before it fires', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    stubCloseDuration('400ms');

    render(<ExtraToolsDropdown />);
    open();
    fireEvent.click(laserItem());
    expect(menu()).toHaveClass('is-closing');

    // Reopen inside the close window.
    open();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(clearSpy).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // The stale timer must not have knocked the reopened menu back to closed.
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(menu()).toBeInTheDocument();

    vi.restoreAllMocks();
  });
});

describe('ExtraToolsDropdown keyboard control', () => {
  // Regression: focus must move into the menu on open. If it stays on the trigger
  // behind the popover, ArrowDown/Escape are heard by the canvas keybindings and
  // arrow-key tool switching fires instead of menu navigation.
  it('moves focus into the menu on open and returns it to the trigger on Escape', () => {
    render(<ExtraToolsDropdown />);
    open();

    expect(document.activeElement).toBe(frameItem());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger());
  });

  // Regression: the roving focus index is computed from the focused element, so
  // a bad index (no wrap, wrong direction, or an off-by-one) walks the user to
  // the wrong tool. Each key press here has a distinct expected target.
  it('walks the enabled items with the arrow keys and wraps at both ends', () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(webItem());

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(laserItem());

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(aiItem());

    // Wraps forward past the last enabled item.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(frameItem());

    // And backwards past the first.
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(aiItem());
  });

  // Regression: Home/End must jump to the first/last *enabled* item. Roving
  // focus that lands on a disabled "Coming Soon" button silently swallows Enter.
  it('sends Home and End to the first and last enabled items, skipping disabled ones', () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.keyDown(document, { key: 'End' });
    // Text to Diagram is the last enabled item; Mermaid and Wireframe are after it.
    expect(document.activeElement).toBe(aiItem());

    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toBe(frameItem());
  });

  // Regression: keys the menu owns must be consumed with preventDefault. Without
  // it the canvas arrow-key tool switching also fires, so ArrowDown both moves
  // focus *and* swaps the active tool. Keys the menu does not own must still pass
  // through, or the F shortcut and Escape-to-deselect stop working while open.
  it('consumes the keys it owns and leaves the rest to the canvas', () => {
    render(<ExtraToolsDropdown />);
    open();

    expect(fireEvent.keyDown(document, { key: 'ArrowDown' })).toBe(false); // preventDefault'd
    expect(fireEvent.keyDown(document, { key: 'Home' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(false);
    // Escape consumed the key and closed the menu.
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    open();
    expect(fireEvent.keyDown(document, { key: 'f' })).toBe(true); // passed through
    expect(fireEvent.keyDown(document, { key: 'Enter' })).toBe(true);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('ExtraToolsDropdown listener lifecycle', () => {
  type ListenerTarget = {
    addEventListener: (
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: unknown
    ) => void;
    removeEventListener: (
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: unknown
    ) => void;
  };
  /** Wraps add/removeEventListener and records them, keeping the originals callable. */
  function instrument(target: EventTarget, types: string[]) {
    const mutable = target as unknown as ListenerTarget;
    const origAdd = mutable.addEventListener.bind(target);
    const origRemove = mutable.removeEventListener.bind(target);
    const log: Array<{ op: 'add' | 'remove'; type: string; capture: boolean; key: string }> = [];
    // Handlers are functions with no id, so identity is mapped to a serial. The
    // capture flag is part of the key: removeEventListener only matches an add
    // that used the same one, so a mismatched flag must count as still-registered.
    const serials = new Map<EventListenerOrEventListenerObject, number>();
    const keyOf = (handler: EventListenerOrEventListenerObject, capture: unknown) => {
      let serial = serials.get(handler);
      if (serial === undefined) {
        serial = serials.size + 1;
        serials.set(handler, serial);
      }
      return `${serial}|${capture === true}`;
    };
    const push = (op: 'add' | 'remove', type: string, handler: never, capture: unknown) => {
      if (!types.includes(type)) return;
      log.push({ op, type, capture: capture === true, key: keyOf(handler, capture) });
    };
    // The original is captured above, so the pass-through below cannot recurse.
    mutable.addEventListener = (type, handler, options) => {
      push('add', type, handler as never, options);
      origAdd(type, handler, options);
    };
    mutable.removeEventListener = (type, handler, options) => {
      push('remove', type, handler as never, options);
      origRemove(type, handler, options);
    };
    return {
      /** Registrations for `type` that were never matched by a removal. */
      live: (type: string) => {
        const counts = new Map<string, number>();
        for (const entry of log) {
          if (entry.type !== type) continue;
          counts.set(entry.key, (counts.get(entry.key) ?? 0) + (entry.op === 'add' ? 1 : -1));
        }
        return [...counts.values()].filter(count => count > 0).length;
      },
      restore: () => {
        mutable.addEventListener = origAdd;
        mutable.removeEventListener = origRemove;
      },
    };
  }

  // Regression: this component attaches a document mousedown listener, a document
  // keydown listener and window resize/scroll listeners while open. A missing
  // `return` in any of those effects, or a removeEventListener whose capture flag
  // or handler identity does not match the add, accumulates listeners every time
  // the menu is opened. The symptom is a closed menu that still reacts to canvas
  // presses and keys, growing without bound as the user opens it repeatedly.
  it('leaves no document or window listeners behind across repeated open/close cycles', () => {
    const doc = instrument(document, ['mousedown', 'keydown']);
    const win = instrument(window, ['resize', 'scroll']);

    try {
      render(<ExtraToolsDropdown />);
      // Closed state is the baseline: nothing should be registered yet.
      const baseline = {
        mousedown: doc.live('mousedown'),
        keydown: doc.live('keydown'),
        resize: win.live('resize'),
        scroll: win.live('scroll'),
      };
      expect(baseline).toEqual({ mousedown: 0, keydown: 0, resize: 0, scroll: 0 });

      for (let i = 0; i < 3; i++) {
        open(); // opens
        open(); // trigger toggles it shut again
      }

      expect({
        mousedown: doc.live('mousedown'),
        keydown: doc.live('keydown'),
        resize: win.live('resize'),
        scroll: win.live('scroll'),
      }).toEqual(baseline);
    } finally {
      doc.restore();
      win.restore();
    }
  });
});

describe('ExtraToolsDropdown read-only mode', () => {
  // Regression: on a shared read-only canvas the trigger must not open the menu
  // at all; a disabled <button> fires no click, so this is the guard that keeps
  // frame/embed/laser unreachable.
  it('disables the trigger in read-only mode', () => {
    renderWithTool('select', true);

    expect(trigger()).toBeDisabled();

    open();

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(menu()).not.toBeInTheDocument();
  });

  // Regression: a viewer can be promoted to read-only while the menu is open (or
  // a collab permission changes). Without the readOnly effect the open menu would
  // keep offering tools the user can no longer use.
  it('closes an open menu when the component becomes read-only', () => {
    const { rerender } = renderWithTool('select', false);
    open();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    rerender(<ExtraToolsDropdown readOnly />);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ExtraToolsDropdown modal hand-off', () => {
  // Regression: "Web Embed" must hand off to the embed modal and close its own
  // menu. If setShowEmbedModal is dropped the click does nothing; if setIsOpen is
  // dropped the menu stays open on top of the modal.
  it('opens the embed modal from Web Embed and hands the submitted url to the store', async () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.click(webItem());

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    const dialog = await screen.findByRole('dialog', { name: /embed url stub/i });

    fireEvent.click(screen.getByText('stub-submit-embed'));

    // The URL is staged in the store and the tool switched, in that order of
    // consequence: an embed tool activated without a pending url draws nothing.
    expect(mock.state.setPendingEmbed).toHaveBeenCalledWith('https://example.com', 'Example');
    expect(mock.state.setActiveTool).toHaveBeenCalledWith('embed');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-dismiss-embed'));
    expect(screen.queryByRole('dialog', { name: /embed url stub/i })).not.toBeInTheDocument();
  });

  // Regression: the AI generator entry opens the AI modal and closes the menu.
  // Dropping setShowAIModal makes the menu item a no-op.
  it('opens the AI modal from Text to Diagram and closes it again', async () => {
    render(<ExtraToolsDropdown />);
    open();

    fireEvent.click(aiItem());

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(await screen.findByRole('dialog', { name: /ai generate stub/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-dismiss-ai'));
    expect(screen.queryByRole('dialog', { name: /ai generate stub/i })).not.toBeInTheDocument();
  });
});

describe('ExtraToolsDropdown active-tool indicator', () => {
  // Regression: the trigger is the only feedback for which of the three extra
  // tools is armed. If isButtonActive or renderActiveIcon stops following
  // activeTool, the toolbar shows the wrong tool as current.
  it('marks the trigger and swaps its icon for each active tool', () => {
    const cases: Array<[ActiveToolName, string, boolean]> = [
      ['select', 'lucide-library', false],
      ['frame', 'lucide-frame', true],
      ['laser', 'lucide-zap', true],
      ['embed', 'lucide-globe', true],
    ];
    const shown: string[] = [];

    for (const [tool, iconClass, pressed] of cases) {
      const { unmount } = renderWithTool(tool);

      expect(trigger()).toHaveAttribute('aria-pressed', String(pressed));
      // renderActiveIcon's output is the first svg; the ChevronDown follows it.
      const icon = trigger().querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon!.classList.contains(iconClass)).toBe(true);
      shown.push(icon!.getAttribute('class') ?? '');
      unmount();
    }

    // Each armed tool must render its own icon, not a shared or stale one.
    expect(new Set(shown).size).toBe(cases.length);
  });

  // Regression: the highlighted background is driven by isButtonActive. An open
  // menu must read as pressed even when no tool is armed yet.
  it('highlights the trigger whenever the menu is open', () => {
    renderWithTool('select');
    expect(trigger()).toHaveAttribute('aria-pressed', 'false');
    expect(trigger().style.backgroundColor).toBe('transparent');

    open();

    expect(trigger()).toHaveAttribute('aria-pressed', 'true');
    expect(trigger().style.backgroundColor).toBe('var(--color-tool-active-bg)');
  });
});

describe('ExtraToolsDropdown positioning', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: originalWidth,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: originalHeight,
      configurable: true,
    });
  });

  // Regression: the menu is fixed-positioned and anchored off the trigger rect.
  // Both clamps are load-bearing on a short/narrow viewport: without the top clamp
  // the menu renders below the fold on a laptop, and without the right floor it
  // hangs off the right edge of a narrow window.
  it('clamps the menu inside the viewport and re-positions on resize', () => {
    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });

    // Anchor near the bottom-right corner so both clamps are actually exercised:
    //   top  = min(innerHeight - 16, rect.bottom + 8) = min(284, 303) = 284
    //   right= max(8, min(innerWidth - width - 8, innerWidth - rect.right))
    //        width = min(288, max(220, 304)) = 288
    //        = max(8, min(24, 5)) = 8
    let rect = { bottom: 295, right: 315 };
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(() => rect as DOMRect);

    try {
      render(<ExtraToolsDropdown />);
      open();

      expect(menu()).toHaveStyle({ top: '284px', right: '8px' });

      rect = { bottom: 100, right: 200 };
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // top = min(284, 108) = 108; right = max(8, min(24, 120)) = 24
      expect(menu()).toHaveStyle({ top: '108px', right: '24px' });
    } finally {
      rectSpy.mockRestore();
    }
  });
});
