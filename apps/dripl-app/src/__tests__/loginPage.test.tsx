import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * `/login` is the first screen a person who cannot sign in meets, and it had **no
 * tests at all** — all 43 of its statements were uncovered.
 *
 * `useAuth` itself is pinned by `AuthContext.test.tsx`, which is where the session
 * contract lives: a rejected `login` propagates, it is never swallowed. So the job
 * here is not "does login fail" but **what this page does with that failure**, which
 * is the part nobody has looked at:
 *
 *   failure  — the server's message has to reach the screen, the router must not
 *              move, and the button has to come back so a second attempt is possible.
 *   latching — a request in flight must not be fireable twice, and the latch must
 *              not leak (the bug shape `DashboardFiles` had: a latch consumed by the
 *              first failure, disabling the control for the life of the page).
 *   input    — the typed password must survive a failure, and must stay masked.
 *
 * `window.location.search` is the source of `?next=` and `?error=`, so these tests
 * drive the URL with `history.replaceState` rather than mocking a hook.
 */

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const login = vi.hoisted(() => vi.fn<(email: string, password: string) => Promise<void>>());

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ login }) }));

import LoginPage from '@/app/login/page';

const EMAIL = 'ada@dripl.test';

function visit(search = '') {
  window.history.replaceState({}, '', `/login${search}`);
}

function emailField() {
  return screen.getByPlaceholderText('Enter your email');
}

function passwordField() {
  return screen.getByPlaceholderText('Password');
}

function submitButton() {
  return screen.getByRole('button', { name: /sign in with email|signing in/i });
}

function signInButton() {
  return screen.getByRole('button', { name: /^sign in with email$/i });
}

function googleLink() {
  return screen.getByRole('link', { name: /continue with google/i });
}

function fillCredentials() {
  fireEvent.change(emailField(), { target: { value: EMAIL } });
  fireEvent.change(passwordField(), { target: { value: 'hunter2' } });
}

async function submitForm() {
  fireEvent.click(signInButton());
  await act(async () => {});
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  login.mockResolvedValue(undefined);
  visit();
});

describe('/login — successful sign-in', () => {
  /**
   * Regression: the form is a controlled pair of inputs wired to `email`/`password`
   * state, and `handleSubmit` passes that state to `login`. Reading them from the DOM
   * at submit time (or submitting the form values directly) sends the wrong pair, and
   * the failure is "invalid credentials" on a correct password.
   */
  it('submits exactly what was typed and then leaves for the dashboard', async () => {
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(EMAIL, 'hunter2');
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  /**
   * Regression: `?next=` is how a deep link survives the login detour — a user bounced
   * off `/file/abc` lands back there instead of on the dashboard. It is read from
   * `window.location.search` in a mount effect, so it must be present before the first
   * commit.
   */
  it('returns the user to the internal path a protected route asked for', async () => {
    visit('?next=%2Ffile%2Fabc');
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(router.replace).toHaveBeenCalledWith('/file/abc');
  });

  /**
   * Regression: `next` is URL-supplied and goes straight into `router.replace`. The
   * guard is `startsWith('/') && !startsWith('//')`; drop the second half and
   * `?next=//evil.test` becomes a protocol-relative redirect off-origin — an open
   * redirect on the page that users type their password into.
   */
  it('refuses a protocol-relative next path', async () => {
    visit('?next=%2F%2Fevil.test%2Fsteal');
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  /** The control for the test above: an absolute URL does not start with `/` at all. */
  it('refuses an absolute next path', async () => {
    visit('?next=https%3A%2F%2Fevil.test');
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  /**
   * Regression: the Google control is a plain server-side redirect and carries `next`
   * in its query string. If it dropped the parameter, OAuth users would land on the
   * dashboard while password users land where they asked — the two sign-in paths
   * disagreeing about where "after login" is.
   */
  it('carries the same validated next path into the Google sign-in link', () => {
    visit('?next=%2Ffile%2Fabc');
    render(<LoginPage />);

    expect(googleLink()).toHaveAttribute('href', '/api/auth/google?next=%2Ffile%2Fabc');
  });

  /**
   * Regression: `replace`, not `push`. `push` leaves the sign-in page in the history
   * stack, so the browser Back button returns the user to a form for a session they
   * already have — and, on the OAuth callback route, re-enters a completed exchange.
   */
  it('replaces history rather than pushing the signed-in session', async () => {
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledTimes(1);
  });
});

describe('/login — a refused sign-in', () => {
  /**
   * Regression: the whole point of the `catch`. A failed sign-in that still navigates
   * drops the user on the dashboard signed out, with the reason only ever having been
   * in a network tab; a failure that renders nothing leaves them staring at a form
   * that did nothing.
   */
  it('shows the server message and does not move', async () => {
    login.mockRejectedValue(new Error('Invalid email or password'));
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  /**
   * Regression: `setLoading(false)` lives in a `finally`. This is the exact bug shape
   * that was found and fixed in `DashboardFiles`: a latch consumed by the first
   * failure leaves the control dead for the life of the page, and the user can never
   * correct a mistyped password.
   */
  it('releases the in-flight latch so a second attempt is possible', async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password'));
    render(<LoginPage />);
    fillCredentials();

    await submitForm();
    expect(signInButton()).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');

    await submitForm();

    expect(login).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  /**
   * Regression: `disabled={loading}` plus the "Signing in..." label are the only
   * feedback that a sign-in is running. Without them the user re-clicks a button that
   * looks idle, and the page shows no sign that anything is happening.
   */
  it('disables the submit control and swaps its label while the request is in flight', async () => {
    let release: () => void = () => {};
    login.mockReturnValue(
      new Promise<void>(resolve => {
        release = resolve;
      })
    );
    render(<LoginPage />);
    fillCredentials();

    fireEvent.click(signInButton());
    await settle();

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent(/signing in/i);

    await act(async () => release());
    expect(signInButton()).toBeEnabled();
    expect(signInButton()).toHaveTextContent(/sign in with email/i);
  });

  /**
   * Regression: the disabled attribute is what makes a second, later click inert.
   * Drop `disabled={loading}` and an impatient user fires a second `/login` request
   * while the first is still open — two sets of credentials race, and the loser of
   * the race sets the error after the winner already navigated.
   */
  it('does not fire a second request for a click made while the first is in flight', async () => {
    let release: () => void = () => {};
    login.mockReturnValue(
      new Promise<void>(resolve => {
        release = resolve;
      })
    );
    render(<LoginPage />);
    fillCredentials();

    fireEvent.click(signInButton());
    await settle();
    fireEvent.click(submitButton());
    await settle();

    expect(login).toHaveBeenCalledTimes(1);

    await act(async () => release());
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleSubmit` has no same-tick latch (the `createInFlightRef` pattern
   * `DashboardFiles` uses for its create button). `disabled` is not in the DOM until
   * React re-renders, so two submits in one tick both call `login`. A real double
   * click lands in separate ticks, so this is a narrow window rather than a live bug —
   * but it is the window a same-tick programmatic or autofill-assisted submit falls
   * into, and adding the ref makes this test fail, which is the point: the fix has to
   * be a decision, not an accident.
   */
  /**
   * Regression: the double-submit latch.
   *
   * `disabled` is not in the DOM until React re-renders, so two clicks inside one
   * batch both reach the handler. The guard has to be a **ref**, not the `loading`
   * state: inside a single `act`, the two `setLoading(true)` calls batch and React
   * does not re-render, so the second `handleSubmit` still closes over
   * `loading === false` and a state guard is inert by construction. That was
   * verified by mutation -- adding `if (loading) return;` changed nothing, while
   * adding the ref latch turns this test green.
   *
   * A second registration for one address races the first and produces a confusing
   * 409; a second sign-in doubles the credential check against the rate limiter.
   * `DashboardFiles` already uses this ref shape.
   */
  it('fires one request for two submits in the same tick', async () => {
    render(<LoginPage />);
    fillCredentials();

    act(() => {
      fireEvent.click(signInButton());
      fireEvent.click(signInButton());
    });
    await settle();

    expect(login).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: `handleSubmit` clears `error` before it awaits, so the previous
   * failure does not sit on screen during the next attempt. Without the clear the user
   * reads the old "Invalid email or password" while a request that may well succeed is
   * still open — the form contradicts itself. (Note this is the *second* `setError('')`
   * in the file: `InlineError`'s `onRetry` also clears it, which is why removing either
   * one alone is invisible and only removing both shows up here.)
   */
  it('takes the previous failure down while the next attempt is in flight', async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password'));
    render(<LoginPage />);
    fillCredentials();
    await submitForm();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    let release: () => void = () => {};
    login.mockReturnValueOnce(
      new Promise<void>(resolve => {
        release = resolve;
      })
    );
    fireEvent.click(signInButton());
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await act(async () => release());
  });

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to login'`. A bare
   * rejection value (a thrown string, an exotic `fetch` failure) has no `.message`, so
   * without the guard the banner renders an empty red box and the user is told nothing
   * at all about why their sign-in did not work.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    login.mockRejectedValue('kaboom');
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to login');
    expect(router.replace).not.toHaveBeenCalled();
  });

  /**
   * Regression: `event.preventDefault()` in `handleSubmit`. Without it the browser
   * performs its default form submission — a full page POST to the current URL,
   * reloading `/login` and discarding the typed credentials mid-attempt. Asserted on
   * `dispatchEvent`'s return value (false ⇔ `preventDefault` was called), because in
   * jsdom the navigation itself is not implemented and nothing else observes it.
   */
  it('cancels the browser default so the form never navigates', () => {
    render(<LoginPage />);
    fillCredentials();
    const form = emailField().closest('form');
    if (!form) throw new Error('login form not rendered');

    expect(fireEvent.submit(form)).toBe(false);
  });

  /**
   * Regression: nothing resets `email`/`password` on failure. A handler that cleared
   * them (`setPassword('')` in the `catch`, or a `key` bump to remount the form)
   * would force the user to retype a password they had just typed correctly — the
   * most annoying possible response to "wrong password".
   */
  it('keeps the typed credentials on screen after a refusal', async () => {
    login.mockRejectedValue(new Error('Invalid email or password'));
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(emailField()).toHaveValue(EMAIL);
    expect(passwordField()).toHaveValue('hunter2');
  });

  /**
   * Regression: the password field is `type="password"` and there is no control that
   * changes it (no visibility toggle exists on this page — reported, not pinned as
   * expected behaviour). Asserted so that "add a show/hide eye" cannot land as a plain
   * `type` swap that leaves the credential in cleartext for anyone looking over a
   * shoulder or at a shared screen.
   */
  it('keeps the password masked', () => {
    render(<LoginPage />);
    fillCredentials();

    expect(passwordField()).toHaveAttribute('type', 'password');
    expect(emailField()).toHaveAttribute('type', 'email');
  });

  /**
   * Regression: the fields carry `required`, and that attribute is the *only* thing
   * stopping an empty submit from reaching the API — `handleSubmit` has no
   * `if (!email || !password)` guard. Clicking a submit button in a form with empty
   * required fields is blocked by constraint validation, so no request is made.
   * Without `required` the page fires `login('', '')`, which reads as "Invalid email
   * or password" for a form the user has not filled in yet.
   */
  it('makes no API call at all for an empty submit', async () => {
    render(<LoginPage />);

    expect(emailField()).toBeRequired();
    expect(passwordField()).toBeRequired();
    await submitForm();

    expect(login).not.toHaveBeenCalled();
  });

  /** The control for the test above: with the fields filled, the same click submits. */
  it('does submit once the required fields are filled', async () => {
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(login).toHaveBeenCalledTimes(1);
  });
});

describe('/login — retry from the error banner', () => {
  /**
   * Regression: `onRetry` clears `error` before the retry goes out, so the previous
   * failure does not sit on screen while the new attempt is running — a retry that
   * succeeds would otherwise appear to have failed. Note the page clears in *two*
   * places (here and at the top of `handleSubmit`); removing only one is invisible,
   * and this test is what catches both being removed.
   */
  it('clears the stale message before the retry request goes out', async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password'));
    render(<LoginPage />);
    fillCredentials();
    await submitForm();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    let release: () => void = () => {};
    login.mockReturnValueOnce(
      new Promise<void>(resolve => {
        release = resolve;
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await act(async () => release());
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  /** Regression: Retry must re-submit rather than only dismissing the message. */
  it('re-submits the credentials rather than only hiding the message', async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password'));
    render(<LoginPage />);
    fillCredentials();
    await submitForm();

    login.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    await settle();

    expect(login).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenLastCalledWith(EMAIL, 'hunter2');
  });
});

describe('/login — messages from the auth callback', () => {
  /**
   * Regression: OAuth and auth failures redirect back here with `?error=<code>` and
   * would otherwise fail silently — the user's Google sign-in bounces back to a login
   * form that looks untouched, with the cause only in devtools. Each code maps to a
   * message that names what went wrong.
   */
  it.each([
    ['auth_failed', /failed while creating your session/i],
    ['oauth_not_configured', /not configured on this server/i],
    ['token_exchange_failed', /failed during token exchange/i],
    ['invalid_state', /sign-in session expired/i],
    ['missing_code', /did not return an authorization code/i],
  ])('surfaces the %s callback code as readable text', (code, expected) => {
    visit(`?error=${code}`);
    render(<LoginPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(expected);
  });

  /**
   * Regression: the `google_` prefix branch. Without it an unrecognised Google code
   * falls to the generic "Sign-in failed", which tells a user nothing about which of
   * the two paths they took failed.
   */
  it('names Google as the source for any unrecognised google_* code', () => {
    visit('?error=google_something_new_from_the_provider');
    render(<LoginPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/google declined the sign-in request/i);
  });

  /** Regression: an unknown non-Google code must still produce a message, not a blank. */
  it('falls back to a generic message for an unknown code', () => {
    visit('?error=something_brand_new');
    render(<LoginPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in failed\. please try again/i);
  });

  /** Regression: the callback error must also reach the shell, not only the banner. */
  it('flags the shell as in-error state so the whole form reacts', () => {
    visit('?error=auth_failed');
    const { container } = render(<LoginPage />);

    expect(container.querySelector('.t-input.is-error')).not.toBeNull();
  });

  /**
   * The source builds a `<span>` carrying the server's message plus a "Resend
   * verification" link, then rendered
   * `message={typeof error === 'string' ? error : 'An error occurred'}` — so a
   * non-string `error` reached `InlineError` as the literal text "An error
   * occurred" and the element holding the message and the link was discarded. A
   * user whose address is unverified was told nothing about why and was offered
   * no way to resend.
   *
   * The branch exists only to give them that link, so the intent was never in
   * doubt; what was wrong was `InlineError`'s prop being typed `string` while the
   * component interpolated it into a `<p>` anyway. Widening the prop to
   * `ReactNode` and passing `error` through is the whole fix.
   */
  it('shows the resend-verification message and link for an unverified address', async () => {
    login.mockRejectedValue(new Error('Please verify your email before signing in'));
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    const alert = screen.getByRole('alert');
    // The server's own words, not a generic apology.
    expect(alert).toHaveTextContent('Please verify your email before signing in');
    expect(alert).not.toHaveTextContent('An error occurred');

    // And the way forward, carrying the address so the resend page knows where to
    // send. This is the entire reason the branch exists.
    const resend = screen.getByRole('link', { name: /resend verification/i });
    expect(resend).toHaveAttribute(
      'href',
      `/verify-pending?email=${encodeURIComponent('ada@dripl.test')}`
    );

    // Still a failure: no navigation.
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('still shows an ordinary failure as plain text', async () => {
    // The control for the test above. Widening the prop to a node must not have
    // cost the ordinary path its message.
    login.mockRejectedValue(new Error('Invalid credentials'));
    render(<LoginPage />);
    fillCredentials();

    await submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.queryByRole('link', { name: /resend verification/i })).not.toBeInTheDocument();
  });
});

describe('/login — the Google path', () => {
  /**
   * Regression: the Google control is a link to a server-side redirect, not a second
   * submit. If it ever grew an `onClick` that also called `login`, one click would
   * post the (empty) password form *and* navigate to OAuth — the user would arrive at
   * Google with a stray sign-in request behind them and a form that had already
   * failed. Asserted by clicking it and checking neither path fires the other.
   */
  it('is a link to the server-side redirect and does not call the password API', async () => {
    render(<LoginPage />);

    expect(googleLink()).toHaveAttribute('href', '/api/auth/google?next=%2Fdashboard');
    expect(signInButton()).toHaveAttribute('type', 'submit');

    fireEvent.click(googleLink());
    await settle();

    expect(login).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
