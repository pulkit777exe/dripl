import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * `app/reset-password/page.tsx` is where a person who has just clicked a link from
 * their inbox ends up, and it had **no tests at all** — 24 of its 25 statements were
 * uncovered. `useAuth` itself is pinned by `AuthContext.test.tsx`, so what is under
 * test here is this page's own logic, and it has three that can each fail alone:
 *
 *   gate     — `?token=` is the only credential this page has, and without it the
 *              form must not render at all. Rendering a reset form with no token
 *              produces a submit that can only ever fail server-side, and it invites
 *              the user to type a new password first.
 *   redirect — success arms a **2.5s `setTimeout` that is never cleared**. See the
 *              LABELLED test below; that is a real defect, pinned as it behaves.
 *   failure  — the token is single-use, so a rejected reset means the user's link is
 *              spent. Whether they can find that out and try again is this page's
 *              job, and `/login`/`/signup` already carry that pattern.
 *
 * `window.location.search` is the source of `?token=`, so these tests drive the URL
 * with `history.replaceState` rather than mocking a hook — the same approach
 * `loginPage.test.tsx` uses for `?next=`.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
const resetPassword = vi.hoisted(() => vi.fn<(token: string, password: string) => Promise<void>>());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ resetPassword }) }));

import ResetPasswordPage from '@/app/reset-password/page';

const TOKEN = 'reset-token-abc';
const PASSWORD = 'correct-horse-battery-staple';

function visit(search = '') {
  window.history.replaceState({}, '', `/reset-password${search}`);
}

/**
 * The visible "New password" label is not associated with its input: no `htmlFor`,
 * no `id` on the input, and the label does not wrap it. The field therefore has no
 * accessible name and `getByLabelText` cannot reach it. `/login` does associate its
 * labels (`htmlFor` + matching `id`). Queried by type instead; the missing
 * association is reported, not fixed.
 */
function passwordField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (field === null) throw new Error('the reset form did not render a password input');
  return field;
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: /reset password|resetting/i });
}

/** Matches either the idle or the in-flight label, so it works in both states. */
function resetButton(): HTMLElement {
  return submitButton();
}

function form(): HTMLFormElement {
  const found = passwordField().closest('form');
  if (found === null) throw new Error('the reset form did not render a <form>');
  return found;
}

async function submitForm() {
  fireEvent.click(resetButton());
  await settle();
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/** A reset promise that stays pending until the returned release is called. */
function pendingReset(): { release: () => void } {
  const handle = { release: () => {} };
  resetPassword.mockReturnValueOnce(
    new Promise<void>(resolve => {
      handle.release = () => resolve();
    })
  );
  return handle;
}

function typePassword(value = PASSWORD) {
  fireEvent.change(passwordField(), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPassword.mockResolvedValue(undefined);
  visit(`?token=${TOKEN}`);
});

afterEach(() => {
  // A success arms a 2.5s timer. Any test that reached success and did not advance
  // it leaves it pending, and RTL's automatic cleanup unmounts the component without
  // cancelling it — the timer would then fire mid-way through a *later* test and
  // push into an assertion that expects no navigation.
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('/reset-password — arriving without a token', () => {
  /**
   * Regression: the whole point of the `if (!token)` gate. `?token=` is the only
   * credential this page has; with it absent the form must not exist, because a
   * submit from it can only ever be refused, and the user types a new password
   * before finding out.
   */
  it('refuses to render a form when the URL carries no token', () => {
    visit('');

    render(<ResetPasswordPage />);

    expect(screen.getByText('Invalid or missing reset token.')).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument();
  });

  /**
   * Regression: an expired link is the *expected* way to land here, so the refusal
   * has to carry a way forward. This link is the only navigation off the page for
   * someone whose token is gone.
   */
  it('offers a way to request a fresh link', () => {
    visit('');

    render(<ResetPasswordPage />);

    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
  });

  /** Regression: a refused arrival must not reach the reset API at all. */
  it('makes no reset request for a refused arrival', async () => {
    visit('');
    render(<ResetPasswordPage />);

    await settle();

    expect(resetPassword).not.toHaveBeenCalled();
  });

  /**
   * The control for the three above, and the thing that makes them non-vacuous: the
   * same render with a token present produces the form. Inverting the gate
   * (`if (token)`) fails every one of them and passes this.
   */
  it('renders the form when the URL does carry a token', () => {
    render(<ResetPasswordPage />);

    expect(screen.queryByText('Invalid or missing reset token.')).not.toBeInTheDocument();
    expect(passwordField()).toBeInTheDocument();
    expect(resetButton()).toHaveAttribute('type', 'submit');
  });
});

describe('/reset-password — a successful reset', () => {
  /**
   * Regression: two state values and two URL/read sources feed one call. Reading the
   * token from state (there is none) or taking the password from the DOM at submit
   * time instead of from `password` sends a pair the server cannot match, and the
   * failure is an expired-link message for a link that is still live.
   */
  it('sends exactly the URL token and the typed password', async () => {
    render(<ResetPasswordPage />);
    typePassword();

    await submitForm();

    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(resetPassword).toHaveBeenCalledWith(TOKEN, PASSWORD);
  });

  /**
   * Regression: `?token=` is percent-encoded in a real email link, and
   * `URLSearchParams.get` decodes it. A hand-rolled `search.slice('?token=')`
   * would hand the API the still-encoded form and every reset would fail as an
   * unknown token — a failure that looks exactly like an expired link.
   */
  it('decodes a percent-encoded token before sending it', async () => {
    visit(`?token=${encodeURIComponent('a+b/c=d&e')}`);

    render(<ResetPasswordPage />);
    typePassword();
    await submitForm();

    expect(resetPassword).toHaveBeenCalledWith('a+b/c=d&e', PASSWORD);
  });

  /**
   * Regression: the form is replaced by a confirmation, not merely annotated. Leaving
   * the password field on screen after the reset succeeded keeps a live credential
   * visible on a shared screen.
   */
  it('replaces the form with a confirmation and takes the password field away', async () => {
    render(<ResetPasswordPage />);
    typePassword();

    await submitForm();

    expect(screen.getByText(/Password reset successful/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  /**
   * Regression: `setTimeout(() => router.push('/login'), 2500)`. The user is left
   * looking at a password they can no longer see, so the redirect is right; the
   * exact delay is asserted because it is a visible promise the page makes — 0ms
   * would yank the confirmation away before it can be read.
   */
  it('redirects to /login exactly 2.5 seconds after the success', async () => {
    vi.useFakeTimers();
    try {
      render(<ResetPasswordPage />);
      typePassword();
      await submitForm();

      expect(screen.getByText(/Password reset successful/i)).toBeInTheDocument();
      expect(router.push).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2499);
      });
      expect(router.push).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith('/login');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  /**
   * LABELLED — known defect, pinned as it behaves today, not as it should.
   *
   * The 2.5s `setTimeout` has no cleanup, so it survives unmount. A user who reads
   * the confirmation, clicks "Back to login" (or any link) and moves on is still
   * dragged to `/login` 2.5 seconds later — navigating someone away from wherever
   * they actually went. Reported, not fixed: the fix needs an effect cleanup and a
   * ref, and adding one turns this test red, which is the point.
   */
  it('still pushes to /login after the success screen has been unmounted', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<ResetPasswordPage />);
      typePassword();
      await submitForm();
      expect(screen.getByText(/Password reset successful/i)).toBeInTheDocument();

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect(router.push).toHaveBeenCalledWith('/login');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('/reset-password — a refused reset', () => {
  /**
   * Regression: the whole point of the `catch`. The realistic rejection here is a
   * spent link, so the server's own words have to reach the screen rather than a
   * generic apology.
   */
  it('shows the message the server refused with', async () => {
    resetPassword.mockRejectedValue(new Error('Reset token is invalid or has expired'));
    render(<ResetPasswordPage />);
    typePassword();

    await submitForm();

    const banner = screen.getByText('Reset token is invalid or has expired');
    expect(banner).toBeInTheDocument();
    // The styling hook `forgot-password` uses too, so both request forms read alike.
    expect(banner.closest('.t-error-msg')).not.toBeNull();
  });

  /**
   * Regression: `status` returns to a value that is neither `loading` nor `success`,
   * so the button's `disabled={status === 'loading' || !password}` clears. A handler
   * that left `status: 'error'` wired to `disabled`, or that consumed the password,
   * would leave the user with no way to react at all.
   */
  it('leaves the control usable so the refusal can be acted on', async () => {
    resetPassword.mockRejectedValueOnce(new Error('Reset token is invalid or has expired'));
    render(<ResetPasswordPage />);
    typePassword();
    await submitForm();
    expect(resetButton()).toBeEnabled();
    expect(screen.getByText('Reset token is invalid or has expired')).toBeInTheDocument();

    await submitForm();

    expect(resetPassword).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to reset password.'`.
   * A bare rejection (a thrown string, an exotic `fetch` failure) has no `.message`,
   * so without the guard the banner renders as an empty red box and the user is told
   * nothing about why their reset failed.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    resetPassword.mockRejectedValue('kaboom');
    render(<ResetPasswordPage />);
    typePassword();

    await submitForm();

    expect(screen.getByText('Failed to reset password.')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  /**
   * Regression: a failed reset must not navigate. There is no `router` call in the
   * `catch`, and asserting it is what distinguishes "refused" from "succeeded and
   * moved on" — the confirmation and the redirect are the success path's only
   * signals, so a redirect on failure would be indistinguishable from success.
   */
  it('does not navigate on a refusal', async () => {
    resetPassword.mockRejectedValue(new Error('Reset token is invalid or has expired'));
    render(<ResetPasswordPage />);
    typePassword();

    await submitForm();

    expect(router.push).not.toHaveBeenCalled();
  });

  /**
   * Regression: nothing clears `password` on failure, so the page never asks the
   * user to retype a secret they just typed correctly into a form that still has
   * the token it failed with.
   */
  it('keeps the typed password on screen after a refusal', async () => {
    resetPassword.mockRejectedValue(new Error('Reset token is invalid or has expired'));
    render(<ResetPasswordPage />);
    typePassword();

    await submitForm();

    expect(passwordField()).toHaveValue(PASSWORD);
    // And still masked: nothing on this page unmasks it.
    expect(passwordField()).toHaveAttribute('type', 'password');
  });
});

describe('/reset-password — the request in flight', () => {
  /**
   * Regression: `disabled={status === 'loading'}` plus the "Resetting..." label are
   * the only feedback that a reset is running. Without them the user re-clicks a
   * button that looks idle and sees nothing happen.
   */
  it('disables the control and swaps its label while the reset is in flight', async () => {
    const { release } = pendingReset();
    render(<ResetPasswordPage />);
    typePassword();

    fireEvent.click(resetButton());
    await settle();

    expect(resetButton()).toBeDisabled();
    expect(resetButton()).toHaveTextContent(/resetting/i);

    await act(async () => release());

    // The confirmation replaces the whole form, so the in-flight label goes with it.
    expect(screen.getByText(/Password reset successful/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resetting/i })).not.toBeInTheDocument();
  });

  /**
   * Regression: the `disabled` attribute is what makes a second, later click inert.
   * Drop it and an impatient user fires a second reset with the same single-use
   * token — whichever lands second is refused, and if the *second* wins the page
   * shows a refusal for a reset that actually succeeded.
   */
  it('does not fire a second request for a click made while the first is in flight', async () => {
    const { release } = pendingReset();
    render(<ResetPasswordPage />);
    typePassword();

    fireEvent.click(resetButton());
    await settle();
    fireEvent.click(resetButton());
    await settle();

    expect(resetPassword).toHaveBeenCalledTimes(1);

    await act(async () => release());
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleSubmit` has no same-tick latch (the `inFlightRef` pattern
   * `DashboardFiles` uses, and the same gap `loginPage.test.tsx` and
   * `signupPage.test.tsx` label). `disabled` is not in the DOM until React
   * re-renders, so two submits inside one batch both reach the handler and both
   * call `resetPassword` with the same single-use token. A real double click lands
   * in separate ticks, so this is a narrow window rather than a live bug — but it is
   * the window an autofill-assisted or programmatic submit falls into. Adding the
   * ref latch turns this test red, which is the point.
   */
  it('fires one request per same-tick double submit', async () => {
    render(<ResetPasswordPage />);
    typePassword();

    act(() => {
      fireEvent.click(resetButton());
      fireEvent.click(resetButton());
    });
    await settle();

    expect(resetPassword).toHaveBeenCalledTimes(2);
  });
});

describe('/reset-password — the form itself', () => {
  /**
   * Regression: `disabled={... || !password}` is what keeps an empty reset off the
   * wire. An empty new password is guaranteed to be rejected by the server, and the
   * rejection costs the user's single-use token.
   */
  it('will not submit an empty password', async () => {
    render(<ResetPasswordPage />);

    expect(resetButton()).toBeDisabled();
    await submitForm();

    expect(resetPassword).not.toHaveBeenCalled();
  });

  /** The control for the test above: the same click, one character typed, submits. */
  it('submits as soon as a password is typed', async () => {
    render(<ResetPasswordPage />);
    typePassword();

    expect(resetButton()).toBeEnabled();
    await submitForm();

    expect(resetPassword).toHaveBeenCalledWith(TOKEN, PASSWORD);
  });

  /**
   * Regression: `required` is the *other* half of that gate, and it is what stops an
   * empty submit that arrives without the button — an Enter key in the field, or a
   * programmatic `form.requestSubmit()`. Without it the page fires
   * `resetPassword(token, '')`, which the server refuses as an invalid password and
   * which costs the user their single-use token. Asserted on the attribute directly
   * because jsdom runs constraint validation only for `requestSubmit`, not for a
   * dispatched `submit` event — the *following* test shows what that leaves exposed.
   */
  it('marks the password field required', () => {
    render(<ResetPasswordPage />);

    expect(passwordField()).toBeRequired();
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleSubmit` has no `if (!password)` guard of its own, so *every* protection
   * against an empty password lives outside the handler: `disabled={!password}` on
   * the button, and the `required` attribute the browser honours. This test dispatches
   * `submit` on the form, which bypasses the disabled button, and jsdom does not run
   * constraint validation for a dispatched event — so the request genuinely goes out
   * with an empty password. In a browser the `required` attribute is what closes this,
   * which is why the test above pins it. Reported, not fixed: adding the guard turns
   * this test red, which is the point.
   */
  it('reaches the API with an empty password when the form is submitted directly', async () => {
    render(<ResetPasswordPage />);

    fireEvent.submit(form());
    await settle();

    expect(resetPassword).toHaveBeenCalledWith(TOKEN, '');
  });

  /**
   * The control for the test above, and the one that shows `handleSubmit` does fire
   * for a form-level submit at all: same dispatch, password filled, and the API sees
   * the real value.
   */
  it('submits through the form itself once a password is typed', async () => {
    render(<ResetPasswordPage />);
    typePassword();

    fireEvent.submit(form());
    await settle();

    expect(resetPassword).toHaveBeenCalledWith(TOKEN, PASSWORD);
  });

  /**
   * Regression: `event.preventDefault()` in `handleSubmit`. Without it the browser
   * performs its default submission — a full page POST to the current URL, which
   * would put the new password into the page request body and reload `/reset-password`
   * with the token still in the query string. Asserted on `dispatchEvent`'s return
   * value (false ⇔ `preventDefault` was called), because in jsdom the navigation
   * itself is not implemented and nothing else observes it.
   */
  it('cancels the browser default so the form never navigates', async () => {
    render(<ResetPasswordPage />);
    typePassword();

    expect(fireEvent.submit(form())).toBe(false);
    await settle();
  });

  /**
   * Regression: the field is `type="password"`, and no control on this page changes
   * it. Asserted so that adding a visibility toggle cannot land as a plain `type`
   * swap that leaves a brand-new credential in cleartext on a shared screen.
   */
  it('keeps the password masked', () => {
    render(<ResetPasswordPage />);
    typePassword();

    expect(passwordField()).toHaveAttribute('type', 'password');
  });
});
