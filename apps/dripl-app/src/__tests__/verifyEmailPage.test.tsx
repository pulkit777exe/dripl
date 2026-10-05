import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

/**
 * `app/verify-email/page.tsx` is where a click on the link in a verification email
 * lands, and it had **no tests at all** — all 20 of its statements were uncovered.
 *
 * It is the only one of these three pages that **acts on mount**: `useEffect` reads
 * `?token=` and calls `verifyEmail(token)` without the user clicking anything. That
 * makes it the one whose failure modes are invisible — there is no button to press,
 * so "it did not work" is the only thing the user can report, and the page has to
 * render a legible reason. The three branches it renders are therefore worth pinning
 * separately:
 *
 *   no token   — the effect bails before calling the API, so a mangled link costs the
 *                user nothing. If it called `verifyEmail('')`, a bad link would burn a
 *                rate-limited, single-use verification.
 *   in flight  — the spinner is the only sign anything is happening.
 *   settled    — success and failure must not look alike, and each has to offer a
 *                different way forward (`/login` vs `/signup`).
 *
 * The effect's dependency list is `[token, verifyEmail]`, and `verifyEmail` comes from
 * `useAuth`, which memoises it with `useCallback`. That is the load-bearing detail: if
 * the identity were unstable, the effect would re-verify on every render, and
 * `setStatus` would re-render — an unbounded loop of single-use token submissions.
 *
 * One testing hazard, specific to this page: `AuthShell` renders its `title` outside
 * `AnimatePresence` but its `children` inside `<AnimatePresence mode="wait">` keyed on
 * that same `title`. Because this page *changes the title with the status*
 * ('Verifying...' → 'Email verified!' / 'Verification failed'), every status change
 * swaps the keyed subtree, and `mode="wait"` holds the outgoing children on screen
 * until their 0.2s exit animation finishes. So the heading changes instantly while
 * the body lags behind it — asserted below as a deliberate pair of timings — and every
 * assertion about the new *body* has to be reached with `waitFor`.
 *
 * `window.location.search` is the source of `?token=`, so these tests drive the URL
 * with `history.replaceState` — the same approach `loginPage.test.tsx` uses for
 * `?next=`.
 */

const verifyEmail = vi.hoisted(() => vi.fn<(token: string) => Promise<void>>());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ verifyEmail }) }));

import VerifyEmailPage from '@/app/verify-email/page';

const TOKEN = 'verify-token-abc';

/** A verification promise that stays pending until the returned release is called. */
function pendingVerify(): { release: () => void } {
  const handle = { release: () => {} };
  verifyEmail.mockReturnValueOnce(
    new Promise<void>(resolve => {
      handle.release = () => resolve();
    })
  );
  return handle;
}

function visit(search = '') {
  window.history.replaceState({}, '', `/verify-email${search}`);
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

/** Re-renders the page, the way a re-parent or a router refresh would. */
async function rerenderLater(rerender: (ui: React.ReactElement) => void): Promise<void> {
  await act(async () => {
    rerender(<VerifyEmailPage />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyEmail.mockResolvedValue(undefined);
  visit(`?token=${encodeURIComponent(TOKEN)}`);
});

describe('/verify-email — a link with no token', () => {
  /**
   * Regression: `if (!token)` inside the effect, and it is the cheapest line on the
   * page. `verifyEmail('')` would spend a rate-limited, single-use verification on a
   * link that was never valid, and the account owner would have to ask for another
   * one — so the bail-out has to happen before the call, not after the failure.
   */
  it('never calls the verification API without a token', async () => {
    visit('');
    render(<VerifyEmailPage />);

    await settle();

    expect(verifyEmail).not.toHaveBeenCalled();
  });

  /**
   * Regression: the user who lands here clicked a link and nothing visible happened,
   * so the page has to name the reason. "Verifying..." forever is the alternative, and
   * it reads as a bug rather than as a dead link. The heading is outside
   * `AnimatePresence`, so it is correct on the very first commit.
   */
  it('says the token is invalid instead of spinning forever', async () => {
    visit('');
    render(<VerifyEmailPage />);

    expect(screen.getByRole('heading', { name: 'Verification failed' })).toBeInTheDocument();
    expect(screen.queryByText(/Please wait while we verify/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Invalid verification token')).toBeInTheDocument();
    });
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  /**
   * Regression: a dead verification link is an account that never got confirmed, so
   * the only useful way forward is a fresh sign-up. `/login` would send them to a
   * form that answers "please verify your email first" — a loop.
   */
  it('offers a fresh sign-up rather than a sign-in', async () => {
    visit('');
    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /sign up again/i })).toHaveAttribute(
        'href',
        '/signup'
      );
    });
    expect(screen.queryByRole('link', { name: /go to login/i })).not.toBeInTheDocument();
  });

  /**
   * The control for the three above, and what makes them non-vacuous: a token in the
   * URL skips the bail-out and calls the API. Inverting the guard (`if (token)`) fails
   * all three and passes this.
   */
  it('verifies when the URL does carry a token', async () => {
    render(<VerifyEmailPage />);

    await settle();

    expect(verifyEmail).toHaveBeenCalledWith(TOKEN);
  });
});

describe('/verify-email — while the verification runs', () => {
  /**
   * Regression: the page acts on mount, so the loading state is the *only* feedback
   * between the user clicking a link and the page doing anything. Without it the
   * screen is blank until the request settles, which reads as a broken page rather
   * than a slow network.
   */
  it('shows a spinner and a waiting subtitle until the API answers', async () => {
    const { release } = pendingVerify();
    render(<VerifyEmailPage />);
    await settle();

    expect(screen.getByRole('heading', { name: 'Verifying...' })).toBeInTheDocument();
    expect(screen.getByText('Please wait while we verify your email.')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    // Nothing decided yet: no verdict and no way forward that presumes one.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    await act(async () => release());
  });

  /**
   * Regression: `status` is the single state driving three mutually exclusive
   * renders. If `setStatus('success')` were dropped the spinner would spin forever
   * over a verification that had already succeeded, and the user would click their
   * link a second time.
   */
  it('takes the spinner down once the API answers', async () => {
    const { release } = pendingVerify();
    render(<VerifyEmailPage />);
    await settle();
    expect(document.querySelector('.animate-spin')).not.toBeNull();

    await act(async () => release());

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'Email verified!' })).toBeInTheDocument();
  });

  /**
   * Regression on the `AuthShell` interaction documented at the top of this file: the
   * heading is rendered outside `AnimatePresence` and the children inside a keyed
   * `mode="wait"` block, so a status change updates the two at different times. Here
   * the heading claims "Verification failed" while the outgoing spinner is still on
   * screen — the page contradicts itself for one exit animation. Pinned as it behaves
   * today, and reported rather than fixed: keying the shell on something other than
   * the title (or a `mode="sync"` block) would make the two change together, and
   * doing that turns this test red.
   */
  it('changes the heading before the body it describes', async () => {
    const { release } = pendingVerify();
    render(<VerifyEmailPage />);
    await settle();

    await act(async () => release());

    // The heading flips immediately...
    expect(screen.getByRole('heading', { name: 'Email verified!' })).toBeInTheDocument();
    // ...while the spinner the heading has already disowned is still spinning.
    expect(document.querySelector('.animate-spin')).not.toBeNull();

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeNull();
    });
  });
});

describe('/verify-email — a verified address', () => {
  /**
   * Regression: the token is URL-supplied and percent-encoded in a real email link;
   * `searchParams.get` decodes it. A hand-rolled slice of `location.search` would hand
   * the API the still-encoded form, and every verification would fail as an unknown
   * token — a failure indistinguishable from a forged or expired link.
   */
  it('sends the decoded token from the URL to the verification API', async () => {
    visit(`?token=${encodeURIComponent('a+b/c=d&e')}`);
    render(<VerifyEmailPage />);

    await settle();

    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyEmail).toHaveBeenCalledWith('a+b/c=d&e');
  });

  /**
   * Regression: the success copy is what tells the user the link worked *and* that
   * they may now sign in. Both halves matter, and the second is the whole reason the
   * page keeps the user on it instead of redirecting.
   */
  it('confirms the verification and links to sign in', async () => {
    render(<VerifyEmailPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Email verified successfully! You can now log in.')
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
  });

  /**
   * Regression: `subtitle={status === 'loading' ? '...' : ''}`. Leaving the waiting
   * copy on screen after the answer would contradict the confirmation above it.
   */
  it('clears the waiting subtitle once it is done', async () => {
    render(<VerifyEmailPage />);

    await settle();

    expect(screen.queryByText(/Please wait while we verify/i)).not.toBeInTheDocument();
  });

  /**
   * Regression: the effect depends on `[token, verifyEmail]`, and `useAuth` memoises
   * `verifyEmail` with `useCallback` — so the deps are stable and the effect runs
   * once. Drop the dependency array and every `setStatus` re-render re-fires the
   * effect, submitting a single-use token in a loop. Asserted over an explicit
   * re-render, so the "once" is a property of the render sequence and not of the
   * absence of one.
   */
  it('verifies once and does not re-verify on a later render', async () => {
    const { rerender } = render(<VerifyEmailPage />);
    await settle();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText(/Email verified successfully/i)).toBeInTheDocument();
    });

    await rerenderLater(rerender);

    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Email verified successfully/i)).toBeInTheDocument();
  });
});

describe('/verify-email — a refused verification', () => {
  /**
   * Regression: the whole point of the `catch`. Verification tokens are single-use, so
   * "already verified" and "expired" are the realistic rejections and the server's own
   * words have to reach the screen rather than a generic apology.
   */
  it('shows the message the server refused with', async () => {
    verifyEmail.mockRejectedValue(new Error('Verification token has expired'));
    render(<VerifyEmailPage />);

    await settle();

    expect(screen.getByRole('heading', { name: 'Verification failed' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Verification token has expired')).toBeInTheDocument();
    });
  });

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to verify email'`. A
   * bare rejection (a thrown string, an exotic `fetch` failure) has no `.message`, so
   * without the guard the banner renders as an empty red box and the user is told
   * nothing about why their link did nothing.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    verifyEmail.mockRejectedValue('kaboom');
    render(<VerifyEmailPage />);

    await settle();

    await waitFor(() => {
      expect(screen.getByText('Failed to verify email')).toBeInTheDocument();
    });
  });

  /**
   * Regression: success and failure must not look alike, and the two branches offer
   * opposite advice. Offering `/login` on a failure sends the user to a form that
   * answers "please verify your email before signing in" — a loop.
   */
  it('offers a fresh sign-up, not a sign-in, when the verification fails', async () => {
    verifyEmail.mockRejectedValue(new Error('Verification token has expired'));
    render(<VerifyEmailPage />);

    await settle();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /sign up again/i })).toHaveAttribute(
        'href',
        '/signup'
      );
    });
    expect(screen.queryByRole('link', { name: /go to login/i })).not.toBeInTheDocument();
  });

  /**
   * Regression: the two branches are keyed on `status`, and mixing them up sends the
   * user to the wrong form. Asserted on the *positive* branch too, so that tightening
   * the failure branch cannot be satisfied by deleting the success one.
   */
  it('keeps the success sign-in link away from a failure', async () => {
    verifyEmail.mockRejectedValue(new Error('Verification token has expired'));
    render(<VerifyEmailPage />);

    await settle();
    await waitFor(() => {
      expect(screen.getByText('Verification token has expired')).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /go to login/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Email verified successfully/i)).not.toBeInTheDocument();
    // And the success branch still has it, so the pair is not vacuous.
    verifyEmail.mockResolvedValueOnce(undefined);
    render(<VerifyEmailPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', '/login');
    });
  });

  /**
   * Regression: the effect runs on mount and does not retry. A failed verification is
   * a dead single-use token, so re-firing the effect would spend a second attempt on
   * the same link and overwrite the legible reason with a second, worse one.
   */
  it('does not re-verify after a failure on a later render', async () => {
    verifyEmail.mockRejectedValue(new Error('Verification token has expired'));
    const { rerender } = render(<VerifyEmailPage />);
    await settle();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText('Verification token has expired')).toBeInTheDocument();
    });

    await rerenderLater(rerender);

    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Verification token has expired')).toBeInTheDocument();
  });
});
