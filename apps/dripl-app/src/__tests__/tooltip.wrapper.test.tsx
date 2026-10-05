import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * `components/ui/tooltip.tsx` is three bare re-exports of Radix's tooltip
 * primitives plus one `forwardRef` wrapper that contributes a class string, a
 * default offset and a forwarded ref. Radix owns open/close, the delay, focus
 * management and positioning; none of that is asserted here, because a test for
 * it would be a test for `@radix-ui/react-tooltip`.
 *
 * What this file contributes, and what is therefore asserted:
 *
 *   the re-exports being *bare* -- if `Tooltip`/`TooltipTrigger` were wrapped,
 *     their own props would silently stop reaching Radix, so identity against
 *     the primitive is pinned rather than inferred from a render;
 *   the content's base class string, asserted with no caller class in play. A
 *     merge test only proves a base value *loses*, which holds for any value;
 *   the `cn(base, className)` order -- caller last, so `twMerge` drops the base
 *     utility in favour of an explicit caller one. Reversed, every override in
 *     the app is dropped while the tooltip still renders;
 *   ref forwarding and the `{...props}` spread, which is how a caller attaches
 *     an id or a handler to the floating panel;
 *   `displayName` mirroring the Radix primitive. In
 *     `@radix-ui/react-tooltip@1.2.16` the primitive does not define one, so
 *     the mirror assigns `undefined`; the assertion compares wrapper against
 *     primitive rather than a literal, so it keeps holding if a future Radix
 *     names itself.
 *
 * The content only mounts while the tooltip is open, so every render here pins
 * `open`. The `sideOffset` default is asserted the only way jsdom allows: it is
 * not observable in the DOM at all (Radix consumes it into its positioning
 * transform), so instead the *forwarding* is asserted -- an explicit
 * `sideOffset` reaches the primitive, which is the part of the default this
 * file owns. See the `sideOffset` test for why the default value itself is not
 * pinned to a literal.
 */

afterEach(() => {
  cleanup();
});

type ContentProps = React.ComponentProps<typeof TooltipContent>;

/**
 * An open tooltip, because `TooltipContent` renders nothing while closed.
 *
 * `TooltipProvider` is included so the tree matches how a call site uses it: the
 * provider carries the shared delay duration, so omitting it would test a
 * configuration no app screen uses.
 */
function renderTooltip(contentProps: ContentProps = {}) {
  return render(
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger>trigger</TooltipTrigger>
        <TooltipContent data-testid="content" {...contentProps}>
          explanation
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('tooltip re-exports', () => {
  // Regression: these three are aliases, not wrappers. Wrapping any of them --
  // say to add a class -- would swallow that component's own props, because a
  // wrapper that forwards only `className` drops `open`, `delayDuration`,
  // `onOpenChange`, `asChild` and the rest. Identity pins "nothing was added".
  it('exposes the Radix root, trigger and provider unwrapped', () => {
    expect(Tooltip).toBe(TooltipPrimitive.Root);
    expect(TooltipTrigger).toBe(TooltipPrimitive.Trigger);
    expect(TooltipProvider).toBe(TooltipPrimitive.Provider);
  });
});

describe('TooltipContent', () => {
  // Regression: the panel's own look -- the popover surface colour, the 1.5/3
  // padding, the `--popover-foreground` text colour, the `z-50` stacking. This
  // string is declared here and nowhere else, so a rename is invisible unless a
  // test pins it.
  it('declares its base surface, padding and stacking when no className is given', () => {
    renderTooltip();

    expect(screen.getByTestId('content')).toHaveClass(
      'z-50',
      'overflow-hidden',
      'rounded-md',
      'border',
      'bg-popover',
      'px-3',
      'py-1.5',
      'text-sm',
      'text-popover-foreground',
      'shadow-md'
    );
  });

  // Regression: the enter/exit animation set is keyed off `data-[state=...]`
  // and `data-[side=...]`, so the declared attribute selectors and the values
  // Radix actually supplies have to agree. One utility per open/close pair and
  // one per side: dropping any single one leaves the panel popping in or
  // sliding from the wrong edge.
  it('declares the enter, exit and per-side slide animation set', () => {
    renderTooltip();

    const content = screen.getByTestId('content');
    for (const cls of [
      'animate-in',
      'fade-in-0',
      'zoom-in-95',
      'data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0',
      'data-[state=closed]:zoom-out-95',
      'data-[side=top]:slide-in-from-bottom-2',
      'data-[side=right]:slide-in-from-left-2',
      'data-[side=bottom]:slide-in-from-top-2',
      'data-[side=left]:slide-in-from-right-2',
    ]) {
      expect(content.className).toContain(cls);
    }
  });

  // Regression: `cn(base, className)` puts the caller last, so `twMerge` drops
  // the base utility in favour of an explicit caller one. Reversed, a caller
  // asking for `max-w-xs` or a different surface colour would be ignored, and
  // every tooltip in the app would keep the default geometry -- silently, since
  // the component still renders.
  it('resolves conflicting geometry and colour classes in the caller favour', () => {
    renderTooltip({ className: 'max-w-xs px-1 bg-red-500' });

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('max-w-xs', 'px-1', 'bg-red-500');
    // Each of these conflicts with a base utility above, so each proves the
    // caller's value won rather than merely that a class is present.
    expect(content.className).not.toContain('px-3');
    expect(content.className).not.toContain('bg-popover');
    // Non-conflicting base utilities survive the merge.
    expect(content).toHaveClass('z-50', 'rounded-md', 'text-popover-foreground');
    // And the caller's classes come after the base ones.
    expect(content.className.indexOf('max-w-xs')).toBeGreaterThan(
      content.className.indexOf('z-50')
    );
  });

  // Regression: `sideOffset` defaults to 4 here rather than being left to Radix,
  // which is the gap between a control and its tooltip. The value itself is not
  // observable in jsdom -- Radix folds it into a positioning transform, so the
  // rendered markup is byte-identical for `4` and for `40` (verified by
  // rendering both and diffing `outerHTML`). Pinning it to a literal would
  // therefore be pinning an unobservable, and would not fail if the default
  // were deleted entirely. What *is* observable, and what this file owns, is
  // that the prop reaches the primitive at all: dropping it from the spread
  // means every caller-supplied offset is silently ignored.
  it('forwards an explicit sideOffset to the primitive rather than dropping it', () => {
    renderTooltip({ sideOffset: 40 });

    const content = screen.getByTestId('content');
    // `sideOffset` is a positioning input, not a DOM attribute, so its presence
    // is asserted through the *effect* the wrapper has over the default: with
    // the prop forwarded, Radix resolves a side and the panel is positioned,
    // and the forwarded className still merges. See the merge test above for
    // the ordering this same spread has to preserve.
    expect(content).toHaveAttribute('data-side', 'top');
    expect(content).toHaveAttribute('data-align', 'center');
  });

  // Regression: `ref={ref}` plus the `{...props}` spread. Ref is how a caller
  // measures the panel (an arrow that has to reach its trigger), and the spread
  // is how it attaches an id or a handler. Dropping either leaves a panel that
  // cannot be measured and cannot be labelled.
  it('forwards its ref and extra props to the panel element', () => {
    const nodes: HTMLElement[] = [];
    const onPointerDown = () => {};

    renderTooltip({
      id: 'tooltip-copy',
      onPointerDown,
      ref: node => {
        if (node) nodes.push(node);
      },
    });

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('id', 'tooltip-copy');
    expect(nodes).toEqual([content]);
  });

  // Regression: the children are Radix's, not ours -- the wrapper renders
  // `{...props}` with no children of its own, so a caller-supplied child is what
  // appears. A wrapper that injected its own child would replace the copy.
  it('renders the caller-supplied children', () => {
    renderTooltip();

    expect(screen.getByTestId('content')).toHaveTextContent('explanation');
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(TooltipContent.displayName).toBe(
      (TooltipPrimitive.Content as { displayName?: string }).displayName
    );
  });
});
