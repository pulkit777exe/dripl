import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CookieConsent from '@/components/CookieConsent';

/**
 * The consent *preferences* surface.
 *
 * The banner itself is covered elsewhere; what is untested here is the modal
 * behind "Manage preferences" — the toggles, the save/dismiss split, and the
 * one thing that decides whether consent was actually given:
 * `accepted: preferences.analytics || preferences.marketing`. Necessary-only
 * consent is deliberately *not* recorded as accepted, and that asymmetry is
 * the reason this file exists.
 *
 * The modal mounts through `useModalAnimation` (opening -> rAF -> open), so
 * every interaction waits past the animation rather than asserting on a frame
 * the portal has not produced yet.
 */

const STORED_KEY = 'dripl-cookie-consent';

/** Long enough for opening (one rAF) and closing (a 150ms CSS-duration timer). */
const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
  });

const stored = (value: unknown) => window.localStorage.setItem(STORED_KEY, JSON.stringify(value));

/** Mount with no stored consent, so the banner — and its preferences link — is up. */
async function renderBanner() {
  window.localStorage.clear();
  await act(async () => {
    render(<CookieConsent />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  screen.getByText('Accept All');
}

/** Open the preferences modal and wait for its entry animation. */
async function openPreferences() {
  fireEvent.click(screen.getByText('Manage preferences'));
  await settle();
}

/** The serialized consent the component wrote, or undefined if it wrote none. */
const written = (spy: ReturnType<typeof vi.spyOn<Storage, 'setItem'>>) =>
  spy.mock.calls.find(([key]) => key === STORED_KEY)?.[1];

/** The toggle switch in the row whose label is `name`. */
const toggleFor = (name: string) => {
  const row = screen.getByText(name).closest('div.flex.items-center.justify-between');
  if (!row) throw new Error(`no preference row for "${name}"`);
  return within(row as HTMLElement).getByRole('button');
};

/** On/off as the switch renders it: the knob sits right when the flag is true. */
const isOn = (toggle: HTMLElement) =>
  toggle.querySelector('span')?.getAttribute('style')?.includes('translateX(18px)');

const closeButton = () => {
  const heading = screen.getByText('Cookie Preferences');
  const header = heading.parentElement?.parentElement;
  if (!header) throw new Error('no modal header');
  return within(header).getByRole('button');
};

describe('CookieConsent preferences', () => {
  let setItem: ReturnType<typeof vi.spyOn<Storage, 'setItem'>>;

  beforeEach(() => {
    window.localStorage.clear();
    setItem = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('starts every optional category off, with necessary forced on', async () => {
    await renderBanner();
    await openPreferences();

    expect(isOn(toggleFor('Necessary'))).toBe(true);
    expect(isOn(toggleFor('Analytics'))).toBe(false);
    expect(isOn(toggleFor('Marketing'))).toBe(false);
    // Nothing has been agreed to yet, so nothing has been written.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('restores stored preferences instead of the defaults', async () => {
    // Exercises the stored-preferences branch of the mount effect. Note what
    // is *not* asserted: a stored consent also means the banner never renders,
    // and the banner holds the only control that opens the preferences modal.
    // So the restored `preferences` state has no reachable surface to show up
    // on, and the strongest true statement here is that mounting is safe and
    // re-asks nothing.
    stored({
      accepted: true,
      timestamp: 1,
      preferences: { necessary: true, analytics: true, marketing: false },
    });
    await act(async () => {
      render(<CookieConsent />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
    expect(screen.queryByText('Cookie Preferences')).not.toBeInTheDocument();
    // Reading the stored blob must not rewrite it. The seed write above is
    // discounted first, so only the component's own writes remain.
    setItem.mockClear();
    await act(async () => {
      render(<CookieConsent />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(written(setItem)).toBeUndefined();
  });

  it('toggles an optional category and leaves the other one alone', async () => {
    await renderBanner();
    await openPreferences();

    fireEvent.click(toggleFor('Analytics'));
    // Marketing is untouched by an analytics click — the toggles are independent.
    expect(isOn(toggleFor('Analytics'))).toBe(true);
    expect(isOn(toggleFor('Marketing'))).toBe(false);

    fireEvent.click(toggleFor('Analytics'));
    expect(isOn(toggleFor('Analytics'))).toBe(false);
  });

  it('refuses to toggle the necessary category, and still saves the rest', async () => {
    await renderBanner();
    await openPreferences();

    // Necessary is rendered disabled, so the click cannot reach the handler at
    // all. Asserted as "the switch did not move" — the button's disabled
    // attribute is the guard a user can actually see.
    const necessary = toggleFor('Necessary');
    expect(necessary).toBeDisabled();
    fireEvent.click(necessary);
    expect(isOn(necessary)).toBe(true);

    fireEvent.click(toggleFor('Marketing'));
    fireEvent.click(screen.getByText('Save Preferences'));
    await settle();

    const raw = written(setItem);
    expect(raw).toBeDefined();
    const saved = JSON.parse(raw as string) as { preferences: Record<string, boolean> };
    expect(saved.preferences).toEqual({ necessary: true, analytics: false, marketing: true });
    expect(screen.queryByText('Cookie Preferences')).not.toBeInTheDocument();
  });

  it('records accepted only when analytics or marketing is on', async () => {
    // Three inputs, three answers, asserted as a table because the saved
    // `accepted` flag is the entire legal record of what the user agreed to.
    const rows: Array<[Record<string, boolean>, boolean]> = [
      [{ analytics: true, marketing: false }, true],
      [{ analytics: false, marketing: true }, true],
      [{ analytics: false, marketing: false }, false],
    ];

    for (const [prefs, accepted] of rows) {
      window.localStorage.clear();
      setItem.mockClear();
      await renderBanner();
      await openPreferences();
      for (const name of ['Analytics', 'Marketing'] as const) {
        if (prefs[name.toLowerCase() as 'analytics' | 'marketing']) {
          fireEvent.click(toggleFor(name));
        }
      }
      fireEvent.click(screen.getByText('Save Preferences'));
      await settle();

      const raw = written(setItem);
      expect(raw).toBeDefined();
      const saved = JSON.parse(raw as string) as { accepted: boolean };
      expect(saved.accepted).toBe(accepted);
    }
  });

  it('closes on the header X without recording anything', async () => {
    await renderBanner();
    await openPreferences();

    fireEvent.click(closeButton());
    await settle();

    expect(screen.queryByText('Cookie Preferences')).not.toBeInTheDocument();
    // Closing is not consenting: nothing was written.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('closes on Cancel without recording anything', async () => {
    await renderBanner();
    await openPreferences();
    fireEvent.click(toggleFor('Analytics'));

    fireEvent.click(screen.getByText('Cancel'));
    await settle();

    expect(screen.queryByText('Cookie Preferences')).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('stays open when the panel itself is clicked', async () => {
    await renderBanner();
    await openPreferences();

    // The overlay's own onClick closes the modal; the panel's stops propagation
    // so that a click inside the form (a stray text selection, say) does not.
    const panel = screen.getByText(/Manage your cookie preferences/).parentElement as HTMLElement;
    fireEvent.click(panel);
    await settle();

    expect(screen.queryByText('Cookie Preferences')).toBeInTheDocument();
  });

  it('dismisses the banner with its own close button, recording nothing', async () => {
    await renderBanner();

    fireEvent.click(screen.getByLabelText('Dismiss cookie notice'));
    await settle();

    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
    // Dismissal is not consent, so the notice must come back next visit.
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORED_KEY)).toBeNull();
  });

  it('accept-all records every category on and closes the banner', async () => {
    await renderBanner();

    fireEvent.click(screen.getByText('Accept All'));
    await settle();

    const raw = written(setItem);
    expect(raw).toBeDefined();
    const saved = JSON.parse(raw as string) as {
      accepted: boolean;
      preferences: Record<string, boolean>;
    };
    expect(saved.accepted).toBe(true);
    expect(saved.preferences).toEqual({ necessary: true, analytics: true, marketing: true });
    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
  });

  it('closes the banner as well as the modal after saving', async () => {
    await renderBanner();
    await openPreferences();
    expect(screen.queryByText('Cookie Notice')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save Preferences'));
    await settle();

    // Both surfaces go: leaving the banner up behind a saved decision would
    // re-prompt a user who just answered.
    expect(screen.queryByText('Cookie Preferences')).not.toBeInTheDocument();
    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
  });
});
