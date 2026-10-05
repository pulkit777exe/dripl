import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * `components/ui/dialog.tsx` is six `forwardRef` wrappers over Radix's dialog
 * primitives. Radix owns opening, dismissal, focus trapping and positioning;
 * this file owns the class strings, the `cn()` merges, the always-rendered close
 * affordance, and the portal/overlay pair. Only the latter is asserted here.
 */
function renderDialog(content: React.ReactNode) {
  return render(<Dialog open>{content}</Dialog>);
}

afterEach(() => {
  cleanup();
});

describe('dialog overlay', () => {
  // Regression: the overlay's base `bg-black/80` is the only dimming declared
  // for every dialog in the app. `cn(base, className)` puts the caller last, so
  // tailwind-merge drops the base colour in favour of an explicit caller colour;
  // reversing the arguments silently ignores the override.
  it('resolves a conflicting colour class in the caller favour', () => {
    renderDialog(
      <DialogPortal>
        <DialogOverlay className="bg-red-500" data-testid="overlay" />
      </DialogPortal>
    );

    const overlay = screen.getByTestId('overlay');
    expect(overlay.className).toContain('fixed inset-0 z-50');
    expect(overlay.className).toContain('bg-red-500');
    expect(overlay.className).not.toContain('bg-black/80');
    expect(overlay.className.indexOf('bg-red-500')).toBeGreaterThan(
      overlay.className.indexOf('fixed inset-0')
    );
    // `className` is consumed by cn() rather than forwarded as a literal prop.
    expect(overlay).toHaveAttribute('data-testid', 'overlay');
  });

  // Regression: `ref` reaches the Radix overlay so callers can measure the
  // surface. Dropping `ref={ref}` leaves every forwarded ref null.
  it('forwards its ref to the rendered overlay element', () => {
    const nodes: HTMLElement[] = [];

    renderDialog(
      <DialogPortal>
        <DialogOverlay
          ref={node => {
            if (node) nodes.push(node);
          }}
          data-testid="overlay"
        />
      </DialogPortal>
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe(screen.getByTestId('overlay'));
  });

  // Regression: the fade variants are keyed off `data-state`, so the declared
  // attribute selector and the value Radix actually supplies have to agree.
  it('declares open-state animation classes and receives the open data-state', () => {
    renderDialog(
      <DialogPortal>
        <DialogOverlay data-testid="overlay" />
      </DialogPortal>
    );

    const overlay = screen.getByTestId('overlay');
    expect(overlay).toHaveAttribute('data-state', 'open');
    expect(overlay.className).toContain('data-[state=open]:animate-in');
    expect(overlay.className).toContain('data-[state=open]:fade-in-0');
    expect(overlay.className).toContain('data-[state=closed]:fade-out-0');
    expect(overlay.className).toContain('data-[state=closed]:animate-out');
    // The dimming level itself, asserted with no caller colour in play. Asserting
    // only that `bg-black/80` *loses* a merge would pass for any base colour.
    expect(overlay).toHaveClass('bg-black/80');
  });
});

describe('dialog content', () => {
  // Regression: the centred-panel geometry and the base width/padding/background
  // are declared only here. Reversing `cn` would make `max-w-lg p-6
  // bg-background` beat an explicit caller value, so overrides stop working while
  // the dialog still looks correct at every other call site.
  it('resolves conflicting width, padding and background classes in the caller favour', () => {
    renderDialog(
      <DialogContent className="max-w-2xl p-2 bg-red-500" data-testid="content">
        body
      </DialogContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('max-w-2xl', 'p-2', 'bg-red-500');
    expect(content.className).not.toContain('max-w-lg');
    expect(content.className).not.toContain('p-6');
    expect(content.className).not.toContain('bg-background');
    // Non-conflicting base classes must survive the merge intact.
    expect(content).toHaveClass(
      'fixed',
      'left-[50%]',
      'top-[50%]',
      'z-50',
      'grid',
      'w-full',
      'translate-x-[-50%]',
      'translate-y-[-50%]',
      'gap-4',
      'border',
      'shadow-lg',
      'sm:rounded-lg'
    );
  });

  // Regression: the panel's zoom/slide enter animation is declared here as a set
  // of `data-[state=open]:` utilities. Renaming or dropping one leaves the panel
  // popping in with no transform.
  it('declares the full open-state zoom and slide animation set', () => {
    renderDialog(<DialogContent data-testid="content">body</DialogContent>);

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('data-state', 'open');
    for (const cls of [
      'duration-200',
      'data-[state=open]:animate-in',
      'data-[state=closed]:animate-out',
      'data-[state=open]:zoom-in-95',
      'data-[state=closed]:zoom-out-95',
      'data-[state=open]:slide-in-from-left-1/2',
      'data-[state=open]:slide-in-from-top-[48%]',
      'data-[state=closed]:slide-out-to-left-1/2',
      'data-[state=closed]:slide-out-to-top-[48%]',
    ]) {
      expect(content.className).toContain(cls);
    }
  });

  // Regression: the panel's base width, padding and background, asserted with no
  // override in play. The merge test above only proves `max-w-lg p-6
  // bg-background` *lose* to a caller, which holds for any base value -- so the
  // base values need their own assertion or they are unconstrained.
  it('declares the base panel width, padding and background when no className is given', () => {
    renderDialog(<DialogContent data-testid="content">body</DialogContent>);

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('w-full', 'max-w-lg', 'p-6', 'bg-background', 'gap-4', 'border');
  });

  // Regression: the panel mounts a sibling overlay inside the portal. Losing the
  // overlay leaves the page behind an apparently modal dialog still visible and
  // clickable; losing the portal traps the panel inside an ancestor's stacking
  // context and overflow.
  it('portals an overlay and the caller children into the dialog panel', () => {
    const { container } = renderDialog(
      <DialogContent data-testid="content">
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
          <DialogDescription>Pick a new name.</DialogDescription>
        </DialogHeader>
        <p>panel body</p>
      </DialogContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveTextContent('panel body');
    const overlay = document.querySelector('div.fixed.inset-0.z-50');
    expect(overlay).not.toBeNull();
    expect(content.contains(overlay)).toBe(false);
    expect(container).not.toContainElement(content);
    expect(document.body).toContainElement(content);
  });

  // Regression: the close button is contributed by this wrapper -- Radix's
  // Content has no built-in one. Its classes are the dialog's own, and they
  // deliberately differ from the sheet's (`bg-accent` + `text-muted-foreground`
  // rather than `bg-secondary`), so the exact string is what keeps the two
  // surfaces visually distinct.
  it('renders the built-in close button with its icon and screen-reader label', () => {
    renderDialog(<DialogContent data-testid="content">body</DialogContent>);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toBe(screen.getByTestId('content').querySelector('button'));
    expect(close.tagName).toBe('BUTTON');
    expect(close.className).toBe(
      'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background ' +
        'transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 ' +
        'focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none ' +
        'data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'
    );
    expect(close.className).not.toContain('data-[state=open]:bg-secondary');
    const icon = close.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass('h-4', 'w-4');
    expect(screen.getByText('Close')).toHaveClass('sr-only');
  });

  // Regression: `children` is destructured out and rendered explicitly, and
  // `...props` is spread onto the Radix content. Consuming props without
  // spreading them would drop every id/data-attribute/handler a call site sets.
  it('forwards extra props and its ref to the panel element', () => {
    const nodes: HTMLElement[] = [];

    renderDialog(
      <DialogContent
        id="rename-dialog"
        data-testid="content"
        ref={node => {
          if (node) nodes.push(node);
        }}
      >
        body
      </DialogContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('id', 'rename-dialog');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe(content);
  });
});

describe('dialog header and footer', () => {
  // Regression: the header is a plain div declared here, and its `space-y-1.5`
  // differs from the sheet header's `space-y-2`. Swapping the two would change
  // the title/description rhythm in one surface only.
  it('renders the header as a div with its own gap and a merged override', () => {
    render(
      <DialogHeader className="space-y-4" data-testid="header">
        Heading
      </DialogHeader>
    );

    const header = screen.getByTestId('header');
    expect(header.tagName).toBe('DIV');
    expect(header).toHaveClass('flex', 'flex-col', 'text-center', 'sm:text-left', 'space-y-4');
    expect(header.className).not.toContain('space-y-1.5');
    expect(header).toHaveTextContent('Heading');
  });

  // Regression: the header's own gap, asserted with no override in play. The
  // merge test above only proves the base gap *loses*, which holds for any base
  // value. Pinning the value here is what keeps the dialog's header distinct from
  // the sheet's.
  it('declares the header base gap when no className is given', () => {
    render(<DialogHeader data-testid="header">Heading</DialogHeader>);

    expect(screen.getByTestId('header')).toHaveClass('space-y-1.5');
  });

  // Regression: the footer reverses the column order on small screens so the
  // primary action is reachable first. `cn` must still let a caller widen the
  // action gap.
  it('renders the footer with the reversed column layout and a merged override', () => {
    render(
      <DialogFooter className="sm:space-x-4" data-testid="footer">
        actions
      </DialogFooter>
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
    render(<DialogFooter data-testid="footer">actions</DialogFooter>);

    expect(screen.getByTestId('footer')).toHaveClass('sm:space-x-2');
  });

  // Regression: both wrappers spread `...props`; that spread is how a call site
  // attaches an id or a handler. Dropping it leaves inert divs.
  it('spreads arbitrary props onto the header and footer elements', () => {
    const onHeaderClick = vi.fn();
    const onFooterClick = vi.fn();

    render(
      <>
        <DialogHeader data-testid="header" onClick={onHeaderClick} />
        <DialogFooter data-testid="footer" onClick={onFooterClick} />
      </>
    );

    screen.getByTestId('header').click();
    screen.getByTestId('footer').click();

    expect(onHeaderClick).toHaveBeenCalledTimes(1);
    expect(onFooterClick).toHaveBeenCalledTimes(1);
  });
});

describe('dialog title and description', () => {
  // Regression: the title is the Radix `Title` and the panel is labelled by it,
  // so it must render a real heading carrying the id the panel points at. The
  // title's own class string here is tighter than the sheet's -- no
  // `text-foreground`, plus `leading-none tracking-tight`.
  it('renders the title as the accessible heading with its type scale', () => {
    renderDialog(
      <DialogContent data-testid="content">
        <DialogTitle>Rename file</DialogTitle>
        <DialogDescription>Pick a new name.</DialogDescription>
      </DialogContent>
    );

    const content = screen.getByTestId('content');
    const title = screen.getByRole('heading', { name: 'Rename file' });
    expect(title.tagName).toBe('H2');
    expect(title).toHaveClass('text-lg', 'font-semibold', 'leading-none', 'tracking-tight');
    expect(title.className).not.toContain('text-foreground');
    expect(content).toHaveAttribute('aria-labelledby', title.id);

    const description = screen.getByText('Pick a new name.');
    expect(description.tagName).toBe('P');
    expect(description).toHaveClass('text-sm', 'text-muted-foreground');
    expect(content).toHaveAttribute('aria-describedby', description.id);
  });

  // Regression: `cn(base, className)` on the title and description is the only
  // override path. Reversed, the base `text-lg`/`text-sm` would beat an explicit
  // caller size and the override would be dropped.
  it('resolves conflicting text size and colour classes in the caller favour', () => {
    renderDialog(
      <DialogContent data-testid="content">
        <DialogTitle className="text-sm text-red-500">Rename</DialogTitle>
        <DialogDescription className="text-base">Desc</DialogDescription>
      </DialogContent>
    );

    const title = screen.getByRole('heading', { name: 'Rename' });
    expect(title).toHaveClass('text-sm', 'text-red-500');
    expect(title.className).not.toContain('text-lg');
    // Non-conflicting base classes survive the merge.
    expect(title).toHaveClass('font-semibold', 'tracking-tight');

    const description = screen.getByText('Desc');
    expect(description).toHaveClass('text-base');
    expect(description.className).not.toContain('text-sm');
    expect(description).toHaveClass('text-muted-foreground');
  });

  // Regression: both forward `ref`, which is how a tooltip or a validation
  // message is anchored to the heading. Dropping `ref={ref}` makes them null.
  it('forwards refs and extra props on the title and description', () => {
    const titleNodes: HTMLElement[] = [];
    const descriptionNodes: HTMLElement[] = [];

    renderDialog(
      <DialogContent data-testid="content">
        <DialogTitle
          data-testid="title"
          ref={node => {
            if (node) titleNodes.push(node);
          }}
        >
          Rename
        </DialogTitle>
        <DialogDescription
          data-testid="description"
          ref={node => {
            if (node) descriptionNodes.push(node);
          }}
        >
          Desc
        </DialogDescription>
      </DialogContent>
    );

    expect(titleNodes).toEqual([screen.getByTestId('title')]);
    expect(descriptionNodes).toEqual([screen.getByTestId('description')]);
  });
});
