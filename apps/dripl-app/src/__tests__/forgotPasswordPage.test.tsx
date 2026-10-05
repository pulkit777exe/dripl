import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * `/forgot-password` is where someone who cannot sign in goes to ask for a reset link,
 * and **none of its 16 statements had ever run**.
 *
 * `useAuth().forgotPassword` is pinned by `AuthContext.test.tsx`, so what is under test
 * here is this page's own logic, and it has four parts that can each fail alone:
 *
 *   - the **gate**: `disabled={status === 'loading' || !email}`. An empty address is
 *     guaranteed to be refused, and the refusal is visible to whoever is spamming this
 *     endpoint, so the empty submit has to be stopped before the call.
 *   - the **success swap**: the whole form is *replaced*, not annotated. That matters
 *     more here than on `/reset-password`, because this is the page people open on a
 *     borrowed or shared machine.
 *   - the **failure banner**: the server's words have to reach the screen rather than a
 *     generic apology, because the realistic refusals differ — rate-limited versus no
 *     such account — and the user's next step differs with them.
 *   - the **shake reset**: `AuthShell` calls `onErrorShake` ~280ms after an error, which
 *     this page wires to `setStatus('idle')`. That is the *only* thing that clears
 *     `isError`, and its absence is visible as a shell stuck in the red style after the
 *     animation has finished. `AuthShell` is the real component here (mocking it would
 *     delete the very wiring under test), so the shake reset is asserted through the
 *     `is-error` class it removes.
 */

const forgotPassword = vi.hoisted(() => vi.fn<(email: string) => Promise<void>>());

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ forgotPassword }) }));

import ForgotPasswordPage from '@/app/forgot-password/page';

/**
 * Deliberately **mixed case**. A handler that normalised the address before sending it
 * (`email.toLowerCase()`) would be indistinguishable from one that sent it verbatim if
 * every fixture here were lowercase — and normalising is a real change, because the
 * server is what decides whether `Ada@` and `ada@` are the same account. Real addresses
 * are typed with capitals, so the fixture is too.
 */
const EMAIL = 'Ada.Lovelace@Dripl.Test';

/**
 * The "Email" label is not associated with its input: no `htmlFor`, no `id` on the
 * input, and the label does not wrap it. The field therefore has no accessible name and
 * `getByLabelText` cannot reach it, and it carries no placeholder either.
 * `/login` does associate its labels; this page does not. Queried by `type` instead; the
 * missing association is reported, not fixed.
 */
function emailField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[type="email"]');
  if (field === null) throw new Error('the reset-request form did not render an email input');
  return field;
}

/** Matches either the idle or the in-flight label, so it works in both states. */
function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: /send reset link|sending link/i });
}

function form(): HTMLFormElement {
  const found = emailField().closest('form');
  if (found === null) throw new Error('the reset-request form did not render a <form>');
  return found;
}

function typeEmail(value = EMAIL) {
  fireEvent.change(emailField(), { target: { value } });
}

/** Lets already-resolved promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

async function submit() {
  fireEvent.click(submitButton());
  await settle();
}

/** A request promise that stays pending until the returned release is called. */
function pendingRequest(): { release: () => void } {
  const handle = { release: () => {} };
  forgotPassword.mockReturnValueOnce(
    new Promise<void>(resolve => {
      handle.release = () => resolve();
    })
  );
  return handle;
}

/** The `AuthShell` element that carries `is-error`. */
function shellInput(): HTMLElement {
  const shell = document.querySelector<HTMLElement>('.t-input');
  if (shell === null) throw new Error('the auth shell did not render');
  return shell;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgotPassword.mockResolvedValue(undefined);
});

afterEach(() => {
  // A failure arms `AuthShell`'s 280ms shake timer, and RTL's automatic cleanup unmounts
  // without cancelling it — a leaked timer would fire mid-way through a later test and
  // call a `setStatus` on an unmounted component.
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('/forgot-password — the request form', () => {
  /**
   * Regression: `disabled={... || !email}` is what keeps an empty address off the wire.
   * `required` is the other half, and both are pinned separately because they are
   * independent protections — dropping one leaves the page asking the server to send mail
   * to nobody.
   */
  it('will not send a request without an address', async () => {
    render(<ForgotPasswordPage />);

    expect(submitButton()).toBeDisabled();
    await submit();

    expect(forgotPassword).not.toHaveBeenCalled();
  });

  /** The control for the test above: one character typed and the same click submits. */
  it('sends as soon as an address is typed', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    expect(submitButton()).toBeEnabled();
    await submit();

    expect(forgotPassword).toHaveBeenCalledWith(EMAIL);
  });

  /**
   * Regression: the field is controlled on `email`, and the *value typed* is what is
   * sent — not a normalised version of it, and not a hard-coded or trimmed one. A handler
   * that read the live DOM element instead of the state would still be right on the first
   * submit and wrong on any subsequent one React had not yet re-rendered for; a handler
   * that lower-cased the address would be wrong always, and silently, because the server
   * is what decides whether `Ada@` and `ada@` are one account. The fixture is mixed case
   * precisely so the normalisation cannot hide.
   */
  it('sends exactly the typed address it shows', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();
    const shown = emailField().value;

    await submit();

    expect(forgotPassword).toHaveBeenCalledTimes(1);
    // Asserted against the value read out of the DOM *before* submitting, so a handler
    // that read the live element and one that read state are equally satisfied — the two
    // are indistinguishable from outside, and this page's contract is only that they
    // agree. The failure this guards is a third source: a hard-coded or trimmed address
    // that never came from either.
    expect(shown).toBe(EMAIL);
    expect(forgotPassword).toHaveBeenCalledWith(shown);
  });

  /**
   * Regression: `required` on the field. This is what stops an empty submit that arrives
   * without the button — an Enter key in the field, or a programmatic
   * `form.requestSubmit()`. Asserted on the attribute because jsdom runs constraint
   * validation for `requestSubmit` only, not for a dispatched `submit` event, which is
   * what the LABELLED test below shows is then exposed.
   */
  it('marks the address field required', () => {
    render(<ForgotPasswordPage />);

    expect(emailField()).toBeRequired();
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleSubmit` has no `if (!email)` guard of its own, so every protection against an
   * empty address lives outside the handler: `disabled={!email}` on the button, and the
   * `required` attribute the browser honours. This test dispatches `submit` on the form,
   * which bypasses the disabled button, and jsdom does not run constraint validation for
   * a dispatched event — so the request genuinely goes out with an empty address. In a
   * browser the `required` attribute is what closes this, which is why the test above
   * pins it. Reported, not fixed: adding the guard turns this test red, which is the
   * point. (`resetPasswordPage.test.tsx` labels the identical shape on `/reset-password`.)
   */
  it('reaches the API with an empty address when the form is submitted directly', async () => {
    render(<ForgotPasswordPage />);

    fireEvent.submit(form());
    await settle();

    expect(forgotPassword).toHaveBeenCalledWith('');
  });

  /**
   * The control for the LABELLED test above, and the one that shows `handleSubmit` does
   * fire for a form-level submit at all: same dispatch, address filled, and the API sees
   * the real value.
   */
  it('submits through the form itself once an address is typed', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    fireEvent.submit(form());
    await settle();

    expect(forgotPassword).toHaveBeenCalledWith(EMAIL);
  });

  /**
   * Regression: `event.preventDefault()` in `handleSubmit`. Without it the browser
   * performs its default submission — a full page POST to the current URL, which would
   * put the typed address into the page request body and reload the form. Asserted on
   * `dispatchEvent`'s return value (false ⇔ `preventDefault` was called) because in jsdom
   * the navigation itself is not implemented and nothing else observes it.
   */
  it('cancels the browser default so the form never navigates', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    expect(fireEvent.submit(form())).toBe(false);
    await settle();
  });

  /**
   * Regression: the field is `type="email"`. Asserted so that a future change to
   * `type="text"` cannot land unnoticed — this is a *mail* address going to a server that
   * will send mail to it, and the browser's own validation is part of what stands between
   * a typo and an email that never arrives.
   */
  it('asks for an email address, not free text', () => {
    render(<ForgotPasswordPage />);

    expect(emailField()).toHaveAttribute('type', 'email');
  });

  /**
   * Regression: this is the only exit for someone who has decided against a reset, and it
   * is on the idle form. Without it a visitor who arrived here by mistake is stuck. The
   * href is asserted because "Back to login" as text proves nothing about where it goes.
   */
  it('offers a way back to sign in', () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  /**
   * Regression: `{error && (<div className="… t-error-msg">{error}</div>)}`. The guard is
   * load-bearing: `error` is initialised to `''`, and while it is falsy React renders
   * *nothing* — whereas a banner rendered unconditionally would paint an empty red box
   * above a perfectly healthy form, so the one page a user reaches when nothing is wrong
   * would open with an error on it. Asserted as an absence on the base render with **no**
   * override in play, and against the class hook itself rather than against text, because
   * the text is empty either way and `not.toBeNull()` is the only thing that separates
   * "no banner" from "banner with nothing in it".
   */
  it('renders no error banner before anything has failed', () => {
    render(<ForgotPasswordPage />);

    expect(document.querySelector('.t-error-msg')).toBeNull();
  });

  /**
   * The control for the test above, and the reason its absence assertion can be trusted:
   * the same element, with the same class, exists the moment a request is refused. So a
   * build whose banner selector changed, or whose class hook were renamed, fails here even
   * though it would satisfy the absence check above.
   */
  it('renders the same banner element once a request is refused', async () => {
    forgotPassword.mockRejectedValue(new Error('No account found for that email.'));
    render(<ForgotPasswordPage />);
    typeEmail();
    expect(document.querySelector('.t-error-msg')).toBeNull();

    await submit();

    expect(document.querySelector('.t-error-msg')).not.toBeNull();
    expect(document.querySelector('.t-error-msg')?.textContent).toBe(
      'No account found for that email.'
    );
  });

  /**
   * Regression: no banner while the request is merely in flight. `status` is `'loading'`,
   * not `'error'`, so `error` is still `''` — the same reason as the test above, asserted
   * at the moment a user is most likely to believe something went wrong (nothing appears,
   * the button is disabled).
   */
  it('renders no error banner while the request is in flight', async () => {
    const { release } = pendingRequest();
    render(<ForgotPasswordPage />);
    typeEmail();

    fireEvent.click(submitButton());
    await settle();

    expect(submitButton()).toBeDisabled();
    expect(document.querySelector('.t-error-msg')).toBeNull();

    await act(async () => release());
  });
});

describe('/forgot-password — the request in flight', () => {
  /**
   * Regression: `disabled={status === 'loading'}` plus the "Sending link..." label are
   * the only feedback that a request is running. Without them the user re-clicks a button
   * that looks idle and sees nothing happen — and on this endpoint a re-send is a real
   * cost, since repeated requests are rate-limited.
   */
  it('disables the control and swaps its label while the request is in flight', async () => {
    const { release } = pendingRequest();
    render(<ForgotPasswordPage />);
    typeEmail();

    fireEvent.click(submitButton());
    await settle();

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent(/sending link/i);
    // The form is still the one on screen: nothing has been decided yet.
    expect(emailField()).toBeInTheDocument();

    await act(async () => release());

    expect(screen.getByText(/Reset link sent/i)).toBeInTheDocument();
  });

  /**
   * Regression: the `disabled` attribute is what makes a second, later click inert. Drop
   * it and an impatient user fires a second request from the same page — which on a
   * rate-limited endpoint earns them a refusal for the request they were waiting on, and
   * this page shows that refusal instead of the confirmation.
   */
  it('does not fire a second request for a click made while the first is in flight', async () => {
    const { release } = pendingRequest();
    render(<ForgotPasswordPage />);
    typeEmail();

    fireEvent.click(submitButton());
    await settle();
    fireEvent.click(submitButton());
    await settle();

    expect(forgotPassword).toHaveBeenCalledTimes(1);

    await act(async () => release());
  });

  /**
   * LABELLED — known gap, pinned as it behaves today, not as it should behave.
   *
   * `handleSubmit` has no same-tick latch (the `inFlightRef` pattern `DashboardFiles`
   * uses, and the same gap `loginPage.test.tsx` and `resetPasswordPage.test.tsx` label).
   * `disabled` is not in the DOM until React re-renders, so two submits inside one batch
   * both reach the handler and both call `forgotPassword`. A real double click lands in
   * separate ticks, so this is a narrow window rather than a live bug — but it is the
   * window an autofill-assisted or programmatic submit falls into, and on a rate-limited
   * endpoint the second request is the one that gets refused. Adding the ref latch turns
   * this test red, which is the point.
   */
  it('fires one request per same-tick double submit', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    act(() => {
      fireEvent.click(submitButton());
      fireEvent.click(submitButton());
    });
    await settle();

    expect(forgotPassword).toHaveBeenCalledTimes(2);
  });
});

describe('/forgot-password — a link that was sent', () => {
  /**
   * Regression: the form is *replaced* by the confirmation, not annotated. This is the
   * page people open on a borrowed machine, so leaving the typed address in a live input
   * after the request has been sent keeps a piece of their identity on screen for
   * whoever uses the machine next.
   */
  it('replaces the form with a confirmation and takes the field away', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    expect(
      screen.getByText('Reset link sent. Check your inbox and spam folder.')
    ).toBeInTheDocument();
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
  });

  /**
   * Regression: the confirmation tells the user to look in **both** the inbox and the spam
   * folder. Dropping the spam-folder half turns a successful request into a silent
   * "it did nothing" for a large fraction of users, and this endpoint's whole value is
   * that the mail arrives.
   */
  it('tells the user to check the spam folder as well', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    expect(screen.getByText(/spam folder/i)).toBeInTheDocument();
  });

  /**
   * Regression: the success branch offers exactly one way on — `/login`. A build that
   * also left the "Remember your password? Sign in" footer from the form branch would
   * render two links to the same place, and one that kept the form's submit button would
   * make it look as though the request could be sent again from a page that says it has.
   */
  it('offers one route onwards, to sign in', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /back to login/i })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * Regression: a success must not carry an error banner. Both branches are keyed on
   * `status`, so a stale `error` string left over from an earlier attempt would render the
   * red banner *above* the green confirmation — telling the user their request both
   * worked and failed.
   */
  it('shows no error banner after a success', async () => {
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    expect(document.querySelector('.t-error-msg')).toBeNull();
    expect(screen.queryByText(/failed to submit request/i)).not.toBeInTheDocument();
  });
});

describe('/forgot-password — a refused request', () => {
  it.each([
    ['rate limited', 'Too many requests. Try again later.'],
    ['an unknown address', 'No account found for that email.'],
    ['an API failure', 'Internal server error'],
  ])(
    /**
     * Regression: the whole point of the `catch`. The realistic refusals here differ — a
     * rate limit means "wait", an unknown address means "sign up or use a different one" —
     * so the server's own words have to reach the screen rather than a generic apology
     * that would tell a rate-limited user to check an inbox that will stay empty.
     */
    'shows the message the server refused with when it is %s',
    async (_label, message) => {
      forgotPassword.mockRejectedValue(new Error(message));
      render(<ForgotPasswordPage />);
      typeEmail();

      await submit();

      const banner = screen.getByText(message);
      expect(banner).toBeInTheDocument();
      // The styling hook `/reset-password` uses too, so both request forms read alike.
      expect(banner.closest('.t-error-msg')).not.toBeNull();
    }
  );

  /**
   * Regression: `err instanceof Error ? err.message : 'Failed to submit request.'`. A
   * bare rejection (a thrown string, an exotic `fetch` failure) has no `.message`, so
   * without the guard the banner renders as an empty red box and the user is told nothing
   * about why their request did nothing.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    forgotPassword.mockRejectedValue('kaboom');
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    expect(screen.getByText('Failed to submit request.')).toBeInTheDocument();
  });

  /**
   * Regression: `status` becomes `'error'`, which is neither `'loading'` nor `'success'`,
   * so the button's `disabled={status === 'loading' || !email}` clears. A handler that left
   * `'loading'` wired to `disabled` would leave the user with no way to react at all —
   * and on this page reacting usually means correcting a typo in the address.
   */
  it('leaves the control usable so the refusal can be acted on', async () => {
    forgotPassword.mockRejectedValue(new Error('No account found for that email.'));
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();
    expect(submitButton()).toBeEnabled();

    typeEmail('ada+retry@dripl.test');
    await submit();

    expect(forgotPassword).toHaveBeenCalledTimes(2);
    expect(forgotPassword).toHaveBeenLastCalledWith('ada+retry@dripl.test');
  });

  /**
   * Regression: a refused request must leave the form in place. Rendering the success
   * branch from a `catch` would tell the user to check an inbox for a mail that was never
   * sent — the worst possible outcome, because it sends them away from the retry they
   * should be making right now.
   */
  it('keeps the form rather than claiming the link was sent', async () => {
    forgotPassword.mockRejectedValue(new Error('No account found for that email.'));
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    expect(screen.queryByText(/Reset link sent/i)).not.toBeInTheDocument();
    expect(emailField()).toBeInTheDocument();
  });

  /**
   * Regression: nothing clears `email` on failure, so a refused address stays in the
   * field and the user can correct one character instead of retyping. Pinned as the
   * behaviour it is: it also means a *correct* address stays on screen, which is the
   * other half of the trade and cannot be asserted from outside the component.
   */
  it('keeps the typed address on screen after a refusal', async () => {
    forgotPassword.mockRejectedValue(new Error('No account found for that email.'));
    render(<ForgotPasswordPage />);
    typeEmail();

    await submit();

    expect(emailField()).toHaveValue(EMAIL);
  });

  /**
   * Regression: the shake reset. `AuthShell` adds `is-shaking`, then ~280ms later removes
   * it and calls `onErrorShake`, which this page wires to `setStatus('idle')`. That call
   * is the *only* thing that clears `isError`, so if `onErrorShake` were dropped, or wired
   * to something that left `status` as `'error'`, the shell would keep `is-error` forever
   * and every subsequent keystroke-free render would stay red. Asserted on the class the
   * shell derives from `isError`, in both directions, with the error banner still on screen
   * so the two states cannot be confused.
   */
  it('returns the shell out of its error style once the shake is over', async () => {
    vi.useFakeTimers();
    try {
      forgotPassword.mockRejectedValue(new Error('No account found for that email.'));
      render(<ForgotPasswordPage />);
      typeEmail();

      fireEvent.click(submitButton());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Mid-shake: the error style is applied and the banner is up.
      expect(shellInput()).toHaveClass('is-error');
      expect(screen.getByText('No account found for that email.')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      // `AuthShell` calls `onErrorShake` after `80*2 + 60*2 + 20`ms; the page resets
      // `status` to `'idle'`, so `isError` goes false and the class comes off.
      expect(shellInput()).not.toHaveClass('is-error');
      // And the banner stays: the *request* failed, only the styling recovered.
      expect(screen.getByText('No account found for that email.')).toBeInTheDocument();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  /**
   * The control for the shake-reset test above: the error style is *not* cleared early,
   * and it is applied at all. Without these two facts, "the class is absent after 400ms"
   * would be satisfied by a page that never applied it — which is what a build with
   * `isError` hard-coded to `false` would look like.
   */
  it('applies the error style only while the shake is running', async () => {
    vi.useFakeTimers();
    try {
      forgotPassword.mockRejectedValue(new Error('No account found for that email.'));
      render(<ForgotPasswordPage />);
      typeEmail();

      // Nothing has failed yet, so the shell is in its idle style.
      expect(shellInput()).not.toHaveClass('is-error');

      fireEvent.click(submitButton());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(shellInput()).toHaveClass('is-error');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Still inside `80*2 + 60*2 + 20`ms, so the reset has not run yet.
      expect(shellInput()).toHaveClass('is-error');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  /**
   * Regression: the idle form must not be red before anything has failed. Asserted on the
   * base render with no override, so it cannot be satisfied by a conflicting state — the
   * `is-error` class is present only when `status === 'error'`, and nothing else in
   * `AuthShell` puts it there.
   */
  it('starts in the shell’s normal style', () => {
    render(<ForgotPasswordPage />);

    expect(shellInput()).not.toHaveClass('is-error');
    expect(shellInput()).toHaveClass('t-input');
  });
});
