import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * `app/verify-pending/page.tsx` is where `/signup` and `/login` send every new
 * account, and it had **no tests at all** — all 20 of its statements were uncovered.
 * `useAuth` is pinned by `AuthContext.test.tsx`, so what matters here is this page's
 * own behaviour, and it turns on one piece of state that arrives by URL rather than
 * by form:
 *
 *   `email` comes from `?email=`, and it is the *only* thing that decides whether the
 *   page can do its one job. `/signup` builds the link as
 *   `'/verify-pending?email=' + encodeURIComponent(email)`, and `/login` builds the
 *   same shape for a user who was told to verify — so an unencoded or dropped
 *   parameter lands here as a page that can do nothing at all, with no way for the
 *   user to find out why.
 *
 * That is why the address round-trip is pinned in both directions, and why the
 * *control* tests matter: a test that only clicks the button proves nothing when the
 * button is `disabled` whenever there is no address.
 *
 * `window.location.search` is the source of `?email=`, so these tests drive the URL
 * with `history.replaceState` — the same approach `loginPage.test.tsx` uses for
 * `?next=`.
 */

const resendVerification = vi.hoisted(() => vi.fn<(email: string) => Promise<void>>());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ resendVerification }) }));

import VerifyPendingPage from '@/app/verify-pending/page';

const EMAIL = 'ada@dripl.test';

function visit(search = '') {
  window.history.replaceState({}, '', `/verify-pending${search}`);
}

/** Matches either the idle or the in-flight label, so it works in both states. */
function resendButton(): HTMLElement {
  return screen.getByRole('button', { name: /resend verification email|sending/i });
}

/** A resend promise that stays pending until the returned release is called. */
function pendingResend(): { release: () => void } {
  const handle = { release: () => {} };
  resendVerification.mockReturnValueOnce(
    new Promise<void>(resolve => {
      handle.release = () => resolve();
    })
  );
  return handle;
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

async function clickResend() {
  fireEvent.click(resendButton());
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  resendVerification.mockResolvedValue(undefined);
  visit(`?email=${encodeURIComponent(EMAIL)}`);
});

describe('/verify-pending — the address it was sent to', () => {
  /**
   * Regression: the page's only job is "we emailed you, here is where to". Showing
   * the address is what lets a user who is already signed in as somebody else notice
   * the mismatch *before* clicking resend — otherwise they resend to the wrong inbox
   * and conclude the feature is broken.
   */
  it('shows the address the verification email went to', () => {
    render(<VerifyPendingPage />);

    expect(screen.getByText(/Sent to:/i)).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  /**
   * Regression: `?email=` is percent-encoded by both producers. If the page read the
   * parameter by hand instead of through `searchParams.get`, the confirmation would
   * read `Sent to: ada%40dripl.test` — telling the user their address contains
   * percent signs, and inviting them to conclude the link was tampered with.
   */
  it('decodes a percent-encoded address before showing it', () => {
    visit(`?email=${encodeURIComponent('a+b@x.test')}`);

    render(<VerifyPendingPage />);

    expect(screen.getByText('a+b@x.test')).toBeInTheDocument();
  });

  /**
   * Regression: the `email &&` guard on the "Sent to" block. Rendering it with an
   * empty address would put "Sent to:" in front of nothing, which reads as a
   * truncated address rather than as "this page was reached without one".
   */
  it('omits the address line entirely when the URL carries none', () => {
    visit('');

    render(<VerifyPendingPage />);

    expect(screen.queryByText(/Sent to:/i)).not.toBeInTheDocument();
  });

  /**
   * Regression: the address is what is sent, and it must be the decoded one from
   * `searchParams` — not a hand-parsed slice of `location.search`, and not the value
   * of an input that does not exist on this page. Resending to a mangled address is
   * silently useless: the API accepts it and the user never receives anything.
   */
  it('sends the decoded address from the URL to the resend API', async () => {
    visit(`?email=${encodeURIComponent('a+b@x.test')}`);
    render(<VerifyPendingPage />);

    await clickResend();

    expect(resendVerification).toHaveBeenCalledTimes(1);
    expect(resendVerification).toHaveBeenCalledWith('a+b@x.test');
  });

  /**
   * Regression: `disabled={loading || !email}`. Without `!email` the button is live
   * on a page reached with no address, and the one click the page does accept posts
   * an empty recipient — a request that cannot succeed and that tells the server
   * nothing useful.
   *
   * This is also the **only** enforcement point that exists. The `if (!email)` guard
   * at the top of `handleResend` is unreachable dead code: React filters `onClick` for
   * any control whose `disabled` prop is true, and the button is disabled exactly
   * when `email` is falsy, so no interaction can ever reach those two lines. That is
   * why this file tops out at 18/20 statements — the two uncovered lines are
   * `setError('Email is required')` and its `return`, not a gap in these tests.
   * Reported, not fixed; the fix is to delete the guard or to stop disabling the
   * button, and either way one of the two tests above has to change with it.
   */
  it('will not send anything when the URL carries no address', async () => {
    visit('');
    render(<VerifyPendingPage />);

    expect(resendButton()).toBeDisabled();
    await clickResend();

    expect(resendVerification).not.toHaveBeenCalled();
  });

  /** The control for the test above: the same button, with an address, is live. */
  it('enables the button as soon as the URL carries an address', () => {
    render(<VerifyPendingPage />);

    expect(resendButton()).toBeEnabled();
  });
});

describe('/verify-pending — an email that was sent', () => {
  /**
   * Regression: the whole point of the `try`. A resend the user asked for has to end
   * in a confirmation, or the page is a button with no answer and they click again.
   */
  it('confirms the send', async () => {
    render(<VerifyPendingPage />);

    await clickResend();

    expect(
      screen.getByText('Verification email sent! Please check your inbox.')
    ).toBeInTheDocument();
  });

  /**
   * Regression: `setError('')` before the await. Without it the page shows
   * "Verification email sent" *and* the previous refusal at the same time — the two
   * contradict each other, and the user cannot tell which one is current.
   */
  it('takes the previous refusal down while the next send is in flight', async () => {
    resendVerification.mockRejectedValueOnce(new Error('Too many requests'));
    render(<VerifyPendingPage />);
    await clickResend();
    expect(screen.getByText('Too many requests')).toBeInTheDocument();

    const { release } = pendingResend();
    fireEvent.click(resendButton());
    await settle();

    expect(screen.queryByText('Too many requests')).not.toBeInTheDocument();
    expect(resendButton()).toBeDisabled();
    expect(screen.getByText(/Sending/i)).toBeInTheDocument();

    await act(async () => release());
    expect(screen.getByText(/Verification email sent/i)).toBeInTheDocument();
  });

  /**
   * Regression: `setMessage('')` before the await, the mirror of the clear above. One
   * confirmation left on screen next to a second failure is a page that looks like
   * the send worked.
   */
  it('takes the previous confirmation down before a second attempt', async () => {
    render(<VerifyPendingPage />);
    await clickResend();
    expect(screen.getByText(/Verification email sent/i)).toBeInTheDocument();

    const { release } = pendingResend();
    fireEvent.click(resendButton());
    await settle();

    expect(screen.queryByText(/Verification email sent/i)).not.toBeInTheDocument();

    await act(async () => release());
  });

  /**
   * Regression: the confirmation and the address have to coexist. The send can be
   * slow enough for a user to have scrolled away, and "which inbox?" is the question
   * the confirmation provokes.
   */
  it('still shows the address alongside the confirmation', async () => {
    render(<VerifyPendingPage />);

    await clickResend();

    expect(screen.getByText(/Verification email sent/i)).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });
});

describe('/verify-pending — a refused resend', () => {
  /**
   * Regression: the whole point of the `catch`. Resending is rate-limited, so "Too
   * many requests" is the realistic rejection and the server's own words have to reach
   * the screen rather than a generic apology.
   */
  it('shows the message the server refused with', async () => {
    resendVerification.mockRejectedValue(new Error('Too many requests'));
    render(<VerifyPendingPage />);

    await clickResend();

    expect(screen.getByText('Too many requests')).toBeInTheDocument();
    expect(screen.queryByText(/Verification email sent/i)).not.toBeInTheDocument();
  });

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to resend email'`. A
   * bare rejection (a thrown string, an exotic `fetch` failure) has no `.message`, so
   * without the guard the banner renders as an empty red box and the user is told
   * nothing about why the resend failed.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    resendVerification.mockRejectedValue('kaboom');
    render(<VerifyPendingPage />);

    await clickResend();

    expect(screen.getByText('Failed to resend email')).toBeInTheDocument();
  });

  /**
   * Regression: `setLoading(false)` lives in the `finally`. The bug shape
   * `DashboardFiles` had — a latch consumed by the first failure — leaves the control
   * dead for the life of the page, and a rate-limited user has to wait it out with no
   * way to try again.
   */
  it('releases the in-flight latch so a second attempt is possible', async () => {
    resendVerification.mockRejectedValueOnce(new Error('Too many requests'));
    render(<VerifyPendingPage />);
    await clickResend();
    expect(resendButton()).toBeEnabled();
    expect(screen.getByText('Too many requests')).toBeInTheDocument();

    await clickResend();

    expect(resendVerification).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Verification email sent/i)).toBeInTheDocument();
  });

  /**
   * Regression: `disabled={loading || ...}` and the "Sending..." label are the only
   * feedback that a send is running. Resending is the button people double-click, so
   * without both the user fires a second request into a rate limiter and turns a
   * working resend into a refusal.
   */
  it('disables the control and swaps its label while the send is in flight', async () => {
    const { release } = pendingResend();
    render(<VerifyPendingPage />);

    fireEvent.click(resendButton());
    await settle();

    expect(resendButton()).toBeDisabled();
    expect(resendButton()).toHaveTextContent(/sending/i);

    await act(async () => release());

    expect(resendButton()).toBeEnabled();
    expect(resendButton()).toHaveTextContent(/resend verification email/i);
  });

  /**
   * Regression: the `disabled` attribute is what makes a second, later click inert.
   * This is the one control on this page a user is most likely to click twice.
   */
  it('does not fire a second request for a click made while the first is in flight', async () => {
    const { release } = pendingResend();
    render(<VerifyPendingPage />);

    fireEvent.click(resendButton());
    await settle();
    fireEvent.click(resendButton());
    await settle();

    expect(resendVerification).toHaveBeenCalledTimes(1);

    await act(async () => release());
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleResend` has no same-tick latch (the `inFlightRef` pattern
   * `DashboardFiles` uses, and the same gap `loginPage.test.tsx` and
   * `signupPage.test.tsx` label). `disabled` is not in the DOM until React
   * re-renders, so two clicks inside one batch both reach the handler. A real double
   * click lands in separate ticks, so this is a narrow window rather than a live bug —
   * but it is the window a same-tick programmatic or assistive click falls into, and
   * the second request is the one that eats the rate limit. Adding the ref latch turns
   * this test red, which is the point.
   */
  it('fires one request per same-tick double click', async () => {
    render(<VerifyPendingPage />);

    act(() => {
      fireEvent.click(resendButton());
      fireEvent.click(resendButton());
    });
    await settle();

    expect(resendVerification).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression: nothing clears `email` on failure, so the address stays on screen.
   * It comes from the URL and is the one thing the user may need in order to go and
   * find the mail client this resend just went to.
   */
  it('keeps the address on screen after a refusal', async () => {
    resendVerification.mockRejectedValue(new Error('Too many requests'));
    render(<VerifyPendingPage />);

    await clickResend();

    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });
});

describe('/verify-pending — the way out', () => {
  /**
   * Regression: this page has exactly one exit, and it is for the user who has already
   * verified — which is most of the people who land here, because verification links
   * in some clients are opened hours or days after they were sent. A link pointing
   * anywhere else strands them.
   */
  it('offers a route to sign in for someone who already verified', () => {
    render(<VerifyPendingPage />);

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  /**
   * Regression: the sign-in link is a link, not a second way to resend. If it ever
   * grew an `onClick` that also called `resendVerification`, one click would navigate
   * to `/login` *and* fire a resend — and the rate limiter counts requests for an
   * address regardless of whether anybody stayed to read them.
   */
  it('sends nothing when the sign-in link is followed', async () => {
    render(<VerifyPendingPage />);

    fireEvent.click(screen.getByRole('link', { name: /sign in/i }));
    await settle();

    expect(resendVerification).not.toHaveBeenCalled();
  });
});
