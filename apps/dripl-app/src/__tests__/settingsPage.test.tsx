import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * `/settings/[section]` is the only surface where a signed-in user changes their own
 * credentials and identity, and it had **no tests at all** — all 108 of its statements
 * were uncovered.
 *
 * `useAuth` is pinned by `AuthContext.test.tsx`; what is unpinned is everything this
 * page layers on top of it, and the interesting parts are the failure and the
 * refusal paths:
 *
 *   routing  — an unknown section must degrade to something usable, not to an empty
 *              shell, because the section comes from the URL.
 *   dirty    — the save control's enabled state is derived from the input against the
 *              session user. Get that derivation wrong and either the user can save a
 *              no-op forever, or they cannot save at all.
 *   failure  — a refused change must leave what they typed on screen. Wiping it
 *              destroys the only copy of a password they just invented.
 *   sign-out — the one destructive action here ends the session with no undo.
 */

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

import SettingsPage from '@/app/settings/[section]/page';

const ADA: MockUser = { id: 'u1', email: 'ada@dripl.test', name: 'Ada', image: null };

function renderSection(section?: string) {
  params.current = { section };
  return render(<SettingsPage />);
}

/** The aside is the persistent shell; the card is whatever section rendered. */
function sidebar() {
  return document.querySelector('aside');
}

function card(): HTMLElement {
  const main = document.querySelector('main');
  if (!main) throw new Error('settings main region not rendered');
  return main as HTMLElement;
}

/**
 * Anchored on purpose: a nav button's accessible name is its label *plus* its helper
 * line, so an unanchored `/account/i` also matches "Notifications — Email and account".
 */
function navButton(name: string): HTMLElement {
  const bar = sidebar();
  if (!bar) throw new Error('settings sidebar not rendered');
  return within(bar as HTMLElement).getByRole('button', { name: new RegExp(`^${name}`, 'i') });
}

/** The initial shown in place of an avatar, in document order (aside, then card). */
function avatarInitials(): string[] {
  return Array.from(document.querySelectorAll('span.uppercase')).map(el => el.textContent ?? '');
}

function nameField(): HTMLInputElement {
  return screen.getByPlaceholderText('Your name') as HTMLInputElement;
}

function saveButton(): HTMLElement {
  return within(card()).getByRole('button', { name: /^save changes$|^saved$/i });
}

async function settle(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.user = { ...ADA };
  auth.loading = false;
  auth.updateProfile.mockResolvedValue(undefined);
  auth.refreshUser.mockResolvedValue(undefined);
  auth.changePassword.mockResolvedValue(undefined);
  auth.logout.mockResolvedValue(undefined);
  params.current = {};
});

describe('/settings — which section renders', () => {
  /**
   * Regression: the section comes from the URL, so any value can arrive — a stale
   * bookmark, a renamed route, a typo in a link. The `useMemo` falls back to
   * `'profile'`, so the page must render the account card and mark the account nav
   * item active rather than an empty `<main>` the user cannot act on. (The `default`
   * branch of `renderSection` would also catch a bad id, which is why the nav pill is
   * asserted: only the `useMemo` fallback gets the label right.)
   */
  it('falls back to the account card for an unknown section', () => {
    renderSection('nonsense-section');

    expect(within(card()).getByText('What should Dripl call you?')).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(within(card()).getByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  /** Regression: `?next`-style aliases must resolve to the same card as the id. */
  it('treats the billing alias as the plan section', () => {
    renderSection('billing');

    expect(within(card()).getByText('Free plan')).toBeInTheDocument();
    expect(navButton('Billing').className).toContain('bg-[#DCD5C8]');
  });

  /** Regression: same for the notifications alias. */
  it('treats the notifications alias as the account section', () => {
    renderSection('notifications');

    expect(within(card()).getByText(ADA.email)).toBeInTheDocument();
    expect(navButton('Notifications').className).toContain('bg-[#DCD5C8]');
  });

  /**
   * Regression: `isActive` is what tells the user where they are. Derived from the
   * *resolved* section rather than the raw param, so the alias case (`billing`) marks
   * Billing active rather than leaving every item inactive.
   */
  it('marks exactly the resolved section as active in the nav', () => {
    renderSection('font');

    expect(navButton('Font').className).toContain('bg-[#DCD5C8]');
    expect(navButton('Password').className).not.toContain('bg-[#DCD5C8]');
    expect(navButton('Account').className).not.toContain('bg-[#DCD5C8]');
  });

  /**
   * Regression: the `loading` guard. Without it the whole shell — the user's name and
   * email in the sidebar — renders on the first paint before the session check
   * answers, so a signed-out visitor gets a flash of the signed-in settings screen on
   * every hard refresh.
   */
  it('shows a spinner instead of the shell while the session is being checked', () => {
    auth.loading = true;
    const { container } = renderSection('profile');

    expect(container.querySelector('aside')).toBeNull();
    expect(screen.queryByText('Workspace preferences')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  /** Regression: each nav item routes to its own canonical id, not the raw param. */
  it('routes each nav item to its own section', () => {
    renderSection('profile');

    fireEvent.click(navButton('Password'));

    expect(router.push).toHaveBeenCalledWith('/settings/password');
  });

  /** Regression: the escape hatch out of settings must still work. */
  it('goes back to the dashboard', () => {
    renderSection('profile');

    fireEvent.click(navButton('Back to dashboard'));

    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });
});

describe('/settings — profile', () => {
  /**
   * Regression: `disabled={loading || name === (user?.name || '')}` is the only
   * unsaved-changes signal on this page. With the comparison inverted, the control is
   * live on arrival and clicking it sends a no-op write for every visit; with it
   * dropped entirely, a user can fire the same save over and over.
   */
  it('keeps the save control disabled until the name actually changes', () => {
    renderSection('profile');
    expect(saveButton()).toBeDisabled();

    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });
    expect(saveButton()).toBeEnabled();

    fireEvent.change(nameField(), { target: { value: 'Ada' } });
    expect(saveButton()).toBeDisabled();
  });

  /**
   * Regression: `handleSave` sends `name || undefined`. Sending the empty string
   * instead stores `""` as the user's name — which then renders as the "No name set"
   * placeholder but persists as a real value, so clearing the field never actually
   * clears it.
   */
  it('reports a failed profile save instead of silently doing nothing', async () => {
    // Regression: `ProfileSettings.handleSave` had no `catch` at all. A rejected
    // `updateProfile` became an unhandled promise rejection, `success` stayed
    // false, and the card rendered neither an acknowledgement nor a failure — so a
    // user whose save failed could not tell that it had, and because the field
    // keeps what they typed, retrying was the only way to find out.
    //
    // This could not be written before the `catch` existed: vitest fails the run
    // on the unhandled rejection, so the missing message was untestable rather
    // than merely unasserted.
    auth.updateProfile.mockRejectedValue(new Error('Name is too long'));
    renderSection('profile');

    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(saveButton());
    await settle();

    expect(screen.getByText('Name is too long')).toBeInTheDocument();
    // No false acknowledgement.
    expect(saveButton()).toHaveTextContent('Save changes');
    // And the typed value survives, so a retry does not mean retyping.
    expect(nameField()).toHaveValue('Ada Lovelace');
  });

  it('falls back to a readable message when a profile save fails non-Error', async () => {
    // The control for the test above. A rejection that is not an `Error` — a thrown
    // string, or a rejected fetch in a client with no `Error` — must not render as
    // "undefined" or as an empty banner.
    auth.updateProfile.mockRejectedValue('boom');
    renderSection('profile');
    // Save is gated on the dirty state, so type something first —
    // clicking a pristine form never reaches the handler.
    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });

    fireEvent.click(saveButton());
    await settle();

    expect(screen.getByText('Failed to update profile.')).toBeInTheDocument();
  });

  it('clears a previous failure when the next attempt succeeds', async () => {
    // Regression: `setError('')` on entry, matching `PasswordSettings`. Without it
    // the old message sits beside a fresh save, so the user cannot tell which
    // attempt the banner belongs to — and a save that worked still shows the
    // previous failure.
    auth.updateProfile.mockRejectedValueOnce(new Error('Name is too long'));
    renderSection('profile');
    // Save is gated on the dirty state, so type something first —
    // clicking a pristine form never reaches the handler.
    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });

    fireEvent.click(saveButton());
    await settle();
    expect(screen.getByText('Name is too long')).toBeInTheDocument();

    fireEvent.click(saveButton());
    await settle();

    expect(screen.queryByText('Name is too long')).not.toBeInTheDocument();
  });

  it('sends the typed name, and no name at all once the field is emptied', async () => {
    renderSection('profile');

    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(saveButton());
    await settle();
    expect(auth.updateProfile).toHaveBeenLastCalledWith('Ada Lovelace');

    fireEvent.change(nameField(), { target: { value: '' } });
    fireEvent.click(saveButton());
    await settle();

    expect(auth.updateProfile).toHaveBeenLastCalledWith(undefined);
  });

  /**
   * Regression: `refreshUser()` after the update. `updateProfile` writes the user into
   * the context from the update response; re-reading is what guarantees the displayed
   * identity is the server's, and dropping it leaves the header showing a name the
   * server rejected or normalised.
   */
  it('re-reads the session after a save and reports success', async () => {
    renderSection('profile');
    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });

    fireEvent.click(saveButton());
    await settle();

    expect(auth.updateProfile).toHaveBeenCalledWith('Ada Lovelace');
    expect(auth.refreshUser).toHaveBeenCalledTimes(1);
    expect(saveButton()).toHaveTextContent(/saved/i);
  });

  /**
   * Regression: the dirty check compares the input against `user`, so the control only
   * settles back to disabled once the *session* reflects the new name. This is the end
   * of the save loop: without it (or if the success state never re-rendered) the
   * button stays enabled after a successful save and invites a duplicate write. The
   * mock only becomes consistent the way the real provider does — by `updateProfile`
   * replacing the user.
   */
  it('settles back to no-changes once the saved name is reflected in the session', async () => {
    auth.updateProfile.mockImplementation((name?: string) => {
      auth.user = { ...ADA, name: name ?? null };
      return Promise.resolve();
    });
    renderSection('profile');
    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());
    await settle();

    expect(nameField()).toHaveValue('Ada Lovelace');
    expect(saveButton()).toBeDisabled();
  });

  /**
   * Regression: the success state is a timer, not a latch. Without the reset the card
   * still reads "Saved" long after the write, which is a claim about the current state
   * of the account that is no longer true. Driven with fake timers so the assertion is
   * about the reset, not about how long it takes.
   */
  it('drops the saved state so the label does not go stale', async () => {
    vi.useFakeTimers();
    try {
      renderSection('profile');
      fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });
      fireEvent.click(saveButton());
      await settle();
      expect(saveButton()).toHaveTextContent(/saved/i);

      await act(async () => {
        vi.advanceTimersByTime(1_800);
      });

      expect(saveButton()).toHaveTextContent(/save changes/i);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Regression: the avatar falls back to an initial, and only when there is no image.
   * Rendering the initial unconditionally drops the user's Google avatar with no error
   * anywhere; rendering the image for an absent URL puts a broken image on the page.
   */
  it('shows the avatar when the account has one, and an initial when it does not', () => {
    const { unmount } = renderSection('profile');
    expect(screen.queryAllByAltText('Ada')).toHaveLength(0);
    expect(screen.queryByText('From Google account')).not.toBeInTheDocument();
    expect(avatarInitials()).toEqual(['A', 'A']);
    unmount();

    auth.user = { ...ADA, image: '/avatar.png' };
    renderSection('profile');

    // Two avatars — the sidebar and the account card — both from `user.image`. The
    // `src` is matched loosely because the real `next/image` rewrites it into an
    // optimizer URL; what matters is that it points at the account's image.
    expect(screen.getAllByAltText('Ada')).toHaveLength(2);
    expect(screen.getAllByAltText('Ada')[0].getAttribute('src')).toContain('avatar.png');
    expect(screen.getByText('From Google account')).toBeInTheDocument();
    // No initial at all when there is a real image to show.
    expect(avatarInitials()).toEqual([]);
  });

  /**
   * Regression: the initial falls back `name?.[0] || email?.[0] || 'U'`. Rendering a
   * blank box for an account whose Google profile carries no name is the gap the middle
   * term closes; `'U'` covers the signed-out render, where an empty circle is what the
   * user sees above their own settings.
   */
  it('falls back through the email initial to a placeholder with no user at all', () => {
    const nameless = renderSection('profile');
    auth.user = { ...ADA, name: null };
    nameless.rerender(<SettingsPage />);
    expect(avatarInitials()).toEqual(['a', 'a']);

    auth.user = null;
    nameless.rerender(<SettingsPage />);
    expect(avatarInitials()).toEqual(['U', 'U']);
  });

  /**
   * Regression: every identity read is `user?.x`. A signed-out render (`user` null
   * while `loading` is already false — the state right after a session check fails)
   * must show fallbacks, not `undefined` or a crash.
   */
  it('renders signed-out fallbacks rather than undefined', () => {
    auth.user = null;
    renderSection('account');

    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
    expect(screen.getByText('No email connected')).toBeInTheDocument();
    expect(within(card()).getByText('No email available')).toBeInTheDocument();
  });
});

/**
 * Regression: the avatar's `alt` falls back to a fixed label when the account has an
 * image but no name — a Google avatar whose profile carries no display name. Without
 * the fallback the image is announced with an empty alt, i.e. invisible to a screen
 * reader, which is the only way that user is told whose account they are editing. The
 * two fallbacks differ ("Account" in the sidebar, "Profile" on the card) and both are
 * pinned: the bare `user.name` would leave the image unannounced in each.
 */
it('labels the avatar when the account has an image but no name', () => {
  auth.user = { ...ADA, name: null, image: '/avatar.png' };
  renderSection('profile');

  expect(screen.getAllByAltText('Account')).toHaveLength(1);
  expect(screen.getAllByAltText('Profile')).toHaveLength(1);
});

describe('/settings — password', () => {
  function passwordField(placeholder: string): HTMLInputElement {
    return within(card()).getByPlaceholderText(placeholder) as HTMLInputElement;
  }

  function changeButton(): HTMLElement {
    return within(card()).getByRole('button', { name: /^change password$|^changed$/i });
  }

  function fillPasswords(newPassword = 'longenough1', confirm = 'longenough1') {
    fireEvent.change(passwordField('Enter current password'), {
      target: { value: 'hunter2' },
    });
    fireEvent.change(passwordField('Minimum 8 characters'), { target: { value: newPassword } });
    fireEvent.change(passwordField('Confirm password'), { target: { value: confirm } });
  }

  /**
   * Regression: `disabled={loading || !currentPassword || !newPassword ||
   * !confirmPassword}`. Any one of those dropped lets the user submit a blank field,
   * which on the server is either a validation error or — worse — a password change
   * with an empty current password.
   */
  it('keeps the control disabled until all three fields are filled', () => {
    renderSection('password');
    expect(changeButton()).toBeDisabled();

    fireEvent.change(passwordField('Enter current password'), { target: { value: 'hunter2' } });
    fireEvent.change(passwordField('Minimum 8 characters'), { target: { value: 'longenough1' } });
    expect(changeButton()).toBeDisabled();

    fireEvent.change(passwordField('Confirm password'), { target: { value: 'longenough1' } });
    expect(changeButton()).toBeEnabled();
  });

  /**
   * Regression: the 8-character minimum is checked client-side before the request. If
   * it is not, the server rejects it and the user gets whatever message the API
   * produces — and the round trip is spent proving something knowable locally.
   */
  it('refuses a new password under the minimum length without calling the API', async () => {
    renderSection('password');
    fillPasswords('short', 'short');

    fireEvent.click(changeButton());
    await settle();

    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(
      within(card()).getByText('New password must be at least 8 characters.')
    ).toBeInTheDocument();
  });

  /**
   * Regression: the confirmation check is separate from the length check and runs
   * *after* it. Merging them into one "passwords do not match" message (or checking
   * match first) changes which error the user is shown for a 3-character mismatch.
   */
  it('refuses mismatched passwords without calling the API', async () => {
    renderSection('password');
    fillPasswords('longenough1', 'longenough2');

    fireEvent.click(changeButton());
    await settle();

    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(within(card()).getByText('Passwords do not match.')).toBeInTheDocument();
  });

  /**
   * Regression: the clear-on-success calls sit inside the `try` after the `await`, and
   * the `catch` writes an error instead. Moving the three resets above the request (an
   * "optimistic" clear) destroys a password the user has just typed and the server has
   * refused — they would have to invent it again, and the second attempt would be
   * against a different string than the one they meant.
   */
  it('keeps every field on screen when the server refuses the change', async () => {
    auth.changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    renderSection('password');
    fillPasswords();

    fireEvent.click(changeButton());
    await settle();

    expect(within(card()).getByText('Current password is incorrect')).toBeInTheDocument();
    expect(passwordField('Enter current password')).toHaveValue('hunter2');
    expect(passwordField('Minimum 8 characters')).toHaveValue('longenough1');
    expect(passwordField('Confirm password')).toHaveValue('longenough1');
    // And the control is usable again, so the correction can be made.
    expect(changeButton()).toBeEnabled();
  });

  /** The control for the test above: the latch is released after a refusal. */
  it('allows a retry after a refused change', async () => {
    auth.changePassword.mockRejectedValueOnce(new Error('Current password is incorrect'));
    renderSection('password');
    fillPasswords();

    fireEvent.click(changeButton());
    await settle();
    expect(within(card()).getByText('Current password is incorrect')).toBeInTheDocument();

    fireEvent.change(passwordField('Enter current password'), { target: { value: 'correct' } });
    fireEvent.click(changeButton());
    await settle();

    expect(auth.changePassword).toHaveBeenCalledTimes(2);
    expect(auth.changePassword).toHaveBeenLastCalledWith('correct', 'longenough1');
    expect(within(card()).getByText('Password changed successfully.')).toBeInTheDocument();
  });

  /**
   * Regression: on success the fields are emptied and the new password stops being
   * readable in the DOM. Skipping the resets leaves a live password sitting in a
   * `type="password"` field on a page the user may walk away from, and a shared screen
   * can reveal it.
   */
  it('clears the fields and reports success once the change is accepted', async () => {
    renderSection('password');
    fillPasswords();

    fireEvent.click(changeButton());
    await settle();

    expect(auth.changePassword).toHaveBeenCalledWith('hunter2', 'longenough1');
    expect(within(card()).getByText('Password changed successfully.')).toBeInTheDocument();
    expect(passwordField('Enter current password')).toHaveValue('');
    expect(passwordField('Minimum 8 characters')).toHaveValue('');
    expect(passwordField('Confirm password')).toHaveValue('');
    expect(changeButton()).toHaveTextContent(/changed/i);
  });

  /**
   * Regression: `setTimeout(() => setSuccess(false), 1800)` clears the success state.
   * Without it the card claims "Password changed successfully" indefinitely, and the
   * control reads `Changed` rather than offering the next change. Driven with fake
   * timers so the assertion is about the reset, not about how long it takes.
   */
  it('drops the success state so the control is not latched as done', async () => {
    vi.useFakeTimers();
    try {
      renderSection('password');
      fillPasswords();
      fireEvent.click(changeButton());
      await settle();
      expect(within(card()).getByText('Password changed successfully.')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(1_800);
      });

      expect(within(card()).queryByText('Password changed successfully.')).not.toBeInTheDocument();
      expect(changeButton()).toHaveTextContent(/change password/i);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to change password.'`. A
   * bare rejection (a thrown string, an exotic `fetch` failure) has no `.message`, so
   * without the guard the card renders an empty red line and the user is told nothing.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    auth.changePassword.mockRejectedValue('nope');
    renderSection('password');
    fillPasswords();

    fireEvent.click(changeButton());
    await settle();

    expect(within(card()).getByText('Failed to change password.')).toBeInTheDocument();
  });
});

describe('/settings — font preferences', () => {
  function fontOption(name: string): HTMLElement {
    return within(card()).getByRole('button', { name: new RegExp(name, 'i') });
  }

  /**
   * Regression: the initial value is read from `localStorage['dripl_canvas_font']`, the
   * key the canvas itself reads. Reading a different key (or defaulting unconditionally)
   * shows the wrong font as selected, so a user who set Georgia sees the card offering
   * Handwritten as their current choice.
   */
  it('starts from the font the canvas is already using', () => {
    localStorage.setItem('dripl_canvas_font', 'mono');
    renderSection('font');

    expect(fontOption('Monospace').className).toContain('border-[#0E6655]');
    expect(fontOption('Caveat').className).not.toContain('border-[#0E6655]');
  });

  /** Regression: with nothing stored the default is the handwritten face, not blank. */
  it('defaults to the handwritten font when nothing is stored', () => {
    renderSection('font');

    expect(fontOption('Caveat').className).toContain('border-[#0E6655]');
  });

  /**
   * Regression: the save writes to `dripl_canvas_font` — the key the canvas reads. A
   * different key (or a renamed one) makes this card claim success while every canvas
   * keeps the old font, and the user has no other way to set it.
   */
  it('writes the chosen font to the key the canvas reads', async () => {
    renderSection('font');
    fireEvent.click(fontOption('Georgia'));

    fireEvent.click(within(card()).getByRole('button', { name: /save preferences/i }));
    await settle();

    expect(localStorage.getItem('dripl_canvas_font')).toBe('serif');
    expect(
      within(card()).getByRole('button', { name: /saved|save preferences/i })
    ).toHaveTextContent(/saved/i);
  });

  /**
   * Regression: selecting a font must not write it. Persisting on selection would make
   * the Save control a lie and would apply a choice the user never confirmed — the one
   * control on this page where an immediate write is hard to undo.
   */
  it('does not write anything until the choice is saved', () => {
    localStorage.setItem('dripl_canvas_font', 'mono');
    renderSection('font');

    fireEvent.click(fontOption('Georgia'));

    expect(localStorage.getItem('dripl_canvas_font')).toBe('mono');
  });

  /** Regression: as on the other cards, "Saved" is a timer and not a latch. */
  it('drops the saved state so the label does not go stale', async () => {
    vi.useFakeTimers();
    try {
      renderSection('font');
      fireEvent.click(within(card()).getByRole('button', { name: /save preferences/i }));
      await settle();
      expect(within(card()).getByRole('button', { name: /saved/i })).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(1_800);
      });

      expect(within(card()).getByRole('button', { name: /save preferences/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('/settings — signing out', () => {
  function sidebarLogout(): HTMLElement {
    const bar = sidebar();
    if (!bar) throw new Error('settings sidebar not rendered');
    return within(bar as HTMLElement).getByRole('button', { name: /log out/i });
  }

  /**
   * Regression: `await logout()` must complete before `router.push('/login')`. Pushing
   * first races the session teardown, and the login page can render while the cookie
   * is still live — a signed-in user bounced back to `/login`, who then signs in again
   * and creates a second session.
   */
  it('signs out and then returns to the login page', async () => {
    renderSection('account');
    const order: string[] = [];
    auth.logout.mockImplementation(async () => {
      order.push('logout');
    });
    router.push.mockImplementation(() => {
      order.push('push');
    });

    fireEvent.click(within(card()).getByRole('button', { name: /log out/i }));
    await settle();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['logout', 'push']);
    expect(router.push).toHaveBeenCalledWith('/login');
  });

  /**
   * Regression: the sidebar has its own copy of the same handler. Deleting it (or
   * wiring it to a different route) leaves the persistent control on every section
   * dead, while the copy inside the Notifications card keeps working — so the failure
   * only shows on four of the five sections.
   */
  it('signs out from the sidebar control as well', async () => {
    renderSection('profile');

    fireEvent.click(sidebarLogout());
    await settle();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/login');
  });

  /**
   * LABELLED — known gap, pinned as it behaves today. Sign-out is the only destructive
   * action on this page and it fires on a single click: no confirmation dialog, and
   * `window.confirm` is never consulted. There is no "delete account" and no "revoke
   * sessions" control here at all — `AuthContext` has neither. So the destructive
   * actions a settings page is expected to guard are simply absent, and the one that
   * does exist is unguarded. Pinned so that adding a confirmation step fails here and
   * gets a decision.
   */
  it('LABELLED signs out on a single click, with no confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderSection('account');

      fireEvent.click(within(card()).getByRole('button', { name: /log out/i }));
      await settle();

      expect(confirm).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(auth.logout).toHaveBeenCalledTimes(1);
    } finally {
      confirm.mockRestore();
    }
  });
});

describe('/settings — leaving with unsaved changes', () => {
  /**
   * LABELLED — the source does *not* guard this, pinned as it behaves today. There is
   * no `beforeunload` handler and no dirty check on the nav buttons, so clicking a
   * section with an unsaved name navigates and the edit is silently gone. The
   * valuable half is the second assertion: navigation must not silently *save* either,
   * because an implicit write on a nav click would change the user's name without them
   * pressing Save. A guard here needs a source change (reported, not made).
   */
  it('LABELLED discards an unsaved name on navigation without warning or saving', () => {
    renderSection('profile');
    fireEvent.change(nameField(), { target: { value: 'Ada Lovelace' } });

    fireEvent.click(navButton('Font'));

    expect(router.push).toHaveBeenCalledWith('/settings/font');
    expect(auth.updateProfile).not.toHaveBeenCalled();
    expect(nameField()).toHaveValue('Ada Lovelace');
  });
});
