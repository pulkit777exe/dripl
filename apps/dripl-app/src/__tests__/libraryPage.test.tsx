import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * `/library` is a fully client-side mock catalogue: `MOCK_LIBRARY` is a module-level
 * constant, there is no fetch, no auth, and no persistence. All 29 statements were
 * uncovered, which means the filtering, the view-mode switch and the favourite
 * toggle — the only three things this page *does* — had never once been executed.
 *
 * The three pieces of behaviour are worth pinning separately because each has a
 * distinct failure mode a reader cannot see:
 *
 *   filtering — `matchesSearch && matchesCategory`, an AND. A reader that made it an
 *               OR would show every item of the chosen category regardless of the
 *               query, and the user would search for one arrow and get four hundred
 *               shapes; a reader that dropped `toLowerCase()` on the query side would
 *               make search case-sensitive, which is invisible until someone types
 *               lowercase.
 *   view mode — grid and list render *different markup from the same data*. Only the
 *               list branch prints `item.category`, so asserting on the name alone
 *               passes in both modes and pins nothing about the switch.
 *   favourites — initialised from `isFavorite` at mount, and then purely local state
 *               that nothing writes back. `toggleFavorite` copies the Set, so a
 *               mutation-in-place version would still look right for one item and then
 *               be unable to un-favourite anything.
 *
 * The one thing asserted about layout is the state class (`bg-gray-700` on the active
 * view button, `bg-purple-600` on the active category) because that class *is* the
 * only signal of which mode is active — there is no `aria-pressed` on these buttons.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import LibraryPage from '@/app/library/page';

/** The four entries of `MOCK_LIBRARY`, in source order. */
const ITEMS = [
  {
    id: '1',
    name: 'Flowchart Shapes',
    category: 'Diagrams',
    author: 'Dripl Team',
    downloads: 12500,
    favorite: false,
  },
  {
    id: '2',
    name: 'UI Icons Pack',
    category: 'Icons',
    author: 'Community',
    downloads: 8200,
    favorite: true,
  },
  {
    id: '3',
    name: 'Architecture Symbols',
    category: 'Diagrams',
    author: 'Dripl Team',
    downloads: 5600,
    favorite: false,
  },
  {
    id: '4',
    name: 'Hand-drawn Arrows',
    category: 'Shapes',
    author: 'Community',
    downloads: 15000,
    favorite: true,
  },
] as const;

const CATEGORIES = ['All', 'Diagrams', 'Icons', 'Shapes', 'UI Components'] as const;

function searchField(): HTMLInputElement {
  return screen.getByPlaceholderText('Search library...') as HTMLInputElement;
}

/** The two view-mode buttons, in source order: grid, then list. */
function viewButtons(): HTMLElement[] {
  const header = document.querySelector('header');
  if (!header) throw new Error('library header not rendered');
  const buttons = within(header as HTMLElement).getAllByRole('button');
  if (buttons.length !== 2) throw new Error(`expected 2 view buttons, got ${buttons.length}`);
  return buttons;
}

function gridButton(): HTMLElement {
  return viewButtons()[0] as HTMLElement;
}

function listButton(): HTMLElement {
  return viewButtons()[1] as HTMLElement;
}

/** Category chips, in `CATEGORIES` order. */
function categoryChips(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter(button =>
      CATEGORIES.includes(button.textContent as (typeof CATEGORIES)[number])
    ) as HTMLElement[];
}

function categoryChip(label: string): HTMLElement {
  const chip = categoryChips().find(b => b.textContent === label);
  if (!chip) throw new Error(`category chip ${label} not rendered`);
  return chip;
}

function typeSearch(query: string): void {
  fireEvent.change(searchField(), { target: { value: query } });
}

function chooseCategory(label: string): void {
  fireEvent.click(categoryChip(label));
}

function switchToList(): void {
  fireEvent.click(listButton());
}

/** Card titles currently rendered. Grid and list both use `<h3>`, so this is mode-agnostic. */
function renderedNames(): string[] {
  return screen.queryAllByRole('heading', { level: 3 }).map(h => h.textContent ?? '');
}

function favoriteButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /favorites$/i });
}

function favoriteButton(itemName: string): HTMLElement {
  const button = favoriteButtons().find(b =>
    (b.getAttribute('aria-label') ?? '').includes(itemName)
  );
  if (!button) throw new Error(`no favourite button for ${itemName}`);
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/library — the catalogue as shipped', () => {
  /**
   * Regression: nothing fetches, so `MOCK_LIBRARY` *is* the page. If the filter were
   * inverted, or one entry dropped by an off-by-one, the catalogue silently shrinks
   * and there is no request that would fail to announce it. Asserted on names only,
   * so it holds in either view mode.
   */
  it('renders every entry of the mock library', () => {
    render(<LibraryPage />);

    expect(renderedNames()).toEqual(ITEMS.map(item => item.name));
  });

  /**
   * Regression: no category is selected at mount, so `selectedCategory === 'All'` must
   * mean "no category constraint" rather than "the literal category named All" — no
   * item has `category === 'All'`, so the stricter reading renders an empty page and
   * the catalogue looks broken on arrival.
   */
  it('starts unfiltered even though the All chip is selected', () => {
    render(<LibraryPage />);

    expect(categoryChip('All')).toHaveClass('bg-purple-600');
    expect(renderedNames()).toHaveLength(ITEMS.length);
  });

  /**
   * Regression: the back link is the only navigation off a page with no other exit.
   * It carries an icon and no text, so its accessible name is empty — asserted on the
   * `href` via the rendered anchor rather than by role+name, which would not match.
   */
  it('links back to the dashboard', () => {
    render(<LibraryPage />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard');
  });
});

describe('/library — filtering', () => {
  /**
   * Regression: `item.name.toLowerCase().includes(searchQuery.toLowerCase())`. Both
   * sides are lower-cased, so a mixed-case query matches. Lower-casing only the item
   * name makes `ARROWS` find nothing, and the page looks broken for anyone who
   * typed in caps.
   */
  it('matches the search query case-insensitively in both directions', () => {
    render(<LibraryPage />);

    typeSearch('ARROWS');
    expect(renderedNames()).toEqual(['Hand-drawn Arrows']);

    typeSearch('ui icons');
    expect(renderedNames()).toEqual(['UI Icons Pack']);
  });

  /**
   * The control for the test above: the same query lower-cased also matches, so the
   * assertion is about case handling and not about the query happening to be stored
   * lowercase.
   */
  it('matches the same query lower-cased', () => {
    render(<LibraryPage />);

    typeSearch('arrows');

    expect(renderedNames()).toEqual(['Hand-drawn Arrows']);
  });

  /**
   * Regression: the search box is *controlled* on `searchQuery`. Reading
   * `e.target.value` from somewhere else, or leaving the input uncontrolled, means
   * the chips act on a stale query while the box shows a new one — the filter appears
   * to have a mind of its own.
   */
  it('shows the query it is filtering by', () => {
    render(<LibraryPage />);

    typeSearch('flow');

    expect(searchField()).toHaveValue('flow');
    expect(renderedNames()).toEqual(['Flowchart Shapes']);
  });

  /**
   * Regression: `matchesSearch && matchesCategory`. The two constraints are an AND, so
   * a search that names one item inside a category must narrow to that item, and a
   * category must not be able to rescue a query that matches nothing in it. Replacing
   * `&&` with `||` passes both single-constraint tests above and fails here.
   */
  it('applies the query and the category together, not as alternatives', () => {
    render(<LibraryPage />);

    typeSearch('symbols');
    chooseCategory('Diagrams');
    expect(renderedNames()).toEqual(['Architecture Symbols']);

    // Same query, a category that cannot contain it: the intersection is empty.
    chooseCategory('Icons');
    expect(renderedNames()).toEqual([]);
  });

  /**
   * Regression: category selection alone narrows to that category's entries, and
   * `All` puts the rest back. Asserted on the exact set, so a category filter that
   * silently also matched on author or downloads would fail.
   */
  it('narrows to the chosen category and restores everything on All', () => {
    render(<LibraryPage />);

    chooseCategory('Shapes');
    expect(renderedNames()).toEqual(['Hand-drawn Arrows']);

    chooseCategory('Diagrams');
    expect(renderedNames()).toEqual(['Flowchart Shapes', 'Architecture Symbols']);

    chooseCategory('All');
    expect(renderedNames()).toEqual(ITEMS.map(item => item.name));
  });

  /**
   * Regression: `CATEGORIES` contains a value no item carries (`UI Components`). It
   * must render as an empty result, not throw and not fall back to everything — an
   * empty result is the honest answer and is what the AND produces.
   */
  it('renders nothing for a category no item belongs to', () => {
    render(<LibraryPage />);

    chooseCategory('UI Components');

    expect(renderedNames()).toEqual([]);
    expect(screen.getByRole('button', { name: categoryChipText('UI Components') })).toHaveClass(
      'bg-purple-600'
    );
  });

  /**
   * Regression: a query matching nothing renders zero cards and stays there. The
   * alternative failure is a fallback that ignores an unmatched query and shows the
   * whole catalogue, so the user is told nothing about their search having failed.
   */
  it('renders nothing for a query that matches no item', () => {
    render(<LibraryPage />);

    typeSearch('zzzz-nothing-matches');

    expect(renderedNames()).toEqual([]);
  });

  /**
   * Regression: category selection is not reset by typing, and typing is not reset by
   * selecting a category. Both halves matter — a page that cleared the query on every
   * chip click would make "Icons" unusable for anyone who searched first, and the
   * silent version is a stale filter the user cannot see.
   */
  it('keeps the query when the category changes and the category when the query changes', () => {
    render(<LibraryPage />);

    typeSearch('shapes');
    chooseCategory('Diagrams');
    expect(searchField()).toHaveValue('shapes');
    expect(renderedNames()).toEqual(['Flowchart Shapes']);

    typeSearch('');
    expect(renderedNames()).toEqual(['Flowchart Shapes', 'Architecture Symbols']);
  });
});

describe('/library — the view switch', () => {
  /**
   * Regression: grid is the mount default. Asserted on the *container's* class, not on
   * the presence of the names — both modes render the same four names, so a name-based
   * assertion passes whether or not the switch works at all.
   */
  it('starts in grid view', () => {
    const { container } = render(<LibraryPage />);

    expect(gridButton()).toHaveClass('bg-gray-700');
    expect(listButton()).toHaveClass('hover:bg-gray-800');
    expect(container.querySelector('.grid.grid-cols-1')).not.toBeNull();
    expect(container.querySelector('.space-y-2')).toBeNull();
  });

  /**
   * Regression: the switch replaces the markup, so the list-only detail — the
   * category on each row — appears only in list mode. This is the assertion that can
   * fail when the ternary is broken in a way that keeps the names on screen.
   */
  it('swaps grid markup for list markup', () => {
    const { container } = render(<LibraryPage />);

    switchToList();

    expect(listButton()).toHaveClass('bg-gray-700');
    expect(gridButton()).toHaveClass('hover:bg-gray-800');
    expect(container.querySelector('.space-y-2')).not.toBeNull();
    expect(container.querySelector('.grid.grid-cols-1')).toBeNull();
    expect(screen.getAllByText(/by Dripl Team/).length).toBeGreaterThan(0);
    // Both Diagrams entries, so the exact category line is asserted per entry.
    expect(screen.getAllByText(/^Diagrams • by Dripl Team$/)).toHaveLength(2);
  });

  /**
   * Regression: the switch is two-way, not a one-way trip. A `setViewMode('list')`
   * that replaced both handlers leaves the user stuck in list view with no way back.
   */
  it('switches back to grid', () => {
    const { container } = render(<LibraryPage />);
    switchToList();

    fireEvent.click(gridButton());

    expect(container.querySelector('.grid.grid-cols-1')).not.toBeNull();
    expect(container.querySelector('.space-y-2')).toBeNull();
    expect(screen.queryByText('Diagrams • by Dripl Team')).not.toBeInTheDocument();
  });

  /**
   * Regression: the view switch is independent of the filter. Re-rendering the list
   * branch must show the same `filteredItems`, so switching to list cannot reveal items
   * the search had excluded — which is the failure mode of computing the filter inside
   * one branch only.
   */
  it('shows the same filtered set in either view mode', () => {
    render(<LibraryPage />);

    typeSearch('arrows');
    expect(renderedNames()).toEqual(['Hand-drawn Arrows']);

    switchToList();
    expect(renderedNames()).toEqual(['Hand-drawn Arrows']);
    expect(screen.getByText('Shapes • by Community')).toBeInTheDocument();

    fireEvent.click(gridButton());
    expect(renderedNames()).toEqual(['Hand-drawn Arrows']);
  });

  /**
   * Regression: `downloads.toLocaleString()`. Asserted on the rendered digits, because
   * a raw `{item.downloads}` renders `15000` and the counts are the only numeric
   * signal in the card.
   */
  it('formats download counts with locale separators', () => {
    render(<LibraryPage />);

    expect(screen.getAllByText('15,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12,500').length).toBeGreaterThan(0);
  });
});

describe('/library — favourites', () => {
  /**
   * Regression: the initial `Set` is built from `isFavorite` in the mock data
   * (`UI Icons Pack`, `Hand-drawn Arrows`). Asserted on both directions — seeded true
   * *and* seeded false — because a filter that kept everything would satisfy only the
   * first half.
   */
  it('seeds favourites from the mock data', () => {
    render(<LibraryPage />);

    expect(favoriteButton('UI Icons Pack')).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteButton('Hand-drawn Arrows')).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteButton('Flowchart Shapes')).toHaveAttribute('aria-pressed', 'false');
    expect(favoriteButton('Architecture Symbols')).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * Regression: the heart is the only favourite control and it carries no text, so the
   * accessible name has to say *which direction* the click goes. A label that only said
   * "favourite" tells a screen-reader user nothing about whether the item is currently
   * a favourite, and `aria-pressed` alone does not survive a label that never changes.
   */
  it('labels the toggle with the direction it will go', () => {
    render(<LibraryPage />);

    expect(favoriteButton('Flowchart Shapes')).toHaveAttribute(
      'aria-label',
      'Add Flowchart Shapes to favorites'
    );
    expect(favoriteButton('UI Icons Pack')).toHaveAttribute(
      'aria-label',
      'Remove UI Icons Pack from favorites'
    );
  });

  /**
   * Regression: the add branch of `toggleFavorite`. Clicking an un-favourited item adds
   * it; asserted on all three observable channels (`aria-pressed`, the label's
   * direction, and the fill class) so a partial implementation cannot pass.
   */
  it('adds an item to favourites when its heart is clicked', () => {
    render(<LibraryPage />);

    fireEvent.click(favoriteButton('Flowchart Shapes'));

    const button = favoriteButton('Flowchart Shapes');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('aria-label', 'Remove Flowchart Shapes from favorites');
    expect(button.querySelector('svg')).toHaveClass('fill-red-500');
  });

  /**
   * Regression: the delete branch, and the `new Set(previous)` copy that makes it
   * possible. `toggleFavorite` builds a fresh Set and deletes from it; a version that
   * mutated the previous Set in place would still toggle, but React would see the same
   * object identity and skip the re-render, so the label and `aria-pressed` would
   * never update. Asserted on the rendered result, which is what actually depends on
   * the copy.
   */
  it('removes an item from favourites when its heart is clicked again', () => {
    render(<LibraryPage />);

    fireEvent.click(favoriteButton('UI Icons Pack'));
    expect(favoriteButton('UI Icons Pack')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(favoriteButton('UI Icons Pack'));
    const button = favoriteButton('UI Icons Pack');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('aria-label', 'Remove UI Icons Pack from favorites');
  });

  /**
   * Regression: toggling is per-item and the new Set is a copy, so one item's
   * favourite-ness does not disturb another's. A `new Set()` instead of
   * `new Set(previous)` — the classic "forgot to spread" — passes both single-item tests
   * and fails here, and the user loses every other favourite each time they click one.
   */
  it('leaves the other items untouched when one is toggled', () => {
    render(<LibraryPage />);

    fireEvent.click(favoriteButton('Flowchart Shapes'));

    expect(favoriteButton('UI Icons Pack')).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteButton('Hand-drawn Arrows')).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteButton('Architecture Symbols')).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * Regression: favourites are independent of the active view mode. Both branches read
   * `favoriteIds.has(item.id)`, but only the grid branch has the heart button, so a
   * list-only build has no way to change a favourite at all — which is fine, and the
   * state must survive the round trip regardless.
   */
  it('keeps favourites across a view-mode round trip', () => {
    render(<LibraryPage />);

    fireEvent.click(favoriteButton('Flowchart Shapes'));
    switchToList();
    fireEvent.click(gridButton());

    expect(favoriteButton('Flowchart Shapes')).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteButton('UI Icons Pack')).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Regression: the heart button carries `type="button"`. It sits inside no `<form>`
   * today, so this is belt-and-braces, but a heart that defaulted to `submit` inside
   * any future wrapper form would reload the page and silently discard the toggle.
   */
  it('is a non-submitting button', () => {
    render(<LibraryPage />);

    expect(favoriteButton('Flowchart Shapes')).toHaveAttribute('type', 'button');
  });
});

/** Reads a chip's own text out of the DOM so the assertion needs no hard-coded string. */
function categoryChipText(label: string): string {
  return categoryChip(label).textContent ?? '';
}
