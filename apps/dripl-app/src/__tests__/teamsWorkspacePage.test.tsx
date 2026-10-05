import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `app/teams/[teamSlug]/page.tsx` had **not one of its 11 statements covered**.
 *
 * It is a client page whose whole data set is two module-level constants —
 * `MOCK_MEMBERS` and `MOCK_FILES` — so nothing here is fetched, authorised or
 * persisted. What it does *do* is drive from the route: read `teamSlug` out of
 * `useParams()`, and switch between three tab panels. That is the whole decision
 * surface, and each piece has a failure the rendered page does not announce:
 *
 *   the slug   — read with `params.teamSlug as string`. The cast is unchecked, so a
 *                missing segment renders `undefined Team` / an input whose `defaultValue`
 *                is the string `"undefined"`, and both look like an empty team.
 *   tab state  — `activeTab` starts at `'files'`, and the panels are three separate
 *                `&&` guards. A reader who made the guards independent could show all
 *                three panels at once and every "the other panels are gone" assertion
 *                below would catch it.
 *   active tab — the *only* signal of which tab is live is a class name. There is no
 *                `aria-selected`, no `role="tablist"`, no `aria-pressed`. So the six
 *                conditional-expression arms in this file are only observable through
 *                `border-purple-500 text-white` versus `border-transparent text-gray-400`,
 *                and all three tabs have to be checked in both states.
 *
 * The role badges are the same story one level down: `owner`, `admin` and `member` get
 * three different colour pairs out of a nested ternary, and all three appear in
 * `MOCK_MEMBERS`, so one render covers every arm — but only if each arm is asserted,
 * because a build that collapsed them to one colour renders an identical-looking list.
 */

/** Mutable so each test can pick the slug; `useParams` is the only route input. */
let mockParams: Record<string, string> = { teamSlug: 'design' };

vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={rest.className}>
      {children}
    </a>
  ),
}));

import TeamWorkspacePage from '@/app/teams/[teamSlug]/page';

/** `MOCK_FILES`, in source order. Ids are `1`/`2`/`3` and names are what the page prints. */
const FILES = [
  { id: '1', name: 'Q1 Planning', by: 'Alice' },
  { id: '2', name: 'Product Roadmap', by: 'Bob' },
  { id: '3', name: 'Design System', by: 'Carol' },
];

/** `MOCK_MEMBERS`, in source order, with the role each one gets a badge for. */
const MEMBERS = [
  { name: 'Alice Johnson', email: 'alice@example.com', role: 'owner', initial: 'A' },
  { name: 'Bob Smith', email: 'bob@example.com', role: 'admin', initial: 'B' },
  { name: 'Carol White', email: 'carol@example.com', role: 'member', initial: 'C' },
];

const ACTIVE_TAB_CLASS = 'border-purple-500 text-white';
const INACTIVE_TAB_CLASS = 'border-transparent text-gray-400 hover:text-white';

/** The three tab buttons, found by their visible labels. */
function tabs(): { files: HTMLElement; members: HTMLElement; settings: HTMLElement } {
  return {
    files: screen.getByRole('button', { name: 'Files' }),
    members: screen.getByRole('button', { name: 'Members' }),
    settings: screen.getByRole('button', { name: 'Settings' }),
  };
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParams = { teamSlug: 'design' };
});

describe('/teams/[teamSlug] — the route slug', () => {
  /**
   * Regression: the heading is `<slug> Team`, so a route that read the wrong param — or
   * a renamed segment — shows the wrong team's workspace. The fixture uses a lowercase
   * slug deliberately so the value is not already capitalised by the literal.
   */
  it('names the team from the route segment', () => {
    render(<TeamWorkspacePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('design Team');
  });

  /**
   * The control for the assertion above: a *different* slug produces a different
   * heading, so the previous test is pinning the read rather than a constant. Without it,
   * a page that ignored `useParams` entirely and rendered a fixed string would pass.
   */
  it('follows the slug when it changes', () => {
    mockParams = { teamSlug: 'platform' };
    render(<TeamWorkspacePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('platform Team');
  });

  /**
   * Regression: `params.teamSlug as string` is an unchecked cast and nothing guards it.
   * A segment that did not arrive does **not** render the literal text `"undefined"` —
   * React drops an `undefined` child — so the page renders a bare `Team` heading and an
   * *empty* Team Name input, and otherwise looks like a perfectly normal team page. That
   * is the characterisation worth pinning: the failure is silent and plausible, and the
   * thing to fix would be the cast, not this expectation.
   */
  it('renders a bare "Team" heading and an empty name field when the segment is missing', async () => {
    mockParams = {};

    render(<TeamWorkspacePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Team');
    expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBe('Team');

    await click(tabs().settings);
    const nameField = screen.getByRole('textbox');
    expect(nameField).toHaveValue('');
  });

  /**
   * Regression: the settings panel seeds the Team Name input from the route, which is the
   * only place the slug is read *again*. A build that hard-coded it would show "design"
   * on every team's settings page. Asserted on `defaultValue` — the input is uncontrolled,
   * so that is the property React exposes.
   */
  it('seeds the settings Team Name input from the slug', async () => {
    mockParams = { teamSlug: 'platform' };
    render(<TeamWorkspacePage />);

    await click(tabs().settings);

    expect(screen.getByDisplayValue('platform')).toBeInTheDocument();
  });

  /**
   * Regression: the header's only way out is the back link to `/dashboard`. A `Link`
   * that lost its `href` leaves the user on a team page with no navigation.
   */
  it('offers a way back to the dashboard', () => {
    render(<TeamWorkspacePage />);

    // The header link holds only an `aria-hidden` icon, so it has no accessible name to
    // query by — matching on the `href` is what identifies it among the file tiles.
    const back = screen
      .getAllByRole('link')
      .filter(link => link.getAttribute('href') === '/dashboard');
    expect(back).toHaveLength(1);
  });

  /**
   * Regression: the "New File" affordance is in the header, outside the tab panels, so
   * it is present on all three tabs. Asserted on the tabs the panels switch between —
   * if it lived inside the files panel it would vanish on the other two.
   */
  it('keeps the New File affordance in the header on every tab', async () => {
    render(<TeamWorkspacePage />);
    expect(screen.getByRole('button', { name: 'New File' })).toBeInTheDocument();

    await click(tabs().members);
    expect(screen.getByRole('button', { name: 'New File' })).toBeInTheDocument();

    await click(tabs().settings);
    expect(screen.getByRole('button', { name: 'New File' })).toBeInTheDocument();
  });
});

describe('/teams/[teamSlug] — the default tab', () => {
  /**
   * Regression: `activeTab` initialises to `'files'`, and the class on the tab button is
   * the *only* thing that says so — there is no `aria-selected` or `role="tablist"`. So
   * this assertion is the only proof of which panel is live.
   */
  it('opens on the files tab', () => {
    render(<TeamWorkspacePage />);

    expect(tabs().files.className).toContain(ACTIVE_TAB_CLASS);
    expect(tabs().files.className).not.toContain(INACTIVE_TAB_CLASS);
  });

  /**
   * The other arms of the *same* conditional for the same tab: `files` must carry the
   * inactive classes while it is not selected. Collapsing the ternary to a constant per
   * tab passes the test above and fails here.
   */
  it('marks the unselected tabs inactive', () => {
    render(<TeamWorkspacePage />);

    expect(tabs().members.className).toContain(INACTIVE_TAB_CLASS);
    expect(tabs().settings.className).toContain(INACTIVE_TAB_CLASS);
    expect(tabs().members.className).not.toContain(ACTIVE_TAB_CLASS);
    expect(tabs().settings.className).not.toContain(ACTIVE_TAB_CLASS);
  });

  /**
   * Regression: the files panel is a separate `activeTab === 'files' &&` guard, so the
   * other two panels must be absent, not merely hidden. Asserted negatively: a page that
   * rendered all three panels and covered them with CSS would otherwise pass every
   * positive assertion on the files panel below.
   */
  it('renders the files panel and neither of the others', () => {
    render(<TeamWorkspacePage />);

    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Team Members' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Team Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Team' })).toBeNull();
  });

  /**
   * Regression: every row of `MOCK_FILES` renders, and each links to its own id. A build
   * that mapped to a fixed index, or dropped the `id`, would render a plausible list of
   * three tiles that all point at the same file — the exact failure a multi-file list has
   * and that "three tiles are present" cannot see.
   */
  it('renders one tile per mock file, linked to its own id', () => {
    render(<TeamWorkspacePage />);

    for (const file of FILES) {
      const link = screen.getByRole('link', { name: new RegExp(file.name, 'i') });
      expect(link).toHaveAttribute('href', `/file/${file.id}`);
    }
    // The last file's link is the one a shared-id bug would break, so name it too.
    expect(screen.getByRole('link', { name: /Design System/i })).toHaveAttribute('href', '/file/3');
  });

  /**
   * Regression: each tile attributes the file to whoever the mock says updated it. The
   * three `updatedBy` values differ, so a build that dropped the per-row lookup would
   * print one name three times.
   */
  it('attributes each file to its own last editor', () => {
    render(<TeamWorkspacePage />);

    for (const file of FILES) {
      expect(screen.getByText(`Updated by ${file.by}`)).toBeInTheDocument();
    }
  });

  /**
   * Regression: the exact set of tiles, not just "some tiles". A `.slice(0, 1)` or an
   * off-by-one in the list would still satisfy the per-file assertions above.
   */
  it('renders exactly the three mock files and no others', () => {
    render(<TeamWorkspacePage />);

    const tiles = screen.getAllByRole('link', { name: /(Updated by)/i });
    expect(tiles).toHaveLength(FILES.length);
  });
});

describe('/teams/[teamSlug] — switching tabs', () => {
  /**
   * Regression: clicking Members swaps the panels *and* moves the active class. Both
   * halves are asserted because they are separate conditionals: a build that set
   * `activeTab` but left the class on `files` would render the members list while the
   * chrome claims otherwise, and a build that restyled without switching would render
   * two panels at once.
   */
  it('switches to the members panel and moves the active class', async () => {
    render(<TeamWorkspacePage />);

    await click(tabs().members);

    expect(screen.getByRole('heading', { name: 'Team Members' })).toBeInTheDocument();
    expect(tabs().members.className).toContain(ACTIVE_TAB_CLASS);
    expect(tabs().members.className).not.toContain(INACTIVE_TAB_CLASS);
    expect(tabs().files.className).toContain(INACTIVE_TAB_CLASS);
    expect(tabs().files.className).not.toContain(ACTIVE_TAB_CLASS);
  });

  /**
   * The control for the class assertions above: the same button carries the *other*
   * class set once the selection moves. Without it, a page whose tab classes never
   * changed would satisfy "members is active" and "files is inactive" simultaneously.
   */
  it('returns the active class to the files tab when it is re-selected', async () => {
    render(<TeamWorkspacePage />);

    await click(tabs().members);
    await click(tabs().files);

    expect(tabs().files.className).toContain(ACTIVE_TAB_CLASS);
    expect(tabs().members.className).toContain(INACTIVE_TAB_CLASS);
  });

  /**
   * Regression: exactly one panel is mounted at a time. This is the assertion that
   * catches three independent `&&` guards all evaluating true, which is what a state
   * change from `'files'` to a *second* variable would produce.
   */
  it('never shows two panels at once', async () => {
    render(<TeamWorkspacePage />);

    for (const name of ['Members', 'Settings', 'Files', 'Members', 'Files'] as const) {
      await click(screen.getByRole('button', { name }));
      const visible = [
        screen.queryByPlaceholderText('Search files...'),
        screen.queryByRole('heading', { name: 'Team Members' }),
        screen.queryByRole('heading', { name: 'Team Settings' }),
      ].filter(node => node !== null);
      expect(visible).toHaveLength(1);
    }
  });

  /**
   * Regression: every member row carries its own name, email and role. `MOCK_MEMBERS` has
   * three distinct roles and three distinct emails, so one row rendered three times would
   * fail on the second name alone.
   */
  it('renders every mock member with their email and role', async () => {
    render(<TeamWorkspacePage />);

    await click(tabs().members);

    for (const member of MEMBERS) {
      expect(screen.getByText(member.name)).toBeInTheDocument();
      expect(screen.getByText(member.email)).toBeInTheDocument();
      expect(screen.getByText(member.role)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^(owner|admin|member)$/)).toHaveLength(MEMBERS.length);
  });

  /**
   * Regression: each row shows the member's initial in the avatar. `charAt(0)` on the
   * name is the whole computation, and A/B/C differ, so the three initials are three
   * distinct assertions rather than one repeated.
   */
  it('shows each member initial in the avatar', async () => {
    render(<TeamWorkspacePage />);

    await click(tabs().members);

    for (const member of MEMBERS) {
      const row = screen.getByText(member.name).closest('div.flex.items-center.justify-between');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(member.initial)).toBeInTheDocument();
    }
  });

  /**
   * Regression: the three role badges get three different colour pairs out of a nested
   * ternary. All three roles are present in the mock data, so every arm is reachable —
   * but a build that collapsed the badge to one colour renders an identical-looking list
   * and would pass every name assertion above.
   */
  it('gives owner, admin and member three distinct badge colours', async () => {
    render(<TeamWorkspacePage />);

    await click(tabs().members);

    const badges = screen
      .getAllByText(/^(owner|admin|member)$/)
      .map(node => [node.textContent, node.className] as const);

    expect(badges.map(([role]) => role)).toEqual(['owner', 'admin', 'member']);
    expect(badges.find(([role]) => role === 'owner')?.[1]).toContain('bg-purple-600/20');
    expect(badges.find(([role]) => role === 'admin')?.[1]).toContain('bg-blue-600/20');
    expect(badges.find(([role]) => role === 'member')?.[1]).toContain('bg-gray-700');
    // Distinctness asserted, not just presence: one colour for all three would satisfy
    // the three `toContain` checks above on any single badge.
    expect(new Set(badges.map(([, cls]) => cls)).size).toBe(3);
  });

  /**
   * Regression: the members panel's own affordance — "Invite Member" — is inside the
   * panel, not the header, so it must appear and disappear with it. Paired with the
   * New-File assertion above, which is the one that must *not* move.
   */
  it('shows Invite Member only on the members tab', async () => {
    render(<TeamWorkspacePage />);
    expect(screen.queryByRole('button', { name: 'Invite Member' })).toBeNull();

    await click(tabs().members);
    expect(screen.getByRole('button', { name: 'Invite Member' })).toBeInTheDocument();

    await click(tabs().files);
    expect(screen.queryByRole('button', { name: 'Invite Member' })).toBeNull();
  });

  /**
   * Regression: the settings panel and its destructive section. "Delete Team" is the most
   * dangerous control on the page, and a build that lost the `activeTab === 'settings'`
   * guard would leave it reachable while the files panel is showing — or, worse, drop it
   * from the panel that is supposed to hold it.
   */
  it('shows the settings panel with its danger zone, and only then', async () => {
    render(<TeamWorkspacePage />);
    expect(screen.queryByRole('button', { name: 'Delete Team' })).toBeNull();

    await click(tabs().settings);

    expect(screen.getByRole('heading', { name: 'Team Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Team' })).toBeInTheDocument();

    await click(tabs().files);
    expect(screen.queryByRole('button', { name: 'Delete Team' })).toBeNull();
  });

  /**
   * Regression: the search field belongs to the files panel, so it appears and disappears
   * with it. The input is uncontrolled and the page holds no filter state, so this
   * deliberately asserts only presence — pinning "typing does nothing" would be pinning a
   * mock page's incompleteness, which is a product question and not this route's logic.
   */
  it('shows the files search field only on the files tab', async () => {
    render(<TeamWorkspacePage />);
    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();

    await click(tabs().settings);
    expect(screen.queryByPlaceholderText('Search files...')).toBeNull();

    await click(tabs().files);
    expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
  });
});
