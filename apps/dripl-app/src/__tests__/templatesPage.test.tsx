import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * `/templates` is a fully client-side catalogue preview: eight hard-coded entries, no
 * fetch, no auth, no persistence. All 13 of its statements were uncovered, which means
 * the only two things the page *does* — filter by query and filter by category — had
 * never once been executed.
 *
 * It is close to a sibling of `/library` (`libraryPage.test.tsx` owns that one) and the
 * overlap is deliberate, but the differences are what this file is for:
 *
 *   - The category filter here is an **`id`, not a label**, and `CATEGORIES` carries one
 *     entry with *no* templates: `Design`. Selecting it must render zero cards, not
 *     throw and not fall back to everything.
 *   - The category ids are lower-cased and the template categories are Title Case, so
 *     `matchesCategory` compares `template.category.toLowerCase() === selectedCategory
 *     .toLowerCase()`. A reader that dropped the lower-casing on the template side would
 *     match nothing at all for every category — a page where one chip empties the grid
 *     and the rest appear to do nothing.
 *   - `matchesSearch && matchesCategory` is an AND, as on `/library`, and the same
 *     reader-error (making it an OR) shows every item of the chosen category regardless
 *     of the query.
 *
 * Nothing here can fail loudly, which is why the assertions are on *rendered output*: a
 * filter that inverted does not throw, it just quietly shows the wrong catalogue, and a
 * chip that does nothing looks exactly like a chip that works when you already expected
 * zero results.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import TemplatesPage from '@/app/templates/page';

/** `TEMPLATES` in source order, as the page declares them. */
const CATALOGUE = [
  { name: 'Blank Canvas', category: 'Basic', description: 'Start with a clean slate' },
  { name: 'Flowchart', category: 'Diagrams', description: 'Process flows and decision trees' },
  {
    name: 'Wireframe',
    category: 'Design',
    description: 'UI/UX wireframing with common components',
  },
  { name: 'Mind Map', category: 'Planning', description: 'Brainstorming and idea organization' },
  { name: 'Kanban Board', category: 'Planning', description: 'Task management and workflow' },
  { name: 'Retrospective', category: 'Meetings', description: 'Team retrospective template' },
  {
    name: 'User Story Map',
    category: 'Planning',
    description: 'Map out user journeys and stories',
  },
  {
    name: 'System Architecture',
    category: 'Diagrams',
    description: 'Technical architecture diagrams',
  },
] as const;

/** `CATEGORIES` in source order. `Design` is present here and holds one template. */
const CHIPS = ['All', 'Basic', 'Diagrams', 'Design', 'Planning', 'Meetings'] as const;

function searchField(): HTMLInputElement {
  return screen.getByPlaceholderText('Search templates...') as HTMLInputElement;
}

function chipRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>('.flex.gap-2.mb-8');
  if (!row) throw new Error('the category row was not rendered');
  return row;
}

/** The six category buttons, in `CATEGORIES` order. */
function chips(): HTMLElement[] {
  return within(chipRow()).getAllByRole('button') as HTMLElement[];
}

function chip(label: string): HTMLElement {
  const found = chips().find(button => button.textContent === label);
  if (!found) throw new Error(`category chip ${label} not rendered`);
  return found;
}

/** Card titles currently rendered. Grid and empty state use `<h3>`, so this is stable. */
function renderedNames(): string[] {
  return screen.queryAllByRole('heading', { level: 3 }).map(heading => heading.textContent ?? '');
}

function typeSearch(query: string): void {
  fireEvent.change(searchField(), { target: { value: query } });
}

function chooseCategory(label: string): void {
  fireEvent.click(chip(label));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/templates — the catalogue as shipped', () => {
  /**
   * Regression: nothing fetches, so the eight literals *are* the page. If one entry were
   * dropped by an off-by-one, the grid would silently shrink with no request that would
   * fail to announce it. Asserted as an exact ordered list, so a reorder is caught too.
   */
  it('renders every entry of the catalogue, in order', () => {
    render(<TemplatesPage />);

    expect(renderedNames()).toEqual(CATALOGUE.map(template => template.name));
  });

  /**
   * Regression: `selectedCategory` starts as `'all'`, which is `CATEGORIES`' first id
   * but matches no template's category. It has to mean "no category constraint", or the
   * page arrives empty. Both halves are asserted: the chip shows as selected *and* all
   * eight cards are there, so a build that highlighted the chip while filtering by it
   * cannot pass.
   */
  it('starts unfiltered with the All chip selected', () => {
    render(<TemplatesPage />);

    expect(chip('All')).toHaveClass('bg-purple-600');
    expect(renderedNames()).toHaveLength(CATALOGUE.length);
  });

  /**
   * Regression: the back link is the only navigation off a page with no other exit, and
   * it carries an icon and no text — so its accessible name is empty and it cannot be
   * found by role + name. Asserted on the rendered anchor's `href`, which is what the
   * click actually uses.
   */
  it('links back to the dashboard', () => {
    render(<TemplatesPage />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard');
  });

  /**
   * Regression: `aria-label={`${template.name} template preview (coming soon)`}` on each
   * card. The grid renders eight identical-looking `<article>`s whose only text is the
   * name and description, and the label is what says the preview is a placeholder rather
   * than a rendered image — a card that lost it reads as a broken image.
   */
  it('labels each card as a coming-soon preview of itself', () => {
    render(<TemplatesPage />);

    expect(
      screen.getByLabelText('Blank Canvas template preview (coming soon)')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('System Architecture template preview (coming soon)')
    ).toBeInTheDocument();
  });

  /**
   * Regression: the card prints `{template.category} · Coming soon`. That category word
   * is the only place the catalogue says what a template belongs to, and it is asserted
   * per entry with `getAllByText` because several share a category.
   */
  it('shows each template category alongside its name', () => {
    render(<TemplatesPage />);

    // Three Planning entries, so the count is the assertion.
    expect(screen.getAllByText('Planning · Coming soon')).toHaveLength(3);
    expect(screen.getAllByText('Diagrams · Coming soon')).toHaveLength(2);
    expect(screen.getByText('Meetings · Coming soon')).toBeInTheDocument();
  });
});

describe('/templates — filtering', () => {
  /**
   * Regression: the search covers **name OR description**. The name half is asserted
   * here and the description-only half by the next test, because a build that consulted
   * only one of the two passes whichever single assertion it was given. `kanban` occurs
   * in no description, so this result is reachable only through `template.name`.
   */
  it('searches the name', () => {
    render(<TemplatesPage />);

    typeSearch('kanban');

    expect(renderedNames()).toEqual(['Kanban Board']);
  });

  /**
   * The description half of the same `||`. `wireframing` appears only in Wireframe's
   * description and nowhere in any name, so a build that consulted only `template.name`
   * renders nothing here.
   */
  it('searches the description', () => {
    render(<TemplatesPage />);

    typeSearch('wireframing');

    expect(renderedNames()).toEqual(['Wireframe']);
  });

  /**
   * Regression: both sides are lower-cased (`name.toLowerCase().includes
   * (searchQuery.toLowerCase())`), so a mixed-case query matches. Lower-casing only the
   * entry side makes `KANBAN` find nothing, which is invisible until someone types in
   * caps — and this page's audience is someone reaching for a template mid-meeting.
   */
  it('matches the query case-insensitively in both directions', () => {
    render(<TemplatesPage />);

    typeSearch('KANBAN');
    expect(renderedNames()).toEqual(['Kanban Board']);

    typeSearch('mind map');
    expect(renderedNames()).toEqual(['Mind Map']);

    typeSearch('Mind Map');
    expect(renderedNames()).toEqual(['Mind Map']);
  });

  /**
   * Regression: the input is *controlled* on `searchQuery`. Reading the value from
   * anywhere else, or leaving it uncontrolled, means the chips filter on a stale query
   * while the box shows a new one — and the grid appears to have a mind of its own.
   */
  it('shows the query it is filtering by', () => {
    render(<TemplatesPage />);

    // `chart` appears in exactly one name, `Flowchart` — deliberately not `flow`, which
    // is a substring of Kanban Board's description (`...and workflow`).
    typeSearch('chart');

    expect(searchField()).toHaveValue('chart');
    expect(renderedNames()).toEqual(['Flowchart']);
  });

  /**
   * Regression: `matchesSearch && matchesCategory` is an AND. A search naming one entry
   * inside a category must narrow to that entry, and a category must not be able to
   * rescue a query that matches nothing in it — that is what `||` would do, and it would
   * show every Planning entry for a search about flowcharts.
   */
  it('applies the query and the category together, not as alternatives', () => {
    render(<TemplatesPage />);

    typeSearch('chart');
    chooseCategory('Diagrams');
    expect(renderedNames()).toEqual(['Flowchart']);

    // Same query, a category that cannot contain it: the intersection is empty.
    chooseCategory('Meetings');
    expect(renderedNames()).toEqual([]);
  });

  /**
   * Regression: a category must not rescue a query that matches nothing inside it, which
   * is the second half of the `&&` and the part `||` would break. Two Diagrams entries and
   * a query about none of them: the honest answer is zero cards, and the empty-state copy
   * has to say so rather than the grid quietly showing both Diagrams templates.
   */
  it('renders nothing for a query that matches nothing inside the chosen category', () => {
    render(<TemplatesPage />);

    typeSearch('wireframing');
    chooseCategory('Diagrams');

    expect(renderedNames()).toEqual([]);
    expect(screen.getByText('No templates found matching your search.')).toBeInTheDocument();
  });

  /**
   * Regression: `template.category.toLowerCase() === selectedCategory.toLowerCase()`.
   * The stored categories are Title Case and the chip ids are lower-case, so this
   * comparison only matches because of the lower-casing. Every category is checked, so a
   * build that dropped the transform cannot pass by accident on one of them.
   */
  it('narrows to the chosen category across every chip', () => {
    render(<TemplatesPage />);

    chooseCategory('Basic');
    expect(renderedNames()).toEqual(['Blank Canvas']);

    chooseCategory('Diagrams');
    expect(renderedNames()).toEqual(['Flowchart', 'System Architecture']);

    chooseCategory('Design');
    expect(renderedNames()).toEqual(['Wireframe']);

    chooseCategory('Meetings');
    expect(renderedNames()).toEqual(['Retrospective']);

    chooseCategory('All');
    expect(renderedNames()).toHaveLength(CATALOGUE.length);
  });

  /**
   * Regression: `Planning` holds three entries, so it is the category where a filter that
   * matched on the wrong field (name, or description) would be most visible. Asserted as
   * the exact three, in order.
   */
  it('narrows a multi-entry category to all of its entries', () => {
    render(<TemplatesPage />);

    chooseCategory('Planning');

    expect(renderedNames()).toEqual(['Mind Map', 'Kanban Board', 'User Story Map']);
  });

  /**
   * Regression: a query that matches nothing renders zero cards *and* says so. The
   * alternative failure is a fallback that ignores an unmatched query and shows the whole
   * catalogue, so the user is told nothing about their search having failed — which on
   * this page looks like the search box being ignored.
   */
  it('renders nothing and says so for a query that matches no template', () => {
    render(<TemplatesPage />);

    typeSearch('zzzz-nothing-matches');

    expect(renderedNames()).toEqual([]);
    expect(screen.getByText('No templates found matching your search.')).toBeInTheDocument();
  });

  /**
   * Regression: the empty-state copy is rendered by `filteredTemplates.length === 0`, so
   * it must **not** appear while there are results. Asserted as an absence so that
   * clearing the query is observable — a build showing both at once reads as a search
   * that never narrows.
   */
  it('hides the empty-state copy while there are results', () => {
    render(<TemplatesPage />);

    expect(screen.queryByText('No templates found matching your search.')).not.toBeInTheDocument();

    typeSearch('zzz');
    expect(screen.getByText('No templates found matching your search.')).toBeInTheDocument();

    typeSearch('');
    expect(screen.queryByText('No templates found matching your search.')).not.toBeInTheDocument();
    expect(renderedNames()).toHaveLength(CATALOGUE.length);
  });

  /**
   * Regression: neither filter is reset by the other. A page that cleared the query on
   * every chip click would make a category unusable for anyone who searched first, and
   * the silent version is a stale filter the user cannot see.
   */
  it('keeps the query when the category changes, and the category when the query changes', () => {
    render(<TemplatesPage />);

    // `retrospective` matches one Planning-nothing at all, so choosing `Planning` after
    // it produces the empty intersection — which only holds if the query survived.
    typeSearch('retrospective');
    chooseCategory('Planning');
    expect(searchField()).toHaveValue('retrospective');
    expect(renderedNames()).toEqual([]);

    // And the category survives a query change: one Planning entry matches, not all three.
    typeSearch('story');
    expect(renderedNames()).toEqual(['User Story Map']);
  });
});

describe('/templates — the category chips', () => {
  /**
   * Regression: the selected chip is identified **only** by its class. There is no
   * `aria-pressed` on these buttons, so `bg-purple-600` *is* the whole signal of which
   * category is active. Both directions are asserted — the newly selected chip and the
   * previously selected one — because a build that only ever added the class would pass
   * a single-sided check.
   */
  it('marks the selected chip and unmarks the previous one', () => {
    render(<TemplatesPage />);
    expect(chip('All')).toHaveClass('bg-purple-600');
    expect(chip('Basic')).not.toHaveClass('bg-purple-600');

    chooseCategory('Basic');

    expect(chip('Basic')).toHaveClass('bg-purple-600');
    expect(chip('All')).toHaveClass('bg-gray-800');
    expect(chip('All')).not.toHaveClass('bg-purple-600');
  });

  /**
   * Regression: there are exactly six chips, from `CATEGORIES`, in source order. A chip
   * dropped from the map would remove a way to reach a category entirely, and a chip
   * added by hand would drift from the constant the filter uses.
   */
  it('renders one chip per CATEGORIES entry, in order', () => {
    render(<TemplatesPage />);

    expect(chips()).toHaveLength(CHIPS.length);
    expect(chips().map(button => button.textContent)).toEqual([...CHIPS]);
  });

  /**
   * Regression: each chip's `onClick` passes its own `id`, not its label and not the
   * previous selection. Clicking a chip already selected is the control: a handler that
   * only fired on a change would still show the right results for the *first* click, and
   * this asserts the id it acts on by checking that re-selecting changes nothing about
   * the filter rather than about the highlight.
   */
  it('keeps the same filter when the active chip is clicked again', () => {
    render(<TemplatesPage />);
    chooseCategory('Planning');
    expect(renderedNames()).toHaveLength(3);

    chooseCategory('Planning');

    expect(renderedNames()).toEqual(['Mind Map', 'Kanban Board', 'User Story Map']);
    expect(chip('Planning')).toHaveClass('bg-purple-600');
  });
});
