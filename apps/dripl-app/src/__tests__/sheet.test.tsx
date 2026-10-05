import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

/**
 * Renders a mounted sheet. Radix's own open/close, focus trap and dismissal are
 * the library's behaviour; only the markup this wrapper contributes is asserted.
 */
function renderSheet(content: React.ReactNode) {
  return render(
    <Sheet open>
      <SheetTrigger>trigger</SheetTrigger>
      {content}
    </Sheet>
  );
}

afterEach(() => {
  cleanup();
});

describe('sheet overlay', () => {
  // Regression: the overlay is the only place the dimming treatment is declared.
  // Losing `cn(base, className)` restyles every sheet backdrop in the app, and
  // swapping the argument order lets the base `bg-black/80` beat a caller's
  // explicit colour -- the caller silently gets no effect.
  it('resolves a conflicting colour class in the caller favour', () => {
    renderSheet(
      <SheetPortal>
        <SheetOverlay className="bg-red-500" data-testid="overlay" />
      </SheetPortal>
    );

    const overlay = screen.getByTestId('overlay');
    expect(overlay.className).toContain('fixed inset-0 z-50');
    expect(overlay.className).toContain('bg-red-500');
    // tailwind-merge drops the losing base class. If the cn() arguments were
    // reversed this class would survive and the caller's colour would vanish.
    expect(overlay.className).not.toContain('bg-black/80');
    // Caller classes come after the base, which is what makes the merge above
    // resolve the way it does.
    expect(overlay.className.indexOf('bg-red-500')).toBeGreaterThan(
      overlay.className.indexOf('fixed inset-0')
    );
    // The className prop is consumed by cn(), not forwarded as a literal prop.
    expect(overlay).toHaveAttribute('data-testid', 'overlay');
  });

  // Regression: `ref` is forwarded to the Radix overlay, which the app needs to
  // measure the surface. Dropping `ref={ref}` would make every forwarded ref
  // resolve to null.
  it('forwards its ref to the rendered overlay element', () => {
    const nodes: HTMLElement[] = [];

    renderSheet(
      <SheetPortal>
        <SheetOverlay
          ref={node => {
            if (node) nodes.push(node);
          }}
          data-testid="overlay"
        />
      </SheetPortal>
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe(screen.getByTestId('overlay'));
  });

  // Regression: the overlay and the content animations are keyed off
  // `data-state`, so the declared variants and the attribute Radix supplies have
  // to agree. A variant renamed to a state Radix never sets is a style that can
  // never apply.
  it('declares open-state animation classes and receives the open data-state', () => {
    renderSheet(
      <SheetPortal>
        <SheetOverlay data-testid="overlay" />
      </SheetPortal>
    );

    const overlay = screen.getByTestId('overlay');
    expect(overlay).toHaveAttribute('data-state', 'open');
    expect(overlay.className).toContain('data-[state=open]:fade-in-0');
    expect(overlay.className).toContain('data-[state=closed]:fade-out-0');
    expect(overlay.className).toContain('data-[state=open]:animate-in');
    // The dimming level itself, asserted with no caller colour in play. Asserting
    // only that `bg-black/80` *loses* a merge would pass for any base colour.
    expect(overlay).toHaveClass('bg-black/80');
  });
});

describe('sheet content side variants', () => {
  const SIDES = [
    { side: 'top', present: ['inset-x-0', 'top-0', 'border-b'], absent: ['inset-y-0', 'bottom-0'] },
    {
      side: 'bottom',
      present: ['inset-x-0', 'bottom-0', 'border-t'],
      absent: ['inset-y-0', 'top-0'],
    },
    {
      side: 'left',
      present: ['inset-y-0', 'left-0', 'border-r', 'sm:max-w-sm'],
      absent: ['inset-y-0 right-0'],
    },
    {
      side: 'right',
      present: ['inset-y-0', 'right-0', 'border-l', 'sm:max-w-sm'],
      absent: ['inset-y-0 left-0'],
    },
  ] as const;

  // Regression: the `side` variants are the cva table in this file and nothing
  // else. Losing or transposing an edge token makes a bottom drawer render as a
  // side drawer while still looking plausible in review.
  it.each(SIDES)(
    'applies the $side edge tokens and not the others',
    ({ side, present, absent }) => {
      renderSheet(
        <SheetContent side={side} data-testid="content">
          body
        </SheetContent>
      );

      const content = screen.getByTestId('content');
      for (const cls of present) {
        expect(content).toHaveClass(cls);
      }
      for (const cls of absent) {
        expect(content.className).not.toContain(cls);
      }
      // Every side shares the base treatment; it must survive the variant merge.
      expect(content).toHaveClass('fixed', 'z-50', 'gap-4', 'bg-background', 'p-6', 'shadow-lg');
    }
  );

  // Regression: `side` defaults to 'right'. Dropping the default would leave the
  // variant unset and the panel would render with no edge tokens at all -- a
  // full-width band across the top of the screen.
  it('defaults to the right side when no side is given', () => {
    renderSheet(<SheetContent data-testid="content">body</SheetContent>);

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('inset-y-0', 'right-0', 'border-l');
    expect(content.className).toContain('data-[state=open]:slide-in-from-right');
    expect(content.className).not.toContain('inset-x-0');
  });

  // Regression: the default must agree with the explicit value, not merely look
  // like a panel. Comparing against an explicit `side="right"` render pins the
  // default to the right-hand edge specifically.
  it('renders identically to an explicit right side', () => {
    renderSheet(<SheetContent data-testid="implicit">a</SheetContent>);
    const implicit = screen.getByTestId('implicit').className;
    cleanup();

    renderSheet(
      <SheetContent side="right" data-testid="explicit">
        a
      </SheetContent>
    );
    const explicit = screen.getByTestId('explicit').className;

    expect(implicit).toBe(explicit);
  });

  // Regression: each side pairs its enter/exit slide direction with its own edge.
  // The slide classes are the only cue for which way the panel travels, and they
  // are declared per variant here.
  it.each([
    ['top', 'data-[state=open]:slide-in-from-top', 'data-[state=closed]:slide-out-to-top'],
    ['bottom', 'data-[state=open]:slide-in-from-bottom', 'data-[state=closed]:slide-out-to-bottom'],
    ['left', 'data-[state=open]:slide-in-from-left', 'data-[state=closed]:slide-out-to-left'],
    ['right', 'data-[state=open]:slide-in-from-right', 'data-[state=closed]:slide-out-to-right'],
  ])('pairs the %s edge with its own slide direction', (side, enter, exit) => {
    renderSheet(
      <SheetContent side={side as 'top' | 'bottom' | 'left' | 'right'} data-testid="content">
        body
      </SheetContent>
    );

    const content = screen.getByTestId('content');
    expect(content.className).toContain(enter);
    expect(content.className).toContain(exit);
  });
});

describe('sheet content', () => {
  // Regression: `cn(sheetVariants({ side }), className)` is the whole override
  // story for the panel. Reversing the arguments makes the base padding and
  // background win over every caller's explicit value, silently.
  it('resolves conflicting padding and background classes in the caller favour', () => {
    renderSheet(
      <SheetContent className="bg-red-500 p-2" data-testid="content">
        body
      </SheetContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('bg-red-500', 'p-2');
    expect(content.className).not.toContain('bg-background');
    expect(content.className).not.toContain('p-6');
    // Non-conflicting base classes must survive the merge.
    expect(content).toHaveClass('shadow-lg', 'transition', 'ease-in-out');
  });

  // Regression: the panel wraps its children in a portal and mounts an overlay
  // beside them. Losing the overlay leaves the rest of the app visible and
  // interactive behind an apparently modal sheet; losing the portal puts the
  // panel inside the trigger's stacking context and ancestor overflow clips it.
  it('portals an overlay and the caller children into the sheet panel', () => {
    const { container } = renderSheet(
      <SheetContent data-testid="content">
        <SheetHeader>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Description</SheetDescription>
        </SheetHeader>
        <p>panel body</p>
      </SheetContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveTextContent('panel body');
    expect(screen.getByText('Title')).toBeInTheDocument();
    // The overlay is a sibling of the content inside the same portal, not
    // inside the panel itself.
    const overlay = document.querySelector('div.fixed.inset-0.z-50');
    expect(overlay).not.toBeNull();
    expect(content.contains(overlay)).toBe(false);
    expect(container).not.toContainElement(content);
    expect(document.body).toContainElement(content);
  });

  // Regression: the built-in close affordance and its sr-only label are
  // contributed by this wrapper, not by Radix. They are the only keyboard
  // reachable way out of the sheet for a user who cannot see the X glyph.
  it('renders the built-in close button with its icon and screen-reader label', () => {
    renderSheet(<SheetContent data-testid="content">body</SheetContent>);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toBe(screen.getByTestId('content').querySelector('button'));
    expect(close.tagName).toBe('BUTTON');
    // The exact class string: this is a hand-written constant, and it is where
    // the sheet's close button styling lives.
    expect(close.className).toBe(
      'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background ' +
        'transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 ' +
        'focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none ' +
        'data-[state=open]:bg-secondary'
    );
    const icon = close.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass('h-4', 'w-4');
    expect(screen.getByText('Close')).toHaveClass('sr-only');
  });

  // Regression: the panel's enter animation is keyed off `data-state`, and the
  // per-side slide rides on the same attribute. Both are declared here.
  it('declares its open-state animation and slide classes alongside data-state', () => {
    renderSheet(<SheetContent data-testid="content">body</SheetContent>);

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('data-state', 'open');
    expect(content.className).toContain('data-[state=open]:animate-in');
    expect(content.className).toContain('data-[state=open]:duration-500');
    expect(content.className).toContain('data-[state=closed]:duration-300');
  });

  // Regression: `children` is destructured out and rendered explicitly, and
  // `...props` is spread onto the Radix content. Swallowing either would drop
  // panel content or every forwarded attribute a call site relies on.
  it('forwards extra props and its ref to the panel element', () => {
    const nodes: HTMLElement[] = [];

    renderSheet(
      <SheetContent
        id="settings-sheet"
        data-testid="content"
        ref={node => {
          if (node) nodes.push(node);
        }}
      >
        body
      </SheetContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('id', 'settings-sheet');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe(content);
    // `side` is a variant prop of this wrapper and must not reach the DOM as an
    // unknown attribute.
    expect(content).not.toHaveAttribute('side');
  });
});

describe('sheet header and footer', () => {
  // Regression: the header is a plain div in this file, so its layout classes
  // exist nowhere else. Dropping `cn` would discard a caller's override.
  it('renders the header as a div with its stacked layout and a merged override', () => {
    render(
      <SheetHeader className="space-y-4" data-testid="header">
        Heading
      </SheetHeader>
    );

    const header = screen.getByTestId('header');
    expect(header.tagName).toBe('DIV');
    expect(header).toHaveClass('flex', 'flex-col', 'text-center', 'sm:text-left', 'space-y-4');
    expect(header.className).not.toContain('space-y-2');
    expect(header).toHaveTextContent('Heading');
  });

  // Regression: the header's own gap, asserted with no override in play. The
  // merge test above only proves `space-y-2` *loses*; that holds for any base
  // value, so the base value itself needs its own assertion.
  it('declares the header base gap when no className is given', () => {
    render(<SheetHeader data-testid="header">Heading</SheetHeader>);

    expect(screen.getByTestId('header')).toHaveClass('space-y-2');
  });

  // Regression: the footer reverses the stacking order on small screens so the
  // primary action stays last in the DOM but first on screen.
  it('renders the footer with the reversed column layout and a merged override', () => {
    render(
      <SheetFooter className="sm:space-x-4" data-testid="footer">
        actions
      </SheetFooter>
    );

    const footer = screen.getByTestId('footer');
    expect(footer.tagName).toBe('DIV');
    expect(footer).toHaveClass(
      'flex',
      'flex-col-reverse',
      'sm:flex-row',
      'sm:justify-end',
      'sm:space-x-4'
    );
    expect(footer.className).not.toContain('sm:space-x-2');
    expect(footer).toHaveTextContent('actions');
  });

  // Regression: the footer's base action gap, with no override in play.
  it('declares the footer base action gap when no className is given', () => {
    render(<SheetFooter data-testid="footer">actions</SheetFooter>);

    expect(screen.getByTestId('footer')).toHaveClass('sm:space-x-2');
  });

  // Regression: both wrappers spread `...props`, which is how a call site
  // attaches a click handler or an id. Consuming props without spreading them
  // leaves the element inert.
  it('spreads arbitrary props onto the header and footer elements', () => {
    const onHeaderClick = vi.fn();
    const onFooterClick = vi.fn();

    render(
      <>
        <SheetHeader data-testid="header" onClick={onHeaderClick} />
        <SheetFooter data-testid="footer" onClick={onFooterClick} />
      </>
    );

    const header = screen.getByTestId('header');
    const footer = screen.getByTestId('footer');
    header.click();
    footer.click();

    expect(onHeaderClick).toHaveBeenCalledTimes(1);
    expect(onFooterClick).toHaveBeenCalledTimes(1);
  });
});

describe('sheet title and description', () => {
  // Regression: the sheet's title is the Radix `Title`, and this wrapper is what
  // gives it the app's type scale. It also carries the id Radix links the panel
  // to via aria-labelledby, so the heading must not be a bare span.
  it('renders the title as the accessible heading with its type scale', () => {
    renderSheet(
      <SheetContent data-testid="content">
        <SheetTitle>Share this sheet</SheetTitle>
        <SheetDescription>Anyone with the link can edit.</SheetDescription>
      </SheetContent>
    );

    const content = screen.getByTestId('content');
    const title = screen.getByRole('heading', { name: 'Share this sheet' });
    expect(title.tagName).toBe('H2');
    expect(title).toHaveClass('text-lg', 'font-semibold', 'text-foreground');
    // The panel is labelled by the title -- the pairing is why the title must be
    // rendered at all.
    expect(content).toHaveAttribute('aria-labelledby', title.id);

    const description = screen.getByText('Anyone with the link can edit.');
    expect(description.tagName).toBe('P');
    expect(description).toHaveClass('text-sm', 'text-muted-foreground');
    expect(content).toHaveAttribute('aria-describedby', description.id);
  });

  // Regression: `cn(base, className)` on the title and description is the only
  // override path. Reversed, the base `text-lg`/`text-sm` would beat an explicit
  // caller size and the override would be ignored.
  it('resolves conflicting text size and colour classes in the caller favour', () => {
    renderSheet(
      <SheetContent data-testid="content">
        <SheetTitle className="text-sm text-red-500">Share</SheetTitle>
        <SheetDescription className="text-base">Desc</SheetDescription>
      </SheetContent>
    );

    const title = screen.getByRole('heading', { name: 'Share' });
    expect(title).toHaveClass('text-sm', 'text-red-500');
    expect(title.className).not.toContain('text-lg');
    expect(title.className).not.toContain('text-foreground');

    const description = screen.getByText('Desc');
    expect(description).toHaveClass('text-base');
    expect(description.className).not.toContain('text-sm');
    // A non-conflicting base class survives.
    expect(description).toHaveClass('text-muted-foreground');
  });

  // Regression: both forward `ref`, which is how the app anchors tooltips and
  // validation messages to the heading. Dropping `ref={ref}` makes them null.
  //
  // NOTE: the version of `components/ui/sheet.tsx` at HEAD does *not* pass `ref`
  // through `SheetTitle`, so this test fails against that revision. That is a real
  // source bug, not a test problem -- reported, not fixed here.
  it('forwards refs and extra props on the title and description', () => {
    const titleNodes: HTMLElement[] = [];
    const descriptionNodes: HTMLElement[] = [];

    renderSheet(
      <SheetContent data-testid="content">
        <SheetTitle
          data-testid="title"
          ref={node => {
            if (node) titleNodes.push(node);
          }}
        >
          Share
        </SheetTitle>
        <SheetDescription
          data-testid="description"
          ref={node => {
            if (node) descriptionNodes.push(node);
          }}
        >
          Desc
        </SheetDescription>
      </SheetContent>
    );

    expect(titleNodes).toEqual([screen.getByTestId('title')]);
    expect(descriptionNodes).toEqual([screen.getByTestId('description')]);
  });
});
