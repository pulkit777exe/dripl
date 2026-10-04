import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';

/**
 * The sidebar is the one dashboard component that still talks to the API from
 * the client: the plan-usage meter fetches on mount and again on window focus
 * and on every `dripl:files-changed` event the dashboard and collections pages
 * dispatch. That makes it the component where a stale number is most likely to
 * be seen by a user, so the meter is the focus here; the account menu's
 * close-animation latch is the other thing worth pinning.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
const nav = vi.hoisted(() => ({ pathname: '/dashboard' }));
const auth = vi.hoisted(() => ({
  user: {
    id: 'me',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    image: null as string | null,
  } as { id: string; email: string; name: string | null; image: string | null } | null,
  logout: vi.fn(async () => {}),
}));
const api = vi.hoisted(() => ({ listFiles: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => nav.pathname }));
vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({ apiClient: api }));

/** A `/files?page=1&limit=1` answer: only the total is read. */
function usage(total: number) {
  return { files: [], total, page: 1, limit: 1 };
}

async function settle(): Promise<void> {
  await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function usageCard(): HTMLElement {
  const label = screen.getByText(/free plan usage/i);
  const card = label.parentElement?.parentElement;
  if (!(card instanceof HTMLElement)) throw new Error('usage card not rendered');
  return card;
}

/**
 * The meter is `[label/count row, track, footnote]`; the fill is the track's
 * only child, and its inline width is the clamped percentage.
 */
function usageFill(): HTMLElement {
  const track = usageCard().children[1];
  const fill = track?.firstElementChild;
  if (!(fill instanceof HTMLElement)) throw new Error('usage fill not rendered');
  return fill;
}

/**
 * The account dropdown, however it is currently committed. It is unmounted and
 * re-created across a close (the `closing` latch is set from an effect, one
 * commit after `userMenuOpen` goes false), so the node is re-queried each time
 * rather than captured.
 */
function accountMenu(): HTMLElement {
  const menu = document.querySelector('.t-dropdown');
  if (!(menu instanceof HTMLElement)) throw new Error('account menu not rendered');
  return menu;
}

const queryAccountMenu = () => document.querySelector('.t-dropdown');

const accountToggle = () => screen.getByRole('button', { name: /ada@example\.com/i });

async function openAccountMenu(): Promise<HTMLElement> {
  fireEvent.click(accountToggle());
  await settle();
  expect(accountMenu()).toHaveClass('is-open');
  return accountMenu();
}

/**
 * jsdom's `getComputedStyle` answers `''` for custom properties, so the CSS
 * variable the close timer reads has to come from a stub that resolves it.
 */
function withDropdownCloseDuration(value: string): void {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = original(element);
    if (element !== document.documentElement) return style;
    return new Proxy(style, {
      get(target, property) {
        if (property !== 'getPropertyValue') {
          const found = Reflect.get(target, property);
          return typeof found === 'function' ? found.bind(target) : found;
        }
        return (name: string) =>
          name === '--dropdown-close-dur' ? value : target.getPropertyValue(name);
      },
    });
  });
}

const navLink = (label: string) => screen.getByRole('link', { name: new RegExp(label, 'i') });

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useFakeTimers();
  document.documentElement.style.removeProperty('--dropdown-close-dur');
  auth.user = { id: 'me', email: 'ada@example.com', name: 'Ada Lovelace', image: null };
  nav.pathname = '/dashboard';
  api.listFiles.mockResolvedValue(usage(0));
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.removeProperty('--dropdown-close-dur');
});

describe('DashboardSidebar — plan usage meter', () => {
  /** Regression: the meter is fed by a client fetch, so a missing effect leaves it at 0/3. */
  it('reads the account total from a single fetch on mount', async () => {
    api.listFiles.mockResolvedValue(usage(2));

    render(<DashboardSidebar />);
    await settle();

    expect(api.listFiles).toHaveBeenCalledTimes(1);
    expect(api.listFiles).toHaveBeenCalledWith({ page: 1, limit: 1 });
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(usageFill()).toHaveStyle({ width: '67%' });
  });

  /**
   * Regression: the meter assigns `response.total`; it must never add to the
   * previous value. Accumulating turns two refreshes into `4/3` and, worse, into
   * a meter that only ever climbs — a user who deletes canvases keeps seeing a
   * full quota bar.
   */
  it('does not double-count when two refreshes resolve', async () => {
    api.listFiles.mockResolvedValue(usage(2));
    render(<DashboardSidebar />);
    await settle();
    expect(screen.getByText('2/3')).toBeInTheDocument();

    window.dispatchEvent(new Event('dripl:files-changed'));
    await settle();
    window.dispatchEvent(new Event('dripl:files-changed'));
    await settle();

    expect(api.listFiles).toHaveBeenCalledTimes(3);
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(usageFill()).toHaveStyle({ width: '67%' });
  });

  /**
   * Regression: `dripl:files-changed` is the sidebar's only in-app refresh
   * signal, and it is dispatched by create and delete. Unsubscribed, the meter
   * reports the count from whenever the page loaded and the user is told their
   * quota is unchanged immediately after creating a canvas.
   */
  it('reports the fresh count after a file is created', async () => {
    api.listFiles.mockResolvedValueOnce(usage(2)).mockResolvedValueOnce(usage(3));
    render(<DashboardSidebar />);
    await settle();
    expect(screen.getByText('2/3')).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent('dripl:files-changed'));
    await settle();

    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(usageFill()).toHaveStyle({ width: '100%' });
  });

  /** Regression: the other refresh trigger — returning to a backgrounded tab. */
  it('refreshes when the window regains focus', async () => {
    api.listFiles.mockResolvedValueOnce(usage(1)).mockResolvedValueOnce(usage(2));
    render(<DashboardSidebar />);
    await settle();

    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(api.listFiles).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  /**
   * Regression: both listeners are removed on cleanup. A leaked listener keeps
   * fetching for a sidebar that no longer exists — and keeps the closure's
   * `setUsedCanvases` alive for the life of the document, so the dashboard's
   * plan meter keeps hammering the API after every navigation.
   */
  it('stops listening once it is unmounted', async () => {
    const { unmount } = render(<DashboardSidebar />);
    await settle();
    expect(api.listFiles).toHaveBeenCalledTimes(1);

    unmount();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('dripl:files-changed'));
    await settle();

    expect(api.listFiles).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the `if (!user)` guard. Unguarded, the signed-out shell still
   * fires an authenticated `/files` request that 401s, and the meter would show
   * a 401 as a usage count.
   */
  it('shows an empty meter and fetches nothing while signed out', async () => {
    auth.user = null;

    render(<DashboardSidebar />);
    await settle();

    expect(api.listFiles).not.toHaveBeenCalled();
    expect(screen.getByText('0/3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument();
  });

  /**
   * Regression: a failed refresh keeps the previous count. Resetting to 0 in the
   * `catch` makes a transient 5xx look like "you have no canvases", which is
   * the one number on this page a user will act on.
   */
  it('keeps the previous count when a refresh fails', async () => {
    api.listFiles.mockResolvedValueOnce(usage(2)).mockRejectedValueOnce(new Error('network down'));
    render(<DashboardSidebar />);
    await settle();

    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(usageFill()).toHaveStyle({ width: '67%' });
  });

  /**
   * Regression: the loading flag is cleared in `finally`, so a rejected refresh
   * cannot leave the meter stuck on the ellipsis. While loading it shows `...`
   * rather than a stale count presented as current.
   */
  it('shows a loading marker while a refresh is in flight, then the count', async () => {
    let release: (value: ReturnType<typeof usage>) => void = () => {};
    api.listFiles.mockReturnValue(new Promise(resolve => (release = resolve)));
    render(<DashboardSidebar />);
    await settle();

    expect(screen.getByText('...')).toBeInTheDocument();
    expect(usageFill()).toHaveStyle({ width: '0%' });

    release(usage(3));
    await settle();

    expect(screen.queryByText('...')).not.toBeInTheDocument();
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  /** Regression: `Math.min(100, ...)` — an over-quota account gets a full bar, not 233%. */
  it('clamps the meter at a hundred percent', async () => {
    api.listFiles.mockResolvedValue(usage(7));
    render(<DashboardSidebar />);
    await settle();

    expect(screen.getByText('7/3')).toBeInTheDocument();
    expect(usageFill()).toHaveStyle({ width: '100%' });
  });
});

describe('DashboardSidebar — navigation', () => {
  /** Regression: the active item is derived from the pathname, not hard-coded. */
  it('marks the current route active', () => {
    nav.pathname = '/dashboard/folders';
    render(<DashboardSidebar />);

    expect(navLink('Collections')).toHaveClass('bg-[#E4E0D9]');
    expect(navLink('All Files')).not.toHaveClass('bg-[#E4E0D9]');
  });

  /** Regression: the workspace's primary action still navigates. */
  it('routes the new-canvas action to the local editor', () => {
    render(<DashboardSidebar />);

    fireEvent.click(screen.getByRole('button', { name: /new canvas/i }));

    expect(router.push).toHaveBeenCalledWith('/canvas');
  });
});

describe('DashboardSidebar — account card', () => {
  /**
   * Regression: `prevOpen` is seeded from the *initial* `userMenuOpen`. Seeded
   * `true` instead, the mount takes the closing branch and the account links are
   * rendered — collapsed and mid-animation — on a page the user never opened.
   */
  it('renders no account links before the menu is opened', () => {
    render(<DashboardSidebar />);

    expect(screen.queryByRole('link', { name: /^billing$/i })).not.toBeInTheDocument();
  });

  /** Regression: the toggle actually opens the menu. */
  it('opens the account menu with its links', async () => {
    render(<DashboardSidebar />);

    const menu = await openAccountMenu();

    expect(menu).toHaveClass('is-open');
    for (const label of ['Account', 'Billing', 'Plans', 'Notifications']) {
      expect(
        within(menu).getByRole('link', { name: new RegExp(`^${label}$`, 'i') })
      ).toBeInTheDocument();
    }
  });

  /**
   * Regression: the menu stays mounted, marked `is-closing`, for the length of
   * the exit transition. Rendering it only while `userMenuOpen` cuts the
   * animation and makes the dropdown disappear with a jump.
   *
   * The element is re-queried after every state change rather than held: the
   * close latch sets `closing` from an effect, so the dropdown is committed out
   * and then committed back in as a brand-new node. Node identity is therefore
   * not a stable handle here, and asserting on a captured reference would pin
   * the unmount/remount artefact rather than the behaviour.
   */
  it('holds the menu open while it animates closed', async () => {
    render(<DashboardSidebar />);
    await openAccountMenu();

    fireEvent.click(accountToggle());
    await settle();
    expect(accountMenu()).toHaveClass('is-closing');
    expect(within(accountMenu()).getByRole('link', { name: /^billing$/i })).toBeInTheDocument();

    await advance(149);
    expect(within(accountMenu()).getByRole('link', { name: /^billing$/i })).toBeInTheDocument();

    await advance(1);
    expect(queryAccountMenu()).toBeNull();
  });

  /**
   * Regression: the close timer reads `--dropdown-close-dur` rather than a
   * hard-coded duration, so the element survives exactly as long as the CSS
   * transition it is animating. A mismatched constant either truncates a longer
   * transition or strands a hidden overlay over the sidebar.
   *
   * jsdom's `getComputedStyle` does not resolve custom properties at all (it
   * answers `''` for any `--*`), so the variable is supplied through a
   * `getComputedStyle` that resolves it. What is under test is the component's
   * read of the variable, not the stub: hard-coding 150 here fails.
   */
  it('honours the CSS close duration', async () => {
    withDropdownCloseDuration('400ms');

    render(<DashboardSidebar />);
    await openAccountMenu();

    fireEvent.click(accountToggle());
    await settle();

    await advance(399);
    expect(within(accountMenu()).getByRole('link', { name: /^billing$/i })).toBeInTheDocument();

    await advance(1);
    expect(queryAccountMenu()).toBeNull();
  });

  /**
   * Regression: the close latch has to be reusable. `prevOpen` is reset when the
   * close starts, so closing the menu a second time animates again instead of
   * the toggle becoming a one-shot.
   */
  it('animates closed again after being reopened', async () => {
    render(<DashboardSidebar />);
    await openAccountMenu();

    fireEvent.click(accountToggle());
    await advance(150);
    expect(queryAccountMenu()).toBeNull();

    await openAccountMenu();
    fireEvent.click(accountToggle());
    await settle();
    expect(accountMenu()).toHaveClass('is-closing');

    await advance(150);
    expect(queryAccountMenu()).toBeNull();
  });

  /**
   * Regression: logging out clears the session *before* navigating. Pushing
   * first (or not awaiting `logout`) renders the authenticated shell for a beat
   * and, on a slow logout, races the API's cookie teardown against the redirect.
   */
  it('signs out and then routes to the login page', async () => {
    const order: string[] = [];
    auth.logout.mockImplementation(async () => {
      order.push('logout');
    });
    router.push.mockImplementation(() => {
      order.push('push');
    });
    render(<DashboardSidebar />);
    const menu = await openAccountMenu();

    fireEvent.click(within(menu).getByRole('button', { name: /log out/i }));
    await settle();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/login');
    expect(order).toEqual(['logout', 'push']);
  });

  /** Regression: a real avatar renders as an image in both places it appears. */
  it('shows the account image when there is one', () => {
    auth.user = {
      id: 'me',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      image: 'https://x/a.png',
    };
    render(<DashboardSidebar />);

    expect(screen.getAllByRole('img', { name: 'Ada Lovelace' })).toHaveLength(2);
    expect(screen.getByText("Ada Lovelace's Workspace")).toBeInTheDocument();
  });

  /**
   * Regression: an account with a picture but no display name (a Google account
   * that never set one) still has to produce alt text for both avatars —
   * "Workspace" in the header and the email on the account card. Losing these
   * fallbacks makes a screen reader announce the raw image URL twice.
   */
  it('falls back to generated alt text for an image-only account', () => {
    auth.user = { id: 'me', email: 'ada@example.com', name: null, image: 'https://x/a.png' };
    render(<DashboardSidebar />);

    expect(screen.getByAltText('Workspace')).toBeInTheDocument();
    expect(screen.getByAltText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText("Pulkit's Workspace")).toBeInTheDocument();
  });

  /**
   * Regression: without a name the avatar falls back to the workspace icon and
   * the card falls back to the first letter of the email, so a Google account
   * with no display name still renders an identity rather than a blank square.
   */
  it('falls back to the email initial when there is no name or image', () => {
    auth.user = { id: 'me', email: 'ada@example.com', name: null, image: null };
    render(<DashboardSidebar />);

    expect(screen.getByAltText('Workspace icon')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText("Pulkit's Workspace")).toBeInTheDocument();
  });

  /**
   * Regression: with neither a name nor an email there is still a letter, so the
   * avatar slot never renders as an empty box on a half-provisioned account.
   */
  it('falls back to a neutral initial with no name and no email', () => {
    auth.user = { id: 'me', email: '', name: null, image: null };
    render(<DashboardSidebar />);

    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });
});
