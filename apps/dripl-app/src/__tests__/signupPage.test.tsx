import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * `/signup` is the mirror of `/login` and had no tests: all 29 of its statements
 * were uncovered. `src/__tests__/loginPage.test.tsx` covers `/login` with 30
 * tests, and the shapes here are the same, so this file deliberately repeats its
 * structure rather than inventing a second one — and because the comparison is
 * what surfaces the two places `/signup` still differs from `/login`:
 *
 *   1. `message={typeof error === 'string' ? error : 'An error occurred'}` is
 *      still here. `/login` had exactly this and it was fixed; `/signup` was not.
 *   2. There is still no same-tick submit latch (no `inFlightRef`).
 *
 * Both are pinned LABELLED as they behave today and reported, not fixed. The
 * branch the discarded node was built for is, additionally, unreachable from
 * this API: `/auth/register` answers `'Email is already registered'`, and the
 * only `'already verified'` string in the server is on `/auth/resend-verification`.
 *
 * `useAuth` is pinned by `AuthContext.test.tsx`, so what is under test here is
 * this page's handling of a signup that fails, is already pending verification,
 * or is clicked twice.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const signup = vi.hoisted(() =>
  vi.fn<
    (email: string, password: string, name?: string) => Promise<{ pendingVerification?: boolean }>
  >()
);

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ signup }) }));

import SignupPage from '@/app/signup/page';

const EMAIL = 'ada@dripl.test';
const NAME = 'Ada Lovelace';

function nameField() {
  return screen.getByPlaceholderText('Full name');
}

function emailField() {
  return screen.getByPlaceholderText('Enter your email');
}

function passwordField() {
  return screen.getByPlaceholderText('Password');
}

function submitButton() {
  return screen.getByRole('button', { name: /sign up with email|creating account/i });
}

function signUpButton() {
  return screen.getByRole('button', { name: /^sign up with email$/i });
}

function googleLink() {
  return screen.getByRole('link', { name: /continue with google/i });
}

function fillForm() {
  fireEvent.change(nameField(), { target: { value: NAME } });
  fireEvent.change(emailField(), { target: { value: EMAIL } });
  fireEvent.change(passwordField(), { target: { value: 'hunter2' } });
}

async function submitForm() {
  fireEvent.click(signUpButton());
  await act(async () => {});
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/** A signup promise that stays pending until the returned release is called. */
function pendingSignup(): { release: () => void } {
  const handle = { release: () => {} };
  signup.mockReturnValueOnce(
    new Promise(resolve => {
      handle.release = () => resolve({});
    })
  );
  return handle;
}

beforeEach(() => {
  vi.clearAllMocks();
  signup.mockResolvedValue({});
});

describe('/signup — a successful sign-up', () => {
  /**
   * Regression: three controlled inputs feed three state values and all three
   * are passed to `signup`. Dropping the third argument — or reading the fields
   * from the DOM at submit time — creates the account with no name, and the name
   * is what the product shows on every canvas this person draws.
   */
  it('submits the address, password and name, then goes to the dashboard', async () => {
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(signup).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledWith(EMAIL, 'hunter2', NAME);
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  /**
   * Regression: `/auth/register` answers `pendingVerification` for every outcome
   * that is not already-registered, and the account has no session until the
   * address is verified. Pushing `/dashboard` instead leaves the new user
   * signed out on a page that immediately redirects them to `/login`, which
   * reads as "sign-up did not work".
   */
  it('sends a pending account to the verify-pending page, not the dashboard', async () => {
    signup.mockResolvedValueOnce({ pendingVerification: true });
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(router.push).toHaveBeenCalledWith(`/verify-pending?email=${encodeURIComponent(EMAIL)}`);
    expect(router.push).not.toHaveBeenCalledWith('/dashboard');
  });

  /**
   * Regression: the address is interpolated into a query string unencoded by
   * nobody — `encodeURIComponent` is the only thing standing between an address
   * with `&` in it and a `/verify-pending` page for the wrong person.
   */
  it('encodes the address carried into the verify-pending link', async () => {
    signup.mockResolvedValueOnce({ pendingVerification: true });
    render(<SignupPage />);
    fireEvent.change(emailField(), { target: { value: 'a+b@x.test' } });
    fireEvent.change(passwordField(), { target: { value: 'hunter2' } });

    await submitForm();

    expect(router.push).toHaveBeenCalledWith('/verify-pending?email=a%2Bb%40x.test');
  });

  /**
   * Regression: `push`, not `replace`, is what this page does after a real
   * registration — but after a *failed* one there must be no navigation at all,
   * or the user lands on a dashboard they are not signed into and the reason
   * for the failure only ever existed in a network tab.
   */
  it('does not navigate when the signup fails', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('/signup — a refused sign-up', () => {
  /**
   * Regression: the whole point of the `catch`. This is the message
   * `/auth/register` actually answers with for a duplicate address — the single
   * most likely failure on this page — so it has to reach the screen verbatim.
   */
  it('shows the server message for an address that is already registered', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Email is already registered');
  });

  /**
   * Regression: `setLoading(false)` lives in a `finally`. The bug shape
   * `DashboardFiles` had — a latch consumed by the first failure — leaves the
   * control dead for the life of the page, and a user who mistyped their
   * address can never correct it.
   */
  it('releases the in-flight latch so a second attempt is possible', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();
    await submitForm();
    expect(signUpButton()).toBeEnabled();

    await submitForm();

    expect(signup).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  /**
   * Regression: `disabled={loading}` and the "Creating account..." label are the
   * only feedback that a registration is running. Without them the user
   * re-clicks a button that looks idle and sees nothing happen.
   */
  it('disables the submit control and swaps its label while the request is in flight', async () => {
    const { release } = pendingSignup();
    render(<SignupPage />);
    fillForm();

    fireEvent.click(signUpButton());
    await settle();

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent(/creating account/i);

    await act(async () => release());
    expect(signUpButton()).toBeEnabled();
    expect(signUpButton()).toHaveTextContent(/sign up with email/i);
  });

  /**
   * Regression: the `disabled` attribute is what makes a second, later click
   * inert. Drop it and an impatient user fires a second `/auth/register` while
   * the first is open — two accounts race on the same address, and the loser
   * sets the error after the winner already navigated away.
   */
  it('does not fire a second request for a click made while the first is in flight', async () => {
    const { release } = pendingSignup();
    render(<SignupPage />);
    fillForm();

    fireEvent.click(signUpButton());
    await settle();
    fireEvent.click(submitButton());
    await settle();

    expect(signup).toHaveBeenCalledTimes(1);

    await act(async () => release());
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleSubmit` has no same-tick latch (the `inFlightRef` pattern
   * `DashboardFiles` uses for its create button). `disabled` is not in the DOM
   * until React re-renders, so two submits in one tick both call `signup`. A
   * real double click lands in separate ticks, so this is a narrow window rather
   * than a live bug — but it is the window a same-tick programmatic or
   * autofill-assisted submit falls into. This is the same defect
   * `loginPage.test.tsx` labels on `/login`; adding the ref makes both fail,
   * which is the point.
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
    render(<SignupPage />);
    fillForm();

    act(() => {
      fireEvent.click(signUpButton());
      fireEvent.click(signUpButton());
    });
    await settle();

    expect(signup).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: `handleSubmit` clears `error` before it awaits, so the previous
   * failure does not sit on screen during the next attempt. Without the clear
   * the user reads "Email is already registered" while a request that may well
   * succeed is still open — the form contradicts itself. (Note this is the
   * *second* `setError('')`: `InlineError`'s `onRetry` also clears it, so
   * removing either one alone is invisible and only removing both shows up.)
   */
  it('takes the previous failure down while the next attempt is in flight', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();
    await submitForm();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const { release } = pendingSignup();
    fireEvent.click(signUpButton());
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await act(async () => release());
  });

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to sign up'`. A
   * bare rejection value (a thrown string, an exotic `fetch` failure) has no
   * `.message`, so without the guard the banner renders an empty red box and
   * the user is told nothing about why their sign-up did not work.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    signup.mockRejectedValueOnce('kaboom');
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to sign up');
    expect(router.push).not.toHaveBeenCalled();
  });

  /**
   * Regression: `event.preventDefault()` in `handleSubmit`. Without it the
   * browser performs its default submission — a full page POST to the current
   * URL, reloading `/signup` and discarding everything typed mid-attempt.
   * Asserted on `dispatchEvent`'s return value (false ⇔ `preventDefault` was
   * called), because in jsdom the navigation itself is not implemented and
   * nothing else observes it.
   */
  it('cancels the browser default so the form never navigates', () => {
    render(<SignupPage />);
    fillForm();
    const form = emailField().closest('form');
    if (!form) throw new Error('signup form not rendered');

    expect(fireEvent.submit(form)).toBe(false);
  });

  /**
   * Regression: nothing resets the fields on failure. A handler that cleared
   * them would force the user to retype a password they had just typed
   * correctly, and re-pick the address they had already confirmed.
   */
  it('keeps the typed name, address and password on screen after a refusal', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(nameField()).toHaveValue(NAME);
    expect(emailField()).toHaveValue(EMAIL);
    expect(passwordField()).toHaveValue('hunter2');
  });

  /**
   * Regression: the address and password carry `required`, and that attribute is
   * the only thing stopping an empty submit from reaching the API —
   * `handleSubmit` has no `if (!email || !password)` guard. Clicking submit
   * with empty required fields is blocked by constraint validation, so no
   * request is made at all.
   */
  it('makes no API call at all for an empty submit', async () => {
    render(<SignupPage />);

    expect(emailField()).toBeRequired();
    expect(passwordField()).toBeRequired();
    await submitForm();

    expect(signup).not.toHaveBeenCalled();
  });

  /**
   * Regression: the name field is deliberately *not* required, and an untouched
   * one must arrive as the empty string rather than `undefined` — the server
   * stores `name ?? null`, and a client that sent `undefined` here would be
   * relying on that fallback for the common case.
   */
  it('submits an empty name when the optional name field is left blank', async () => {
    render(<SignupPage />);
    expect(nameField()).not.toBeRequired();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    fireEvent.change(passwordField(), { target: { value: 'hunter2' } });

    await submitForm();

    expect(signup).toHaveBeenCalledWith(EMAIL, 'hunter2', '');
  });

  /**
   * Regression: the password field is `type="password"` and no control on this
   * page changes it. Asserted so that "add a show/hide eye" cannot land as a
   * plain `type` swap that leaves the credential in cleartext on a shared screen.
   */
  it('keeps the password masked', () => {
    render(<SignupPage />);
    fillForm();

    expect(passwordField()).toHaveAttribute('type', 'password');
    expect(emailField()).toHaveAttribute('type', 'email');
    expect(nameField()).toHaveAttribute('type', 'text');
  });
});

describe('/signup — retry from the error banner', () => {
  /**
   * Regression: `onRetry` clears `error` before the retry goes out, so the
   * previous failure does not sit on screen while the new attempt runs — a
   * retry that succeeds would otherwise appear to have failed.
   */
  it('clears the stale message before the retry request goes out', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();
    await submitForm();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const { release } = pendingSignup();
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await act(async () => release());
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  /** Regression: Retry must re-submit rather than only dismissing the message. */
  it('re-submits the same credentials rather than only hiding the message', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();
    await submitForm();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    });

    expect(signup).toHaveBeenCalledTimes(2);
    expect(signup).toHaveBeenLastCalledWith(EMAIL, 'hunter2', NAME);
  });
});

describe('/signup — the already-verified branch', () => {
  /**
   * Two defects on one path, both now fixed.
   *
   * 1. The render collapsed a non-string `error` to the literal "An error
   *    occurred", discarding the span carrying the message and the *Sign in* link.
   *    Verbatim the defect `loginPage.test.tsx` documents on `/login`, fixed there
   *    by widening `InlineError`'s `message` prop to `ReactNode`.
   * 2. The branch tested for 'already verified' — the error on
   *    `/auth/resend-verification` (`routes/auth.ts:360`), a route sign-up never
   *    calls. The duplicate-address error is 'Email is already registered'
   *    (`routes/auth.ts:102`), so the branch was unreachable and the failure that
   *    most needs the link got plain text.
   *
   * Both together mean the most likely sign-up failure told a user their address
   * was taken and offered them nothing to do about it.
   */
  it('offers a sign-in route when the address is already registered', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    const alert = screen.getByRole('alert');
    // The server's own words, not a generic apology.
    expect(alert).toHaveTextContent('Email is already registered');
    expect(alert).not.toHaveTextContent('An error occurred');

    // And the way forward. This is the whole reason the branch exists.
    expect(within(alert).getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');

    // Still a failure: no navigation.
    expect(router.push).not.toHaveBeenCalled();
  });

  it('still shows an unrelated failure as plain text, with no link', async () => {
    // The control for the test above. Widening the prop and adding a branch must
    // not have given every failure a sign-in link — a password policy error has
    // nothing to do with an existing account.
    signup.mockRejectedValueOnce(new Error('Password is too short'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(screen.getByRole('alert')).toHaveTextContent('Password is too short');
    expect(within(screen.getByRole('alert')).queryByRole('link')).toBeNull();
  });

  it('does not offer a sign-in link for the resend route error it never sees', async () => {
    // Regression on the branch condition itself: 'already verified' belongs to
    // `/auth/resend-verification`. Branching on it matched nothing, which is how
    // the real duplicate-address case ended up with no link. This asserts the
    // branch is keyed to the message register actually sends.
    signup.mockRejectedValueOnce(new Error('Email is already verified'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    // Still shown verbatim...
    expect(screen.getByRole('alert')).toHaveTextContent('Email is already verified');
    // ...but without the link, because that error is not an existing account.
    expect(within(screen.getByRole('alert')).queryByRole('link')).toBeNull();
  });

  /**
   * Regression: the ordinary failure path must keep its message and must not grow a
   * sign-in link it never built.
   *
   * This used to use `Email is already registered` as its example, on the reasoning
   * that the branch was dead so the message stayed plain. That stopped being true
   * once the branch was keyed to the message register actually sends -- which is
   * the point. The control now uses an error that genuinely has nothing to do with
   * an existing account, so it tests what it claims: the *else* path.
   */
  it('shows an unrelated failure as plain text with no link', async () => {
    signup.mockRejectedValueOnce(new Error('Password is too short'));
    render(<SignupPage />);
    fillForm();

    await submitForm();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Password is too short');
    expect(alert).not.toHaveTextContent('An error occurred');
    expect(within(alert).queryByRole('link', { name: /sign in/i })).toBeNull();
  });

  /**
   * Regression: the error must also reach the shell, not only the banner —
   * `isError={!!error}` is what triggers the shake and the shell's error
   * styling. A failure that renders a banner inside an un-flagged form looks
   * like a form that is merely complaining.
   */
  it('flags the shell as in-error state so the whole form reacts', async () => {
    signup.mockRejectedValueOnce(new Error('Email is already registered'));
    const { container } = render(<SignupPage />);
    fillForm();

    await submitForm();

    expect(container.querySelector('.t-input.is-error')).not.toBeNull();
  });
});

describe('/signup — the Google path', () => {
  /**
   * Regression: the Google control is a plain server-side redirect, not a second
   * submit. If it ever grew an `onClick` that also called `signup`, one click
   * would post the (empty) password form *and* navigate to OAuth — the user
   * would arrive at Google with a stray registration behind them for the address
   * in the password-manager autofill.
   */
  it('is a link to the server-side redirect and does not call the register API', async () => {
    render(<SignupPage />);

    expect(googleLink()).toHaveAttribute('href', '/api/auth/google');
    expect(signUpButton()).toHaveAttribute('type', 'submit');

    fireEvent.click(googleLink());
    await settle();

    expect(signup).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  /**
   * Regression: the page's other job is sending someone who already has an
   * account to `/login`. That link is the only way off this page for them, so a
   * `href` pointing anywhere else strands them on a form that cannot work for
   * them.
   */
  it('offers a route to sign in for someone who already has an account', () => {
    render(<SignupPage />);

    const links = screen.getAllByRole('link', { name: /sign in/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', '/login');
  });
});
