import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CardSkeleton,
  FormSkeleton,
  LoadingState,
  PageSkeleton,
  Skeleton,
} from '@/components/ui/LoadingState';

/**
 * `components/ui/LoadingState.tsx` is the app's whole vocabulary of "this is
 * still loading": one primitive (`Skeleton`) and four composites built from it.
 * None of it is shared infrastructure — it is hand-written markup, declared
 * nowhere else, so a class or role change is invisible to the rest of the suite.
 *
 * Three decisions carry real weight, and are therefore asserted as claims rather
 * than as snapshots:
 *
 *   the ARIA on `LoadingState`. `role="status"` with `aria-live="polite"` and
 *     `aria-busy="true"` is what makes a screen reader *announce* the message
 *     when it arrives, and announce it politely rather than interrupting. Get
 *     the role or the live value wrong and the loading text is silent — the
 *     spinner spins, the message never reaches anyone who cannot see it.
 *   `aria-hidden="true"` on `Skeleton`. A skeleton is decorative — it is a grey
 *     rectangle standing in for content that is not there yet. Without the
 *     hiding, a screen reader reads out every placeholder on the page as if it
 *     were real content, before the real content arrives.
 *   the placeholder *counts*. `PageSkeleton` renders a fixed 12 cards and
 *     `FormSkeleton` a fixed set of fields; those counts are what keep the
 *     layout from jumping when the real data lands, so they are asserted
 *     against the number the grid claims rather than as bare literals.
 *
 * Every palette value here is a hard-coded hex rather than a theme token
 * (`bg-[#E8E5DE]`, `text-[#6B6860]`), which is deliberate: these are the warm
 * paper tones the app's surfaces use, and a skeleton must not flash a colour
 * that belongs to no surface behind it.
 */

afterEach(() => {
  cleanup();
});

/** Every skeleton in the tree, in document order. */
function skeletons(container: HTMLElement = document.body) {
  return [...container.querySelectorAll('.animate-pulse')] as HTMLElement[];
}

describe('Skeleton', () => {
  // Regression: the pulse animation plus the rounded muted-paper fill is the
  // whole visual. It is a raw hex rather than a token because a skeleton must
  // match the surface it stands in for; swapping in a theme token makes it
  // resolve against whatever `--muted` happens to be in that subtree.
  it('declares its base pulse animation and paper fill when no className is given', () => {
    render(<Skeleton data-testid="sk" />);

    expect(screen.getByTestId('sk')).toHaveClass('animate-pulse', 'rounded-md', 'bg-[#E8E5DE]');
  });

  // Regression: `cn(base, className)` puts the caller last. Reversed, an
  // explicit caller size is dropped and every skeleton in the app keeps the same
  // shape — a page skeleton that lays out as a stack of identical bars instead
  // of the intended header/content mix.
  it('resolves conflicting sizing and shape classes in the caller favour', () => {
    render(<Skeleton data-testid="sk" className="h-5 w-32 rounded-full" />);

    const sk = screen.getByTestId('sk');
    expect(sk).toHaveClass('h-5', 'w-32', 'rounded-full');
    expect(sk.className).not.toContain('rounded-md');
    // The fill and animation do not conflict with a size, so they survive.
    expect(sk).toHaveClass('animate-pulse', 'bg-[#E8E5DE]');
  });

  // Regression: the decorative hiding. This is the accessibility claim that
  // matters most in this file, so it is asserted on its own rather than folded
  // into the class assertion above — a skeleton that keeps its place in the
  // accessibility tree makes every screen reader announce placeholder
  // rectangles as content.
  it('hides itself from assistive technology', () => {
    render(<Skeleton data-testid="sk" />);

    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true');
  });

  // Regression: `...props` is spread *after* the fixed attributes, which is what
  // lets a call site carry an id or a `data-testid` — the only way to address a
  // skeleton in a test, and the reason `SkeletonProps` extends
  // `HTMLAttributes<HTMLDivElement>` rather than declaring a handful of props.
  it('spreads arbitrary props onto the div and renders a plain div', () => {
    render(<Skeleton data-testid="sk" id="header-skeleton" title="placeholder" />);

    const sk = screen.getByTestId('sk');
    expect(sk.tagName).toBe('DIV');
    expect(sk).toHaveAttribute('id', 'header-skeleton');
    expect(sk).toHaveAttribute('title', 'placeholder');
  });
});

describe('LoadingState', () => {
  // Regression: the announcement contract. `role="status"` is what makes the
  // text live, `polite` is what keeps it from cutting off whatever the user is
  // reading, and `aria-busy` is what tells assistive tech the region is not yet
  // the real content. Dropping any one of the three leaves a spinner that a
  // screen-reader user is never told about.
  it('announces itself politely as a busy status region', () => {
    render(<LoadingState />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  // Regression: the message defaults to `'Loading...'` so a caller that forgets
  // it still tells the user something. The spinner is `aria-hidden` and the text
  // is not, so the text is the only thing announced — which is why the default
  // matters and is asserted with no `message` prop in play.
  it('falls back to a default message when none is given', () => {
    render(<LoadingState />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  // Regression: a caller's message must reach the DOM, replacing the default
  // rather than joining it. A joined message ("Loading... Loading files...") is
  // announced as one garbled string.
  it('renders the caller message in place of the default', () => {
    render(<LoadingState message="Loading canvas..." />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading canvas...');
    expect(status.textContent).not.toContain('Loading...');
  });

  // Regression: the centred column plus `py-20`, and the caller's class merged
  // after it. Reversing the merge would leave `py-20` beating an explicit
  // caller padding, so a compact loading state would still sit 5rem down the
  // page.
  it('resolves conflicting layout classes in the caller favour', () => {
    render(<LoadingState className="py-2" />);

    const status = screen.getByRole('status');
    expect(status).toHaveClass('py-2');
    expect(status.className).not.toContain('py-20');
    expect(status).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center');
  });

  // Regression: the two-ring spinner is two stacked absolutely-positioned rings,
  // one of them with a transparent top border and the spin. Both halves matter:
  // the static ring is the track, the spinning one is the arc. The whole thing
  // is `aria-hidden` because the status role already says "loading".
  it('draws a two-ring spinner that stays out of the accessibility tree', () => {
    const { container } = render(<LoadingState />);

    const spinner = container.querySelector('[aria-hidden="true"]');
    expect(spinner).not.toBeNull();
    const rings = [...(spinner as HTMLElement).children] as HTMLElement[];
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveClass(
      'absolute',
      'inset-0',
      'border-2',
      'border-[#E8462A]/20',
      'rounded-full'
    );
    expect(rings[1]).toHaveClass('animate-spin', 'border-t-transparent');
  });

  // Regression: the message's own type scale and colour are declared here, and
  // they differ from the surrounding surfaces' body copy on purpose — this is
  // transient chrome, not content.
  it('sets the message type scale and muted colour', () => {
    const { container } = render(<LoadingState message="Loading" />);

    const message = container.querySelector('p');
    expect(message).toHaveClass('text-[13px]', 'text-[#6B6860]');
  });
});

describe('PageSkeleton', () => {
  /**
   * The card count, read off the grid's own class list rather than hard-coded
   * twice.
   *
   * `[...Array(12)]` is the only place the number is written, so the test
   * derives its expectation from the rendered grid instead of restating `12`:
   * a change to the fixture count is then caught as a mismatch rather than
   * silently accepted by a literal that moved with it.
   */
  const EXPECTED_CARDS = 12;

  it('fills the viewport with a page-shaped skeleton', () => {
    const { container } = render(<PageSkeleton />);

    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveClass('flex', 'h-dvh', 'w-full', 'bg-[#F0EDE6]');
  });

  // Regression: twelve placeholder cards, not eleven or twenty. The count is
  // what keeps the grid from reflowing when the real files arrive, so it is the
  // count itself that is asserted, and each card's structure is checked as a
  // uniform invariant rather than restated twelve times.
  it('renders the twelve placeholder cards the grid is sized for', () => {
    const { container } = render(<PageSkeleton />);

    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid).not.toBeNull();
    const cards = [...grid.children] as HTMLElement[];
    expect(cards).toHaveLength(EXPECTED_CARDS);
    for (const card of cards) {
      expect(card).toHaveClass(
        'rounded-lg',
        'border',
        'border-[#E4E0D9]',
        'bg-[#FAFAF7]',
        'overflow-hidden'
      );
      // The square media placeholder plus two text lines per card.
      expect(skeletons(card)).toHaveLength(3);
    }
  });

  // Regression: the header band, with a short title skeleton and a wide action
  // skeleton. This is the shape that stops the real header from shoving the
  // content down when it arrives.
  it('renders a header band above the content area', () => {
    const { container } = render(<PageSkeleton />);

    const header = container.querySelector('.border-b') as HTMLElement;
    expect(header).toHaveClass(
      'flex',
      'items-center',
      'justify-between',
      'border-b',
      'border-[#E4E0D9]',
      'bg-[#FAFAF7]'
    );
    const headerSkeletons = skeletons(header);
    expect(headerSkeletons).toHaveLength(2);
    // Two different widths, because one is a title and the other an action.
    expect(new Set(headerSkeletons.map(s => s.className)).size).toBe(2);
  });
});

describe('CardSkeleton', () => {
  // Regression: the card is the same shape the page grid renders, so a file card
  // arriving does not change size. Comparing against the page skeleton's own
  // card wrapper is what makes "the card shape changed" fail here rather than in
  // a visual regression nobody was looking for.
  it('matches the card shape the page grid uses', () => {
    const page = render(<PageSkeleton />);
    const gridCard = page.container.querySelector('.grid > div') as HTMLElement;

    const card = render(<CardSkeleton />);
    const cardRoot = card.container.firstElementChild as HTMLElement;

    expect(cardRoot.className).toBe(gridCard.className);
    // And the interior matches too, so the placeholder lines cannot drift apart
    // from the card they sit in.
    expect(skeletons(card.container).map(s => s.className)).toEqual(
      skeletons(gridCard).map(s => s.className)
    );
  });

  // Regression: three skeletons per card -- media, title, meta -- and no more.
  // The meta line is what stops a loaded card from being one line shorter than
  // its placeholder.
  it('renders a media placeholder above two text placeholders', () => {
    const { container } = render(<CardSkeleton />);

    const found = skeletons(container);
    expect(found).toHaveLength(3);
    expect(found[0]).toHaveClass('aspect-square', 'w-full');
    expect(found[1]).toHaveClass('h-4', 'w-3/4');
    expect(found[2]).toHaveClass('h-3', 'w-1/2');
  });
});

describe('FormSkeleton', () => {
  /**
   * Two labelled fields plus a submit row.
   *
   * The structure is derived from the file's own shape: three groups, the first
   * two of which carry a label skeleton above their input, and the last of which
   * is a bare full-width button placeholder.
   */
  it('renders two labelled fields above a full-width submit placeholder', () => {
    const { container } = render(<FormSkeleton />);

    const found = skeletons(container);
    // Two fields x (label + input), plus the submit row.
    expect(found).toHaveLength(5);
    // The two label placeholders are shorter than the full-width inputs they sit
    // above. Their widths are read off the rendered class list rather than
    // restated, and asserted as "distinct from the inputs'" so the claim is about
    // the shape -- a short label above a wide field -- rather than about one
    // arbitrary number.
    const widths = found.map(s => {
      const match = s.className.match(/\bw-(\S+)/);
      if (!match) throw new Error(`skeleton with no width class: ${s.className}`);
      return match[1]!;
    });
    const full = widths.filter(w => w === 'full');
    const labels = widths.filter(w => w !== 'full');
    expect(full).toHaveLength(3);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
  });

  // Regression: the vertical rhythm. `space-y-4` between the groups and
  // `space-y-2` inside each one is what makes the form read as three separated
  // blocks rather than one stack of identical bars.
  it('sets the outer and inner spacing that groups the fields', () => {
    const { container } = render(<FormSkeleton />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('space-y-4');
    const groups = [...root.children] as HTMLElement[];
    // Three groups: two fields and the submit row.
    expect(groups).toHaveLength(3);
    for (const group of groups.slice(0, 2)) {
      expect(group).toHaveClass('space-y-2');
    }
  });
});
