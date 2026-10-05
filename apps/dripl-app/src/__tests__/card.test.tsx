import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * `components/ui/card.tsx` is six `forwardRef` wrappers over plain elements --
 * no Radix, no library. Everything it contributes is therefore testable here:
 * the element each wrapper renders, its base class string, the `cn(base,
 * className)` merge, and the ref/prop spread. Nothing here asserts React's own
 * `forwardRef` behaviour; it asserts *this file's* declarations.
 */
afterEach(() => {
  cleanup();
});

describe('card root', () => {
  // Regression: the card is the themed surface for every panel in the app, and
  // its base string is the only place `bg-card` / `text-card-foreground` /
  // `rounded-lg` / `shadow-sm` are declared. Dropping any one of them leaves
  // every card in the product unthemed or square, which no call site can fix.
  it('declares the base surface, border, colour and shadow classes', () => {
    render(<Card data-testid="card">panel</Card>);

    const card = screen.getByTestId('card');
    expect(card.tagName).toBe('DIV');
    expect(card).toHaveClass(
      'rounded-lg',
      'border',
      'bg-card',
      'text-card-foreground',
      'shadow-sm'
    );
    expect(card).toHaveTextContent('panel');
  });

  // Regression: `cn(base, className)` puts the caller last, which is what lets
  // `twMerge` drop the base `border` in favour of an explicit caller border.
  // Reversing the two arguments would keep `border` and drop the caller's, so
  // the override would be silently ignored while the card still looked right at
  // every other call site.
  it('resolves a conflicting border and rounding class in the caller favour', () => {
    render(
      <Card className="rounded-none border-2" data-testid="card">
        panel
      </Card>
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-none', 'border-2');
    expect(card.className).not.toContain('rounded-lg');
    // `border-2` must displace `border` entirely -- twMerge keeps only the last
    // of the conflicting width utilities.
    expect(card.className).not.toMatch(/(^|\s)border(\s|$)/);
    // Non-conflicting base classes survive the merge.
    expect(card).toHaveClass('bg-card', 'text-card-foreground', 'shadow-sm');
    // Ordering: the caller's classes land after the surviving base ones, which is
    // the observable consequence of `cn(base, className)`.
    expect(card.className.indexOf('rounded-none')).toBeGreaterThan(
      card.className.indexOf('shadow-sm')
    );
  });

  // Regression: `ref` is threaded to the rendered div so a card can be measured
  // or focused by a parent. Dropping `ref={ref}` leaves every forwarded ref null
  // without any type error, because `forwardRef` still satisfies the signature.
  it('forwards its ref and spreads arbitrary props onto the div', () => {
    const nodes: HTMLElement[] = [];

    render(
      <Card
        id="usage-card"
        data-testid="card"
        aria-label="Usage"
        ref={node => {
          if (node) nodes.push(node);
        }}
      />
    );

    const card = screen.getByTestId('card');
    expect(nodes).toEqual([card]);
    expect(card).toHaveAttribute('id', 'usage-card');
    expect(card).toHaveAttribute('aria-label', 'Usage');
  });

  // Regression: `displayName` is what React DevTools and the error overlay name
  // these wrappers by. It is set explicitly on each of the six.
  it('names every wrapper for DevTools', () => {
    expect(Card.displayName).toBe('Card');
    expect(CardHeader.displayName).toBe('CardHeader');
    expect(CardFooter.displayName).toBe('CardFooter');
    expect(CardTitle.displayName).toBe('CardTitle');
    expect(CardDescription.displayName).toBe('CardDescription');
    expect(CardContent.displayName).toBe('CardContent');
  });
});

describe('card header', () => {
  // Regression: the header is a flex column with a `space-y-1.5` rhythm between
  // title and description. Its gap differs from the dialog header's, so pinning
  // it here is what keeps the two surfaces visually distinct.
  it('declares the base flex column and rhythm when no className is given', () => {
    render(<CardHeader data-testid="header">head</CardHeader>);

    const header = screen.getByTestId('header');
    expect(header.tagName).toBe('DIV');
    expect(header).toHaveClass('flex', 'flex-col', 'space-y-1.5', 'p-6');
    expect(header).toHaveTextContent('head');
  });

  // Regression: the same `cn(base, className)` ordering, on the header. A caller
  // that narrows the padding must win over the base `p-6`.
  it('resolves a conflicting padding class in the caller favour', () => {
    render(
      <CardHeader className="p-2 space-y-4" data-testid="header">
        head
      </CardHeader>
    );

    const header = screen.getByTestId('header');
    expect(header).toHaveClass('p-2', 'space-y-4');
    expect(header.className).not.toContain('p-6');
    expect(header.className).not.toContain('space-y-1.5');
    expect(header).toHaveClass('flex', 'flex-col');
  });

  // Regression: `ref` plus `...props` on the header, which is how a sticky or
  // scrollable header gets an id and a scroll handler from a call site.
  it('forwards its ref and spreads arbitrary props', () => {
    const nodes: HTMLElement[] = [];

    render(
      <CardHeader
        data-testid="header"
        title="Usage header"
        ref={node => {
          if (node) nodes.push(node);
        }}
      />
    );

    const header = screen.getByTestId('header');
    expect(nodes).toEqual([header]);
    expect(header).toHaveAttribute('title', 'Usage header');
  });
});

describe('card title', () => {
  // Regression: the title renders an `h3` -- the heading level is this file's
  // declaration, not a library default -- with the 2xl/semibold type scale.
  it('renders an h3 with the base type scale', () => {
    render(<CardTitle data-testid="title">Usage</CardTitle>);

    const title = screen.getByTestId('title');
    expect(title.tagName).toBe('H3');
    expect(screen.getByRole('heading', { level: 3, name: 'Usage' })).toBe(title);
    expect(title).toHaveClass('text-2xl', 'font-semibold', 'leading-none', 'tracking-tight');
  });

  // Regression: the title's merge, on the size utilities. The declared
  // `text-2xl` is the only thing a caller has to override, so its losing to an
  // explicit caller size is load-bearing. `leading-none` goes with it: in
  // tailwind-merge a `text-*` size class supersedes the line-height utility
  // alongside it, so both are dropped for one override.
  it('resolves a conflicting text size class in the caller favour', () => {
    render(
      <CardTitle className="text-base" data-testid="title">
        Usage
      </CardTitle>
    );

    const title = screen.getByTestId('title');
    expect(title).toHaveClass('text-base');
    expect(title.className).not.toContain('text-2xl');
    expect(title.className).not.toContain('leading-none');
    expect(title).toHaveClass('font-semibold', 'tracking-tight');
  });

  // Regression: the title's ref element type is `HTMLParagraphElement` in the
  // signature while it renders an `h3`. That is intentional -- the repo's
  // headings are HTMLElement-compatible measurement targets -- and this test
  // pins the rendered tag so the mismatch cannot drift into a real `HTMLElement`
  // cast being wrong.
  it('forwards its ref to the rendered heading', () => {
    const nodes: HTMLElement[] = [];

    render(
      <CardTitle
        data-testid="title"
        ref={node => {
          if (node) nodes.push(node);
        }}
      >
        Usage
      </CardTitle>
    );

    expect(nodes).toEqual([screen.getByTestId('title')]);
    expect(nodes[0]?.tagName).toBe('H3');
  });
});

describe('card description', () => {
  // Regression: the description is a `<p>` at the muted foreground colour, and
  // it deliberately carries no heading semantics -- the title owns the label.
  it('renders a paragraph with the muted body type scale', () => {
    render(<CardDescription data-testid="description">Resets monthly</CardDescription>);

    const description = screen.getByTestId('description');
    expect(description.tagName).toBe('P');
    expect(description).toHaveClass('text-sm', 'text-muted-foreground');
    expect(description).toHaveTextContent('Resets monthly');
  });

  // Regression: the description's merge. A caller setting its own size must win
  // over the base `text-sm`.
  it('resolves a conflicting text size class in the caller favour', () => {
    render(
      <CardDescription className="text-base" data-testid="description">
        Resets monthly
      </CardDescription>
    );

    const description = screen.getByTestId('description');
    expect(description).toHaveClass('text-base');
    expect(description.className).not.toContain('text-sm');
    // The colour is not a size utility, so it survives.
    expect(description).toHaveClass('text-muted-foreground');
  });

  // Regression: the description forwards `ref` and `...props` like every other
  // wrapper, so a tooltip can anchor to it.
  it('forwards its ref and spreads arbitrary props', () => {
    const nodes: HTMLElement[] = [];

    render(
      <CardDescription
        id="usage-blurb"
        data-testid="description"
        ref={node => {
          if (node) nodes.push(node);
        }}
      />
    );

    expect(nodes).toEqual([screen.getByTestId('description')]);
    expect(screen.getByTestId('description')).toHaveAttribute('id', 'usage-blurb');
  });
});

describe('card content and footer', () => {
  // Regression: the content's base padding is `p-6 pt-0` -- the `pt-0` cancels
  // the header's bottom padding, and the pair is only expressed here. Asserted
  // with no override so the value itself is pinned, not just its losing.
  it('declares the content padding that cancels the header gap', () => {
    render(<CardContent data-testid="content">body</CardContent>);

    const content = screen.getByTestId('content');
    expect(content.tagName).toBe('DIV');
    expect(content).toHaveClass('p-6', 'pt-0');
    expect(content).toHaveTextContent('body');
  });

  // Regression: the content's merge. `pt-0` must be replaceable by a caller that
  // wants its own top padding.
  it('resolves a conflicting padding class on the content in the caller favour', () => {
    render(
      <CardContent className="pt-4" data-testid="content">
        body
      </CardContent>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('pt-4');
    expect(content.className).not.toContain('pt-0');
    expect(content).toHaveClass('p-6');
  });

  // Regression: the footer is the only one of the six that centres its children
  // vertically (`items-center`); header and content are plain `flex-col`.
  it('declares the footer as a vertically centred row', () => {
    render(<CardFooter data-testid="footer">actions</CardFooter>);

    const footer = screen.getByTestId('footer');
    expect(footer.tagName).toBe('DIV');
    expect(footer).toHaveClass('flex', 'items-center', 'p-6', 'pt-0');
    expect(footer.className).not.toContain('flex-col');
  });

  // Regression: the footer's merge, on the same `p-6 pt-0` pair the content
  // uses -- the caller's value has to displace it.
  it('resolves a conflicting padding class on the footer in the caller favour', () => {
    render(
      <CardFooter className="p-2" data-testid="footer">
        actions
      </CardFooter>
    );

    const footer = screen.getByTestId('footer');
    expect(footer).toHaveClass('p-2');
    expect(footer.className).not.toContain('p-6');
    expect(footer.className).not.toContain('pt-0');
    expect(footer).toHaveClass('flex', 'items-center');
  });

  // Regression: the content and footer both spread `...props`, which is how a
  // call site attaches an id or a handler to them.
  it('forwards refs and spreads arbitrary props on the content and footer', () => {
    const contentNodes: HTMLElement[] = [];
    const footerNodes: HTMLElement[] = [];

    render(
      <>
        <CardContent
          data-testid="content"
          lang="en"
          ref={node => {
            if (node) contentNodes.push(node);
          }}
        />
        <CardFooter
          data-testid="footer"
          slot="footer"
          ref={node => {
            if (node) footerNodes.push(node);
          }}
        />
      </>
    );

    expect(contentNodes).toEqual([screen.getByTestId('content')]);
    expect(footerNodes).toEqual([screen.getByTestId('footer')]);
    expect(screen.getByTestId('content')).toHaveAttribute('lang', 'en');
    expect(screen.getByTestId('footer')).toHaveAttribute('slot', 'footer');
  });
});

describe('card composition', () => {
  // Regression: the six wrappers must nest into the canonical card shape with
  // each ref independently attached, because that is how every settings and
  // dashboard panel in the app is built.
  it('nests the six wrappers into a complete card', () => {
    render(
      <Card data-testid="card">
        <CardHeader data-testid="header">
          <CardTitle data-testid="title">Pro plan</CardTitle>
          <CardDescription data-testid="description">Everything, unlocked</CardDescription>
        </CardHeader>
        <CardContent data-testid="content">Body</CardContent>
        <CardFooter data-testid="footer">Upgrade</CardFooter>
      </Card>
    );

    const card = screen.getByTestId('card');
    for (const id of ['header', 'content', 'footer']) {
      expect(card).toContainElement(screen.getByTestId(id));
    }
    expect(screen.getByTestId('header')).toContainElement(screen.getByTestId('title'));
    expect(screen.getByTestId('header')).toContainElement(screen.getByTestId('description'));
    expect(screen.getByTestId('title').tagName).toBe('H3');
    expect(screen.getByTestId('description').tagName).toBe('P');
  });
});
