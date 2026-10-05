import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Withdrawing cookie consent.
 *
 * The banner is the only control that opens the preferences modal, and the banner
 * is suppressed the moment a consent record exists in localStorage. So the two
 * facts combine into a trap: the modal is reachable *only* for a user who has not
 * yet consented, which is exactly the user who has nothing to withdraw. Consent
 * looked withdrawable on the consent screen and was not withdrawable anywhere.
 *
 * `/settings/cookies` is the fix: an existing settings surface that opens the same
 * modal through a window event, so there is one modal and two doors into it. The
 * tests below render both halves in one document, because the claim being pinned is
 * the *join* between them — a listener and a dispatcher can each look right alone
 * while the path between them stays broken.
 *
 * The withdrawal assertions read `accepted`, not just `preferences`. `accepted` is
 * what `utils/analytics.ts` gates every event on, so it is the difference between
 * a preference that changed and consent that was actually given up.
 */

const OPEN_PREFERENCES_EVENT = 'dripl:open-cookie-preferences';
const STORED_KEY = 'dripl-cookie-consent';

type StoredConsent = {
  accepted: boolean;
  timestamp: number;
  preferences: { necessary: boolean; analytics: boolean; marketing: boolean };
};

type MockUser = { id: string; email: string; name: string | null; image: string | null };

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const auth = vi.hoisted(() => ({
  user: null as MockUser | null,
  loading: false,
  updateProfile: vi.fn(),
  refreshUser: vi.fn(),
  changePassword: vi.fn(),
  logout: vi.fn(),
}));
const params = vi.hoisted(() => ({ current: {} as { section?: string } }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params.current,
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => auth }));

import CookieConsent from '@/components/CookieConsent';
import SettingsPage from '@/app/settings/[section]/page';
import { getAnalyticsConsent } from '@/utils/analytics';

const ADA: MockUser = { id: 'u1', email: 'ada@dripl.test', name: 'Ada', image: null };

/** The consent record an already-consented visitor arrives with: everything on. */
const ALL_ON: StoredConsent = {
  accepted: true,
  timestamp: 1,
  preferences: { necessary: true, analytics: true, marketing: true },
};

const seed = (value: StoredConsent) =>
  window.localStorage.setItem(STORED_KEY, JSON.stringify(value));

const read = (): StoredConsent | null => {
  const raw = window.localStorage.getItem(STORED_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredConsent);
};

/** Long enough for the modal's entry rAF and its 150ms close timer. */
const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
  });

async function mountBoth() {
  await act(async () => {
    render(<CookieConsent />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  params.current = { section: 'cookies' };
  render(<SettingsPage />);
}

/** The aside is the persistent shell; the card is whatever section rendered. */
function settingsCard(): HTMLElement {
  const main = document.querySelector('main');
  if (!main) throw new Error('settings main region not rendered');
  return main as HTMLElement;
}

/** A nav button's accessible name is its label plus its helper line, so anchored. */
function navButton(name: string): HTMLElement {
  const aside = document.querySelector('aside');
  if (!aside) throw new Error('settings sidebar not rendered');
  return within(aside as HTMLElement).getByRole('button', { name: new RegExp(`^${name}`, 'i') });
}

/** The toggle switch in the preference row labelled `name`. */
function toggleFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('div.flex.items-center.justify-between');
  if (!row) throw new Error(`no preference row for "${name}"`);
  return within(row as HTMLElement).getByRole('button');
}

const isOn = (toggle: HTMLElement): boolean =>
  toggle.querySelector('span')?.getAttribute('style')?.includes('translateX(18px)') === true;

const modalOpen = () => screen.queryByText('Cookie Preferences') !== null;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  auth.user = { ...ADA };
  auth.loading = false;
  auth.logout.mockResolvedValue(undefined);
  params.current = {};
});

afterEach(() => {
  window.localStorage.clear();
});

describe('withdrawing cookie consent', () => {
  /**
   * The regression, end to end. An already-consented visitor has no banner, so the
   * only question is whether anything else can reach the modal — before this, the
   * honest answer was no, and the only withdrawal route was clearing site data.
   */
  it('opens the preferences modal from /settings/cookies with no banner in sight', async () => {
    seed(ALL_ON);
    await mountBoth();

    // Precondition, and the reason this is a gap rather than a convenience: the
    // banner — the other and previously only door — is not on screen.
    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
    expect(modalOpen()).toBe(false);

    fireEvent.click(within(settingsCard()).getByRole('button', { name: 'Cookie settings' }));
    await settle();

    // Positive control: the modal is real, mounted, and showing the *stored*
    // choices — not merely present because something rendered unconditionally.
    expect(modalOpen()).toBe(true);
    expect(isOn(toggleFor('Analytics'))).toBe(true);
    expect(isOn(toggleFor('Marketing'))).toBe(true);
    expect(isOn(toggleFor('Necessary'))).toBe(true);
  });

  /**
   * And the withdrawal has to mean something. Turning both optional categories off
   * writes `accepted: false`, which is the flag `utils/analytics.ts` gates every
   * event on — so this asserts the product-level effect, not merely that two
   * booleans were flipped in a JSON blob nobody reads back.
   */
  it('records withdrawn consent so analytics stops being enabled', async () => {
    seed(ALL_ON);
    await mountBoth();
    expect(getAnalyticsConsent()).toBe(true);

    fireEvent.click(within(settingsCard()).getByRole('button', { name: 'Cookie settings' }));
    await settle();

    fireEvent.click(toggleFor('Analytics'));
    fireEvent.click(toggleFor('Marketing'));
    fireEvent.click(screen.getByText('Save Preferences'));
    await settle();

    const saved = read();
    expect(saved).not.toBeNull();
    expect(saved?.accepted).toBe(false);
    expect(saved?.preferences).toEqual({ necessary: true, analytics: false, marketing: false });
    expect(getAnalyticsConsent()).toBe(false);
    expect(modalOpen()).toBe(false);
  });

  /**
   * The listener has to be the cause, not a coincidence. With the event undispatched
   * the modal stays shut *and* the banner stays absent, which is the trap in one
   * assertion pair: pre-fix this state had no way out at all.
   */
  it('keeps the modal shut until the settings surface asks for it', async () => {
    seed(ALL_ON);
    await mountBoth();

    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
    expect(modalOpen()).toBe(false);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_EVENT));
      await new Promise(resolve => setTimeout(resolve, 250));
    });

    expect(modalOpen()).toBe(true);
  });

  /**
   * The event is the seam, so it is a public contract: a named export of the modal's
   * name keeps the settings page and the banner honest about each other.
   */
  it('exposes the opening as a named window event rather than a shared module', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    params.current = { section: 'cookies' };
    render(<SettingsPage />);

    fireEvent.click(within(settingsCard()).getByRole('button', { name: 'Cookie settings' }));

    expect(dispatch).toHaveBeenCalled();
    const event = dispatch.mock.calls.map(([e]) => e).find(e => e.type === OPEN_PREFERENCES_EVENT);
    expect(event).toBeDefined();
  });

  /**
   * Without the cleanup, `CookieConsent` lives in the root layout for the life of the
   * document and a remount would leave a second listener subscribed — each dispatch
   * toggling the same state twice.
   */
  it('unsubscribes the listener when it unmounts', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<CookieConsent />);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    view.unmount();

    expect(remove.mock.calls.map(([type]) => type)).toContain(OPEN_PREFERENCES_EVENT);
  });
});

describe('/settings — the cookies surface', () => {
  /**
   * The control has to be findable, not merely present. A section that renders at
   * `/settings/cookies` but is absent from the nav is reachable only by typing the
   * URL, which reintroduces the original gap at one remove of the keyboard.
   */
  it('lists cookies in the settings nav and routes to it', () => {
    params.current = { section: 'profile' };
    render(<SettingsPage />);

    fireEvent.click(navButton('Cookies'));

    expect(router.push).toHaveBeenCalledWith('/settings/cookies');
  });

  /** The section has to be marked active where the user is, like every other item. */
  it('marks cookies active when that section is open', () => {
    params.current = { section: 'cookies' };
    render(<SettingsPage />);

    expect(navButton('Cookies').className).toContain('bg-[#DCD5C8]');
    expect(navButton('Password').className).not.toContain('bg-[#DCD5C8]');
  });

  /** Regression: the section comes from the URL, so a plausible alias must resolve. */
  it('treats the privacy alias as the cookies section', () => {
    params.current = { section: 'privacy' };
    render(<SettingsPage />);

    expect(
      within(settingsCard()).getByRole('button', { name: 'Cookie settings' })
    ).toBeInTheDocument();
    expect(navButton('Cookies').className).toContain('bg-[#DCD5C8]');
  });
});
