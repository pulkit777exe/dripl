import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

/**
 * `components/ui/scroll-area.tsx` is two `forwardRef` wrappers over Radix's
 * scroll-area primitives. Radix owns the overflow measurement, the thumb
 * geometry and the show/hide state machine; none of that is asserted here,
 * because a test for it would be a test for `@radix-ui/react-scroll-area`.
 *
 * What this file contributes:
 *
 *   the composition -- a `Viewport` wrapping the children, a `ScrollBar`, and a
 *     `Corner`. The scrollbar is this file's decision: it is what gives the
 *     scroll area a visible thumb at all, so losing it turns a scrollable region
 *     into one with no affordance;
 *   the base class strings, asserted with no caller class in play, because a
 *     merge test only proves a base value *loses*, which holds for any value;
 *   the `cn(base, className)` order on both wrappers -- caller last, so
 *     `twMerge` drops the base utility in favour of an explicit caller one;
 *   the `orientation` *defaults* on `ScrollBar` and the two mutually exclusive
 *     orientation branches. Getting the default wrong means every bar in the app
 *     lays out for the wrong axis, and getting a branch wrong means a
 *     horizontal bar gets `h-full w-2.5` instead of `h-2.5 flex-col`;
 *   ref forwarding and the `{...props}` spread;
 *   `displayName` mirroring the Radix primitive. In
 *     `@radix-ui/react-scroll-area@1.2.18` the primitives do not define one, so
 *     the mirrors assign `undefined`; the assertions compare wrapper against
 *     primitive rather than against a literal.
 *
 * Two environment facts are worth naming, because without them every assertion
 * below fails for reasons that have nothing to do with this file:
 *
 *   `ResizeObserver` does not exist in jsdom, and Radix's scroll area observes
 *     the viewport with it. Without a stub the mount throws.
 *   Radix only *renders* a scrollbar once its visibility state says so, which
 *     it derives from measured overflow. jsdom measures nothing, so the default
 *     (`type="hover"`) renders nothing at all. Passing `type="always"` on the
 *     root is what makes the bar observable here -- it is a Radix prop this file
 *     forwards untouched, not a workaround for the wrapper.
 */

/**
 * Reports nothing, which is enough for Radix to mount but not to decide that a
 * scrollbar should be visible -- see `stubMeasuredOverflow` for that case.
 */
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
});

/**
 * The prototype layout properties Radix reads to size the thumb, as a plain
 * record so the same list can be installed and removed.
 *
 * A getter rather than a value, so the override is trivially reversible with
 * `delete` — the same reasoning `avatar.wrapper.test.tsx` gives: jsdom defines
 * these on the prototype, so leaving a value behind hands every later element a
 * fake box.
 */
const LAYOUT_PROPS = ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight'] as const;

const LAYOUT_DIMENSIONS: Record<string, number> = {
  offsetWidth: 100,
  offsetHeight: 100,
  clientWidth: 100,
  clientHeight: 100,
};

/**
 * Content three times the viewport, which is the ratio that makes a thumb
 * meaningful: Radix only renders one when `viewport / content` is strictly
 * between 0 and 1.
 */
const CONTENT_PROPS = ['scrollWidth', 'scrollHeight'] as const;

function stubMeasuredOverflow() {
  for (const prop of [...LAYOUT_PROPS, ...CONTENT_PROPS]) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get: () => (prop in LAYOUT_DIMENSIONS ? LAYOUT_DIMENSIONS[prop]! : 300),
    });
  }
  // The observing stub has to deliver, or the sizes never reach the bar.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
  );
}

function unstubMeasuredOverflow() {
  for (const prop of [...LAYOUT_PROPS, ...CONTENT_PROPS]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  unstubMeasuredOverflow();
});

type RootProps = React.ComponentProps<typeof ScrollArea>;
type BarProps = React.ComponentProps<typeof ScrollBar>;

/**
 * A scroll area with its bar forced visible.
 *
 * `type="always"` reaches Radix's root untouched (it is in `...props`), which
 * is the only way to observe the bar in jsdom.
 */
function renderScrollArea(children: React.ReactNode = 'content', rootProps: RootProps = {}) {
  return render(
    <ScrollArea data-testid="root" type="always" {...rootProps}>
      {children}
    </ScrollArea>
  );
}

/** The bars rendered inside a scroll area, in DOM order. */
function bars(root: HTMLElement = screen.getByTestId('root')) {
  return [...root.querySelectorAll('[data-orientation]')] as HTMLElement[];
}

describe('ScrollArea', () => {
  // Regression: `relative overflow-hidden` on the root is the whole mechanism.
  // Without `relative` the bar's absolute positioning resolves against some
  // ancestor instead and the bar drifts; without `overflow-hidden` the viewport
  // paints outside the rounded box the caller styled.
  it('declares its base positioning and clipping when no className is given', () => {
    renderScrollArea();

    expect(screen.getByTestId('root')).toHaveClass('relative', 'overflow-hidden');
  });

  // Regression: `cn(base, className)` puts the caller last. Reversed, an
  // explicit caller height or clipping choice is dropped and the scroll area
  // keeps the default — while still scrolling correctly, so the regression is
  // invisible in behaviour and obvious only on screen.
  it('resolves conflicting clipping and sizing classes in the caller favour', () => {
    renderScrollArea('content', { className: 'overflow-auto h-64' });

    const root = screen.getByTestId('root');
    expect(root).toHaveClass('overflow-auto', 'h-64');
    // Conflicts with the base `overflow-hidden` and nothing else, so its loss
    // is evidence the caller's value won.
    expect(root.className).not.toContain('overflow-hidden');
    // Non-conflicting base utility survives.
    expect(root).toHaveClass('relative');
  });

  // Regression: the children are wrapped in Radix's `Viewport`, which is the
  // element that actually scrolls and carries `data-radix-scroll-area-viewport`.
  // The wrapper's own class string is `h-full w-full rounded-[inherit]`, and that
  // last utility is what makes a caller's rounded corners clip the scrolling
  // content rather than the content painting square over them.
  it('wraps the children in a viewport that fills the root and inherits its rounding', () => {
    renderScrollArea(<p data-testid="child">content</p>);

    const root = screen.getByTestId('root');
    const viewport = root.querySelector('[data-radix-scroll-area-viewport]');
    expect(viewport).not.toBeNull();
    expect(viewport).toHaveClass('h-full', 'w-full', 'rounded-[inherit]');
    expect(viewport).toContainElement(screen.getByTestId('child'));
  });

  // Regression: the wrapper mounts its own vertical `ScrollBar` after the
  // viewport. This is the file's contribution — Radix renders nothing on its
  // own — and without it a scrollable region has no visible thumb, so a user
  // cannot tell there is more canvas below the fold.
  it('mounts a vertical scroll bar alongside the viewport', () => {
    renderScrollArea();

    const rendered = bars();
    // One bar: the wrapper's. A caller passing their own `<ScrollBar>` child
    // would add a second, and the root would then have two thumbs on one axis.
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toHaveAttribute('data-orientation', 'vertical');
  });

  // Regression: the `Corner` is the square where a horizontal and a vertical
  // bar would overlap. It is a sibling of the viewport, declared here, and
  // dropping it leaves the thumb of one axis drawn under the other.
  it('renders the corner element Radix uses to inset the overlapping bars', () => {
    renderScrollArea();

    // Radix renders the corner as a div carrying the corner-width/height custom
    // properties on the root; its presence is what proves the wrapper mounted
    // `ScrollAreaPrimitive.Corner` rather than leaving it out.
    const root = screen.getByTestId('root');
    expect(root.style.getPropertyValue('--radix-scroll-area-corner-width')).not.toBe('');
    expect(root.style.getPropertyValue('--radix-scroll-area-corner-height')).not.toBe('');
  });

  // Regression: `ref={ref}` plus the `{...props}` spread. Ref is how a caller
  // measures the scroll container (a virtualiser needs its height), and the
  // spread is how it attaches an id or a `type`.
  it('forwards its ref and extra props to the root element', () => {
    const nodes: HTMLElement[] = [];

    renderScrollArea('content', {
      id: 'files-scroll',
      ref: node => {
        if (node) nodes.push(node);
      },
    });

    const root = screen.getByTestId('root');
    expect(root).toHaveAttribute('id', 'files-scroll');
    expect(nodes).toEqual([root]);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(ScrollArea.displayName).toBe(
      (ScrollAreaPrimitive.Root as { displayName?: string }).displayName
    );
  });
});

describe('ScrollBar', () => {
  /**
   * A scroll area with an extra caller-supplied bar, so the bar under test is
   * identified by its `data-testid` rather than by position — the wrapper's own
   * bar is also in the tree, and confusing the two would make every assertion
   * below pass against the wrong element.
   *
   * Only `type` on the *root* decides whether Radix renders a bar at all; it is
   * not a `ScrollBar` prop, so `renderScrollArea` sets it and this helper does
   * not repeat it.
   */
  function renderBar(barProps: BarProps = {}) {
    renderScrollArea(
      <>
        content
        <ScrollBar data-testid="bar" {...barProps} />
      </>
    );
    return screen.getByTestId('bar');
  }

  // Regression: `orientation` defaults to `'vertical'` here. Radix's own
  // scrollbar defaults to horizontal-agnostic `undefined`, which makes the
  // layout conditional and the thumb track unstyled. A wrong default here gives
  // every scroll bar in the app the wrong box: `h-full w-2.5` on a horizontal
  // bar is a full-height sliver down the side of the content.
  it('defaults to the vertical orientation and its vertical layout', () => {
    const bar = renderBar();

    expect(bar).toHaveAttribute('data-orientation', 'vertical');
    expect(bar).toHaveClass('h-full', 'w-2.5', 'border-l', 'border-l-transparent', 'p-[1px]');
    // The horizontal branch must not also apply: `flex-col` and the `border-t`
    // pair belong to the other axis.
    expect(bar.className).not.toContain('flex-col');
    expect(bar.className).not.toContain('border-t-transparent');
    expect(bar.className).not.toContain('h-2.5');
  });

  // Regression: the two orientation branches are mutually exclusive and each
  // carries its own geometry. Mirroring the vertical branch (`h-2.5 flex-col
  // border-t`) is the specific mistake worth pinning: a horizontal bar laid out
  // as a vertical one sits flush against the content it scrolls.
  it('lays a horizontal bar out on the other axis', () => {
    const bar = renderBar({ orientation: 'horizontal' });

    expect(bar).toHaveAttribute('data-orientation', 'horizontal');
    expect(bar).toHaveClass('h-2.5', 'flex-col', 'border-t', 'border-t-transparent', 'p-[1px]');
    expect(bar.className).not.toContain('h-full');
    expect(bar.className).not.toContain('w-2.5');
    expect(bar.className).not.toContain('border-l-transparent');
  });

  // Regression: the shared base is declared independently of the orientation
  // branches, so it must hold for both axes. Asserting it only on the vertical
  // bar would leave the horizontal path's base unconstrained.
  it('declares the shared base on a bar of either orientation', () => {
    const shared = ['flex', 'touch-none', 'select-none', 'transition-colors'];

    for (const orientation of ['vertical', 'horizontal'] as const) {
      const bar = renderBar({ orientation });
      for (const cls of shared) {
        expect(bar).toHaveClass(cls);
      }
      cleanup();
    }
  });

  // Regression: `cn(..., className)` puts the caller last. Reversed, an explicit
  // caller width is dropped and the bar keeps `w-2.5` — the caller asked for a
  // wider, more grabbable scrollbar and silently got the default.
  it('resolves conflicting sizing classes in the caller favour', () => {
    const bar = renderBar({ className: 'w-4' });

    expect(bar).toHaveClass('w-4');
    expect(bar.className).not.toContain('w-2.5');
    // The orientation branch itself is not a size the caller touched, so it
    // survives alongside the override.
    expect(bar).toHaveClass('h-full');
  });

  // Regression: the thumb is this file's markup, not Radix's — a scrollbar with
  // no thumb renders a track and nothing you can drag. The wrapper always mounts
  // it, with no branch on orientation, so the assertion holds for both axes.
  //
  // Radix hides the thumb unless it measures a thumb ratio strictly between 0
  // and 1, so jsdom's uniformly-zero layout has to be replaced with a content
  // box three times the viewport's. `stubMeasuredOverflow` does that, and is
  // undone in `afterEach` — a leaked `offsetHeight` prototype override would
  // silently change every later test's layout maths.
  it('nests the draggable thumb inside the bar for either orientation', async () => {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      stubMeasuredOverflow();
      const bar = renderBar({ orientation });

      // Wait on the thumb being in the tree -- the assertion itself -- rather
      // than on the observer having fired, which is a proxy for it.
      await waitFor(() => expect(bar.firstElementChild).not.toBeNull());
      expect(bar.firstElementChild).toHaveClass('relative', 'flex-1', 'rounded-full', 'bg-border');
      cleanup();
    }
  });

  // Regression: `ref={ref}` plus the `{...props}` spread on the bar, which is
  // how a caller overrides Radix's `type`, or attaches an id for testing.
  it('forwards its ref and extra props to the bar element', () => {
    const nodes: HTMLElement[] = [];

    renderBar({
      id: 'h-bar',
      ref: node => {
        if (node) nodes.push(node);
      },
    });

    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('id', 'h-bar');
    expect(nodes).toEqual([bar]);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(ScrollBar.displayName).toBe(
      (ScrollAreaPrimitive.ScrollAreaScrollbar as { displayName?: string }).displayName
    );
  });
});
