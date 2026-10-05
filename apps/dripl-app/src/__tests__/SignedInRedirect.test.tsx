import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `components/landing/SignedInRedirect.tsx` renders nothing at all. Its entire
 * job is a redirect, and the redirect happens after hydration so the landing
 * page can stay a static prerender — see the module's own comment for why.
 *
 * That trade makes the guard the only interesting thing in the file, and the
 * guard is a conjunction with a null on one side that means two different
 * things:
 *
 *   `user === null` means *nobody is signed in*; the visitor should see the
 *     marketing page.
 *   `user === null` while `loading` is still true means *nobody knows yet*; the
 *     visitor should still see the marketing page, because the overwhelming
 *     majority are not signed in and would never be redirected at all.
 *
 * Both cases end in "do not redirect", which is exactly why a guard that only
 * checked `user` would look correct in the common case: a deleted
 * `!loading &&` produces the same result for a signed-out visitor and a
 * *spurious* redirect for a signed-in one whose session check has not resolved.
 * So every test here asserts both directions — that the redirect happens for a
 * resolved signed-in user, *and* that it does not happen while the check is
 * outstanding — and the effect's dependency list is pinned, because the
 * redirect is fired from an effect and a stale dep list means it never fires at
 * all.
 */

type AuthUser = { id: string; email: string; name: string | null; image: string | null };

const replace = vi.fn();

/**
 * A router with a stable identity.
 *
 * `useRouter()` is in the effect's dependency list, so a mock that returned a
 * fresh object per render would re-run the effect on every render and make the
 * call-count assertions describe the mock rather than the component.
 */
const router = { replace: (...args: unknown[]) => replace(...args) };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

/** Mutable so a test can settle the session check between renders. */
const auth = {
  user: null as AuthUser | null,
  loading: false,
};
vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => auth,
}));

import { SignedInRedirect } from '@/components/landing/SignedInRedirect';

const SIGNED_IN: AuthUser = {
  id: 'u1',
  email: 'ada@dripl.test',
  name: 'Ada',
  image: null,
};

/** The dashboard route the redirect targets, read from the source's own string. */
const DASHBOARD = '/dashboard';

beforeEach(() => {
  replace.mockClear();
  auth.user = null;
  auth.loading = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SignedInRedirect', () => {
  // Regression: the component must render nothing. It is mounted into the static
  // landing page as a side-effect-only client island; any markup it emitted
  // would appear in the first HTML response and be part of the page's identity.
  it('renders nothing at all', () => {
    const { container } = render(<SignedInRedirect />);

    expect(container.innerHTML).toBe('');
    // Not merely empty -- no stray text node either.
    expect(container.textContent).toBe('');
  });

  // Regression: the working direction. A resolved signed-in session must send the
  // visitor onward, and `replace` rather than `push` so Back does not walk them
  // through a page they were already redirected away from.
  it('replaces the landing route with the dashboard once a user is resolved', () => {
    auth.user = SIGNED_IN;
    auth.loading = false;

    render(<SignedInRedirect />);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(DASHBOARD);
  });

  // Regression: the signed-out visitor. This is the majority case and the one the
  // component exists not to disturb -- the landing page has to stay put so it can
  // be indexed. Asserted as its own case rather than inferred from the guard.
  it('leaves a signed-out visitor on the landing page', () => {
    auth.user = null;
    auth.loading = false;

    render(<SignedInRedirect />);

    expect(replace).not.toHaveBeenCalled();
  });

  // Regression: the case that makes the `loading` term load-bearing. A signed-in
  // user whose `/auth/me` has not resolved is reported as `user: null`, so the
  // guard has to consult `loading` to tell "not signed in" from "not known yet".
  // Without it, every signed-in visitor is redirected on first paint and the
  // marketing copy they were served is thrown away.
  it('does not redirect while the session check is still outstanding', () => {
    auth.user = null;
    auth.loading = true;

    render(<SignedInRedirect />);

    expect(replace).not.toHaveBeenCalled();
  });

  // Regression: the dependency list. `loading` is in it because the transition
  // from outstanding to resolved is what fires the redirect: React re-runs the
  // effect when `loading` flips, and `!loading && user` then holds for the first
  // time. Drop `loading` from the deps and the visitor sits on the landing page
  // until something unrelated re-renders.
  it('redirects when the session check settles after the first render', () => {
    auth.user = null;
    auth.loading = true;

    const view = render(<SignedInRedirect />);
    expect(replace).not.toHaveBeenCalled();

    // The same render, with the context reporting a resolved session.
    auth.user = SIGNED_IN;
    auth.loading = false;
    view.rerender(<SignedInRedirect />);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(DASHBOARD);
  });

  // Regression: the guard's two terms are independent, and this is the only
  // state that separates them. With a user already known and the session check
  // still running, `user` alone would redirect and `!loading && user` does not.
  // It is a state the context can report -- `refreshUser` sets `loading` before
  // it replaces `user`, and `login` sets `user` without touching `loading` at
  // all -- so a guard reduced to `if (user)` would throw away the landing page of
  // a visitor who is provably signed in.
  it('does not redirect for a known user while a check is still running', () => {
    auth.user = SIGNED_IN;
    auth.loading = true;

    render(<SignedInRedirect />);

    expect(replace).not.toHaveBeenCalled();
  });

  // Regression: the dependency list, on the transition where *only* `loading`
  // changes. `user` is already set and its identity is unchanged, so an effect
  // keyed on `[router, user]` would not re-run when the check settles -- and the
  // visitor would sit on the landing page with a session in hand. This is the
  // case that separates a correct dependency list from one that merely happens to
  // contain `user`.
  it('redirects when only the loading flag changes for an already-known user', () => {
    auth.user = SIGNED_IN;
    auth.loading = true;

    const view = render(<SignedInRedirect />);
    expect(replace).not.toHaveBeenCalled();

    // Same user object, so nothing in the list but `loading` has changed.
    auth.loading = false;
    view.rerender(<SignedInRedirect />);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(DASHBOARD);
  });

  // Regression: exactly once. A `replace` per re-render -- which is what happens
  // if the effect is left out of its dependency array's discipline, or if a
  // second effect is added alongside -- pushes a navigation on every parent
  // render of the landing page. One settled session, one navigation.
  it('does not redirect again on a re-render with the same session', () => {
    auth.user = SIGNED_IN;
    auth.loading = false;

    const view = render(<SignedInRedirect />);
    view.rerender(<SignedInRedirect />);
    view.rerender(<SignedInRedirect />);

    expect(replace).toHaveBeenCalledTimes(1);
  });

  // Regression: signing out is not a redirect. `user` returning to null must not
  // navigate; and the dependency on `user` is what lets the effect re-run at all
  // when it does, so this is also the control for the dep list above.
  it('does not navigate when a signed-in session is lost', () => {
    auth.user = SIGNED_IN;
    auth.loading = false;

    const view = render(<SignedInRedirect />);
    expect(replace).toHaveBeenCalledTimes(1);

    auth.user = null;
    auth.loading = false;
    view.rerender(<SignedInRedirect />);

    // One call total: the earlier redirect, and nothing since.
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(DASHBOARD);
  });
});
