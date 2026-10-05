import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `components/canvas/CanvasRoomRoute.tsx` had **not one of its 14 statements covered** —
 * and it is the interactive half of every collaboration room, so nothing in it had ever
 * run. What lives here is three things nothing else owns:
 *
 *   theme plumbing  — the component is a client boundary precisely because `next-themes`
 *                     resolves the theme from `localStorage`/`system` in the browser. The
 *                     resolved theme has to reach both the backdrop class *and*
 *                     `CanvasBootstrap`, and the two are different decisions: get one
 *                     right and the canvas is still drawn for the wrong theme.
 *   help            — the help affordance has two independent triggers, and the second
 *                     one is a `window` event the `TopBar` dispatches because it does not
 *                     reach into route state. If the listener is missing, the Help button
 *                     in the top bar is dead, and nothing else in the app would notice.
 *   lazy palette    — `CommandPalette` is loaded through `next/dynamic` with `ssr: false`
 *                     and its **named** export resolved by hand (`m.CommandPalette`).
 *                     Both halves are silent failures: drop `ssr: false` and the palette
 *                     is part of the server render it was excluded from, and change
 *                     `m.CommandPalette` to `m.default` and the module has no default
 *                     export, so the lazy chunk resolves to `undefined`.
 *
 * The canvas chrome around all of it is stubbed — `CanvasBootstrap` pulls in the whole
 * editor, Rough.js and the bitmap cache, and `CanvasBootstrap.*.test.tsx` already covers
 * it. What this file asserts is what it *hands to* that machinery.
 */

/**
 * `next/dynamic` is replaced with a `React.lazy` that actually invokes the loader, so
 * "the palette was rendered" is evidence that the loader ran **and** that the export the
 * source picked off the module is the one React received. A no-op stub (`() => () => null`,
 * the shortcut used elsewhere in this suite) would leave that unpinned: it would report
 * the palette as mounted even if `m.CommandPalette` had become `m.default`.
 */
const dynamicCalls = vi.hoisted(() => ({ list: [] as Array<{ options: { ssr?: boolean } }> }));

vi.mock('next/dynamic', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    default: (
      loader: () => Promise<unknown>,
      options: { ssr?: boolean }
    ): React.FC<Record<string, never>> => {
      dynamicCalls.list.push({ options });
      // `next/dynamic`'s own contract: the loader resolves to the component *itself*
      // (which is why the source writes `.then(m => m.CommandPalette)`), so the value is
      // re-wrapped into the `{ default }` shape `React.lazy` requires. Wrapping it here
      // rather than stubbing the whole thing out is what makes the rendered palette
      // evidence that the source's own `.then` picked a real export.
      const Lazy = React.lazy(() =>
        loader().then(mod => ({ default: mod as React.ComponentType }))
      );
      return function DynamicStub(): React.ReactNode {
        return React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy));
      };
    },
  };
});

// Named export, so the suite can assert the *lazy* palette mounted rather than trusting
// the resolution to have worked.
vi.mock('@/components/canvas/CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

const bootstrapProps = vi.hoisted(() => vi.fn<(props: BootstrapShape) => void>());

type BootstrapShape = { mode: string; roomSlug: string; theme: string };

vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: (props: BootstrapShape) => {
    bootstrapProps(props);
    return <div data-testid="canvas-bootstrap" />;
  },
}));

vi.mock('@/components/canvas/TopBar', () => ({ TopBar: () => <div data-testid="top-bar" /> }));
vi.mock('@/components/canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <div data-testid="canvas-toolbar" />,
}));
vi.mock('@/components/canvas/CanvasControls', () => ({
  CanvasControls: () => <div data-testid="canvas-controls" />,
}));

// Observable, so "did anything open it" is a real assertion: a `null` stub makes every
// help test pass against a route that never opened anything, provided it also never
// crashed.
vi.mock('@/components/canvas/HelpModal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="help-modal">
        <button onClick={onClose}>close-help</button>
      </div>
    ) : null,
}));

// Passthrough, and recorded by name so "the palette is inside the palette boundary" can
// be checked rather than assumed.
const boundaryNames = vi.hoisted(() => ({ seen: [] as string[] }));

vi.mock('@/components/canvas/CanvasErrorBoundary', () => ({
  CanvasErrorBoundary: ({ name, children }: { name: string; children: React.ReactNode }) => {
    boundaryNames.seen.push(name);
    return <>{children}</>;
  },
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: mockTheme }),
}));

import { CanvasRoomRoute } from '@/components/canvas/CanvasRoomRoute';

let mockTheme: 'light' | 'dark' = 'dark';

/** Records `(type, handler)` for add/remove so leaks can be matched on identity. */
function spyOnWindowListeners(): {
  added: Array<{ type: string; handler: unknown }>;
  removed: Array<{ type: string; handler: unknown }>;
  restore: () => void;
} {
  const added: Array<{ type: string; handler: unknown }> = [];
  const removed: Array<{ type: string; handler: unknown }> = [];
  const realAdd = window.addEventListener;
  const realRemove = window.removeEventListener;

  const addSpy = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation(function (type, listener, options) {
      added.push({ type, handler: listener });
      realAdd.call(window, type, listener, options);
    });
  const removeSpy = vi
    .spyOn(window, 'removeEventListener')
    .mockImplementation(function (type, listener, options) {
      removed.push({ type, handler: listener });
      realRemove.call(window, type, listener, options);
    });

  return {
    added,
    removed,
    restore: () => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `dynamicCalls.list` is deliberately *not* reset: `next/dynamic` is invoked once at
  // module scope when `CanvasRoomRoute` is imported, which is exactly the statement the
  // "excluded from the server render" test exists to pin. Clearing it per test would make
  // that assertion unreachable.
  boundaryNames.seen.length = 0;
  mockTheme = 'dark';
});

describe('CanvasRoomRoute — what it hands to the canvas', () => {
  /**
   * Regression: the room id is the `roomSlug` prop, and the mode is the constant
   * `"room"`. They are the two values that decide what `CanvasBootstrap` builds — a
   * route that passed the file id as the *mode*, or defaulted the mode, mounts a whole
   * different canvas lifecycle and the route still renders a full-looking page.
   * Asserted by rendering with a room id and reading the props back.
   */
  it('mounts the bootstrap in room mode with the room id', () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    expect(bootstrapProps).toHaveBeenCalledTimes(1);
    expect(bootstrapProps.mock.calls[0]?.[0]).toMatchObject({
      mode: 'room',
      roomSlug: 'design-review',
    });
  });

  /**
   * Regression: two different room ids produce two different `roomSlug` values. The
   * control for the assertion above — a build that hard-coded the slug, or read the prop
   * once at module scope, renders an identical string for this fixture and would let the
   * previous test be the only thing standing.
   */
  it('passes each room id through rather than a fixed one', () => {
    render(<CanvasRoomRoute roomId="launch-plan" />);

    expect(bootstrapProps.mock.calls[0]?.[0].roomSlug).toBe('launch-plan');
    expect(screen.getByTestId('canvas-bootstrap')).toBeInTheDocument();
  });

  /**
   * Regression: the *resolved* theme is what the canvas is drawn for, and it is only
   * known in the browser — that is the stated reason this component is a client boundary
   * at all. It reaches `CanvasBootstrap` as a prop, and getting this wrong means the
   * canvas renders its rough strokes and text in the wrong ink with nothing visibly
   * broken.
   */
  it('passes the resolved theme to the bootstrap', () => {
    mockTheme = 'light';

    render(<CanvasRoomRoute roomId="design-review" />);

    expect(bootstrapProps.mock.calls[0]?.[0].theme).toBe('light');
  });

  /**
   * Regression: the backdrop tracks the same theme. Dark is asserted against light
   * because this is a two-armed conditional whose failure is invisible at a glance — the
   * page renders identically either way, just tinted wrongly.
   */
  it('paints a dark backdrop for the dark theme', () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    expect(screen.getByTestId('canvas-bootstrap').closest('.w-screen')?.className).toContain(
      'bg-[#1A1714]'
    );
  });

  /**
   * The other arm of the same conditional. Without it, a build that had hard-coded the
   * dark class would pass the test above.
   */
  it('paints a light backdrop for the light theme', () => {
    mockTheme = 'light';

    render(<CanvasRoomRoute roomId="design-review" />);

    const backdrop = screen.getByTestId('canvas-bootstrap').closest('.w-screen')?.className;
    expect(backdrop).toContain('bg-[#F5F0E8]');
    expect(backdrop).not.toContain('bg-[#1A1714]');
  });

  /**
   * Regression: the theme reaches *both* consumers. A build that passed the theme to the
   * bootstrap but hard-coded the backdrop class — or the reverse — leaves one of the two
   * arms of the pair untested by any single assertion, and the mismatch is a dark canvas
   * on a light page.
   */
  it('agrees between the backdrop and the bootstrap theme', () => {
    const { unmount } = render(<CanvasRoomRoute roomId="design-review" />);
    const darkBackdrop = screen
      .getByTestId('canvas-bootstrap')
      .closest('.w-screen')
      ?.className.includes('bg-[#1A1714]');
    unmount();

    mockTheme = 'light';
    render(<CanvasRoomRoute roomId="design-review" />);
    const lightBackdrop = screen
      .getByTestId('canvas-bootstrap')
      .closest('.w-screen')
      ?.className.includes('bg-[#1A1714]');

    expect(darkBackdrop).toBe(true);
    expect(lightBackdrop).toBe(false);
  });

  /**
   * Regression: the chrome around the canvas is mounted, each in its own error boundary.
   * These are what make the route a *room* rather than a bare canvas; a route that
   * dropped the toolbar or the zoom controls would still render a full, working-looking
   * page that nobody could draw with.
   */
  it('mounts the top bar, the toolbar and the zoom controls', () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    expect(screen.getByTestId('top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-controls')).toBeInTheDocument();
  });
});

describe('CanvasRoomRoute — the lazily loaded command palette', () => {
  /**
   * Regression: the palette's module is resolved by hand to pick the **named** export.
   * `CommandPalette` has no default export, so a build that wrote `m.default` resolves
   * the lazy chunk to `undefined` and nothing renders — silently, because the palette is
   * invisible until `Cmd-K`. This assertion resolves the real loader and checks what
   * React received.
   */
  it('resolves the palette from its named export', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeInTheDocument());
  });

  /**
   * Regression: the palette is excluded from the server render. `next-themes` and the
   * editor store are client-only, so `{ ssr: false }` is what keeps the route from
   * throwing during SSR — and dropping it fails at build/deploy time rather than in any
   * assertion here, which is exactly why the option is asserted rather than assumed.
   */
  it('asks for the palette to be excluded from the server render', () => {
    expect(dynamicCalls.list).toHaveLength(1);
    expect(dynamicCalls.list[0]?.options).toEqual({ ssr: false });
  });

  /**
   * Regression: the palette sits inside its own error boundary, named for what it is.
   * An error inside a lazy chunk that is not wrapped takes down the whole route; the
   * boundary names are asserted so the wrapper cannot be dropped and left unnoticed,
   * since a passthrough boundary renders identically.
   */
  it('wraps the palette in its own error boundary', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeInTheDocument());
    expect(boundaryNames.seen).toContain('CommandPalette');
    expect(new Set(boundaryNames.seen).size).toBe(4);
  });

  /**
   * The control for the boundary-name assertion above: this is a *five* named region
   * region set (TopBar, CanvasToolbar, CanvasControls, CommandPalette) with a distinct
   * name each, so the set size is a real claim rather than a tautology over one value.
   * Asserting the exact names also pins that the bootstrap is deliberately *not*
   * wrapped — it owns its own recovery.
   */
  it('wraps each chrome region separately and leaves the bootstrap unwrapped', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeInTheDocument());
    expect(boundaryNames.seen).toEqual([
      'TopBar',
      'CanvasToolbar',
      'CanvasControls',
      'CommandPalette',
    ]);
  });
});

describe('CanvasRoomRoute — the help affordance', () => {
  /**
   * Regression: the floating Help button opens the modal. This is the trigger a user can
   * reach on this route without the top bar, and it is the only place `isHelpOpen` is
   * set from user input.
   */
  it('opens help from the floating button', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    expect(screen.queryByTestId('help-modal')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    });

    expect(screen.getByTestId('help-modal')).toBeInTheDocument();
  });

  /**
   * Regression: the modal can be closed again. `onClose` is `() => setIsHelpOpen(false)`
   * — without it the modal covers the canvas with no way out except a reload, which is
   * the one failure a user cannot route around.
   */
  it('closes help again', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('close-help'));
    });

    expect(screen.queryByTestId('help-modal')).toBeNull();
  });

  /**
   * Regression: `TopBar` dispatches `dripl:open-help` on `window` rather than reaching
   * into route state, so the listener in this component is the *only* thing that makes
   * the top bar's Help button work on this route. Nothing else in the app would notice
   * its absence.
   */
  it('opens help from the dripl:open-help event', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    expect(screen.queryByTestId('help-modal')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('dripl:open-help'));
    });

    expect(screen.getByTestId('help-modal')).toBeInTheDocument();
  });

  /**
   * Regression: the two triggers are independent, not two readings of one flag. Opening
   * from the event and then closing through the modal proves the event handler does not
   * latch the modal open — a `setIsHelpOpen(true)` outside `useState`'s updater, or a
   * missing `setIsHelpOpen(false)` in `onClose`, would leave it stuck.
   */
  it('closes the event-opened modal through the modal', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);
    await act(async () => {
      window.dispatchEvent(new Event('dripl:open-help'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('close-help'));
    });

    expect(screen.queryByTestId('help-modal')).toBeNull();
  });

  /**
   * Regression: a repeated event does not stack modals. `setIsHelpOpen(true)` is
   * idempotent, so the assertion is that exactly one modal is in the tree — the failure
   * this guards is a listener that *appends* rather than setting, which would render a
   * second copy of the modal over the first.
   */
  it('renders one modal no matter how many times the event fires', async () => {
    render(<CanvasRoomRoute roomId="design-review" />);

    await act(async () => {
      window.dispatchEvent(new Event('dripl:open-help'));
    });
    await act(async () => {
      window.dispatchEvent(new Event('dripl:open-help'));
    });

    expect(screen.getAllByTestId('help-modal')).toHaveLength(1);
  });

  /**
   * Regression: the listener is removed on unmount, **and it is the same handler that was
   * added**. `removeEventListener` silently ignores an unrelated function, so a cleanup
   * that passed a fresh closure — or a differently-named local — would typecheck, would
   * look right in a diff, and would leak. Matching on reference identity is the only
   * assertion that catches it; the counter is what catches the "no cleanup at all" case.
   *
   * The spy is installed before the render it observes, which is required: a spy added
   * afterwards records nothing.
   */
  it('removes the very handler it added, exactly once, on unmount', () => {
    const listeners = spyOnWindowListeners();
    try {
      const { unmount } = render(<CanvasRoomRoute roomId="design-review" />);

      const added = listeners.added.filter(entry => entry.type === 'dripl:open-help');
      expect(added).toHaveLength(1);

      unmount();

      const removed = listeners.removed.filter(entry => entry.type === 'dripl:open-help');
      expect(removed).toHaveLength(1);
      // Reference identity, not structural equality: two closures with identical bodies
      // are different handlers as far as `removeEventListener` is concerned.
      expect(removed[0]?.handler).toBe(added[0]?.handler);
    } finally {
      listeners.restore();
    }
  });

  /**
   * Regression: no listener accumulates across navigation. Asserted as a *count* of
   * surviving subscriptions rather than "the modal did not open" — once the component is
   * gone, a leaked listener calling `setIsHelpOpen(true)` on an unmounted tree renders
   * nothing at all, so the behavioural version of this check passes either way. Two
   * mount/unmount cycles that leave two live subscriptions open one modal per press.
   */
  it('leaves no open-help subscription behind after repeated mounts', () => {
    const listeners = spyOnWindowListeners();
    try {
      for (let i = 0; i < 3; i += 1) {
        const { unmount } = render(<CanvasRoomRoute roomId="design-review" />);
        unmount();
      }

      const added = listeners.added.filter(entry => entry.type === 'dripl:open-help');
      const removed = listeners.removed.filter(entry => entry.type === 'dripl:open-help');

      expect(added).toHaveLength(3);
      expect(removed).toHaveLength(3);
      // Identity per cycle, so a cleanup that removed the wrong one cannot pass by
      // matching counts alone.
      added.forEach((entry, index) => {
        expect(removed[index]?.handler).toBe(entry.handler);
      });
    } finally {
      listeners.restore();
    }
  });

  /**
   * The control for the count assertions above: a live mount really does subscribe, so
   * "the removed list is empty after unmount" cannot be satisfied by a build that simply
   * never adds a listener. Without this, a route with no listener at all would pass every
   * cleanup test while failing the event test above — the pair is what pins the behaviour.
   */
  it('subscribes while mounted and only unsubscribes on unmount', () => {
    const listeners = spyOnWindowListeners();
    try {
      render(<CanvasRoomRoute roomId="design-review" />);

      expect(listeners.added.filter(entry => entry.type === 'dripl:open-help')).toHaveLength(1);
      expect(listeners.removed.filter(entry => entry.type === 'dripl:open-help')).toHaveLength(0);
    } finally {
      listeners.restore();
    }
  });

  /**
   * Regression: the cleanup subscribes to *nothing* beyond the help event. The route's
   * whole listener surface is that one subscription, so a stray `keydown` or
   * `resize` listener added here would be a leak nothing else in the app accounts for.
   */
  it('adds exactly one window listener, and it is the help event', () => {
    const listeners = spyOnWindowListeners();
    try {
      render(<CanvasRoomRoute roomId="design-review" />);

      expect(listeners.added.map(entry => entry.type)).toEqual(['dripl:open-help']);
    } finally {
      listeners.restore();
    }
  });
});
