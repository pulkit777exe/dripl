import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';

/**
 * `AuthContext` is the app's session authority: every protected route and every
 * "who am I" affordance reads from it. It had **no tests at all**, so all 51 of its
 * uncovered lines had never executed.
 *
 * The behaviour worth pinning is almost entirely about *failure* and about *not
 * lying*. A context that optimistically reports a logged-in user, or that keeps a
 * user visible after a failed logout, does not fail loudly — it fails by showing
 * the wrong thing to a person who believes they are signed in.
 */

const api = {
  me: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  googleLogin: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
};

const push = vi.fn();

vi.mock('@/lib/api', () => ({
  apiClient: {
    me: (...args: unknown[]) => api.me(...args),
    login: (...args: unknown[]) => api.login(...args),
    register: (...args: unknown[]) => api.register(...args),
    logout: (...args: unknown[]) => api.logout(...args),
    googleLogin: (...args: unknown[]) => api.googleLogin(...args),
    forgotPassword: (...args: unknown[]) => api.forgotPassword(...args),
    resetPassword: (...args: unknown[]) => api.resetPassword(...args),
    verifyEmail: (...args: unknown[]) => api.verifyEmail(...args),
    resendVerification: (...args: unknown[]) => api.resendVerification(...args),
    updateProfile: (...args: unknown[]) => api.updateProfile(...args),
    changePassword: (...args: unknown[]) => api.changePassword(...args),
  },
}));

// Stable identity, as the real router has. A fresh object per call would rebuild
// `logout` on every render and make the referential-stability test below fail for
// a reason that is the mock's, not the provider's.
const router = { push: (...args: unknown[]) => push(...args) };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

import { AuthProvider, useAuth } from '@/app/context/AuthContext';

const USER = {
  id: 'u1',
  email: 'a@b.test',
  name: 'Ada',
  image: null,
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Mount the provider and wait for the mount-time session check to settle. */
async function mount() {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.me.mockResolvedValue({ user: USER });
  api.logout.mockResolvedValue(undefined);
});

describe('useAuth outside a provider', () => {
  it('throws a named error rather than handing back undefined', () => {
    // Regression: `useContext` of a default-`undefined` context returns
    // `undefined`, and every field access on it then fails with "cannot read
    // property 'user' of undefined" — pointing at the consuming component rather
    // than at the missing provider. This error names the actual mistake.
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider'
    );
  });
});

describe('AuthProvider session check', () => {
  it('reports loading on its very first render, before the session check resolves', () => {
    // Regression: `loading` starts `true` so a protected route waits for the
    // answer instead of redirecting a signed-in user to /login on every hard
    // refresh. Starting it `false` produces a login-flash on every page load.
    //
    // Asserted from the first render a consumer actually sees, not from
    // `renderHook`'s return value: by the time `renderHook` returns, the mount
    // effect has run and its own `setLoading(true)` has already put it back, so
    // an initial `false` is invisible unless a probe records the values it saw.
    let release: (v: unknown) => void = () => {};
    api.me.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );

    const seen: boolean[] = [];
    function Probe() {
      seen.push(useAuth().loading);
      return null;
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(seen[0]).toBe(true);

    act(() => release({ user: USER }));
  });

  it('exposes the signed-in user once the check succeeds', async () => {
    const { result } = await mount();

    expect(api.me).toHaveBeenCalledTimes(1);
    expect(result.current.user).toEqual(USER);
    expect(result.current.loading).toBe(false);
  });

  it('treats a failed session check as signed out, not as an error', async () => {
    // Regression: the `catch` sets `user` to null rather than rethrowing. A
    // session cookie that has simply expired is the common case, and it must
    // present as "not signed in" — not as a crash on every page.
    api.me.mockRejectedValue(new Error('401'));

    const { result } = await mount();

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears loading even when the session check throws', async () => {
    // Regression: `loading` is cleared in a `finally`. Without it a thrown check
    // leaves `loading` true forever, and every protected route renders its
    // spinner for the rest of the session with no way out.
    api.me.mockRejectedValue(new Error('network down'));

    const { result } = await mount();

    expect(result.current.loading).toBe(false);
  });

  it('checks the session exactly once per mount', async () => {
    // Regression: `refreshUser` is in the effect's dependency array and is a
    // `useCallback` with `[]`. If it were not stable the effect would re-run on
    // every render — a `me()` call per keystroke anywhere in the tree below it.
    const { rerender } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    expect(api.me).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider login and signup', () => {
  it('adopts the user returned by a successful login', async () => {
    api.login.mockResolvedValue({ user: USER });
    const { result } = await mount();

    await act(async () => {
      await result.current.login('a@b.test', 'hunter2');
    });

    expect(api.login).toHaveBeenCalledWith({ email: 'a@b.test', password: 'hunter2' });
    expect(result.current.user).toEqual(USER);
  });

  it('propagates a rejected login so the form can show it', async () => {
    // Regression: there is no `catch` here on purpose. Swallowing it would leave
    // the form looking as though sign-in worked while `user` stayed null.
    // Starts signed out, since that is the state a failed login happens in.
    api.me.mockRejectedValue(new Error('401'));
    api.login.mockRejectedValue(new Error('Invalid credentials'));
    const { result } = await mount();

    await expect(
      act(async () => {
        await result.current.login('a@b.test', 'wrong');
      })
    ).rejects.toThrow('Invalid credentials');

    expect(result.current.user).toBeNull();
  });

  it('adopts the user when signup returns one', async () => {
    api.register.mockResolvedValue({ user: USER, pendingVerification: false });
    const { result } = await mount();

    let returned: { pendingVerification?: boolean } | undefined;
    await act(async () => {
      returned = await result.current.signup('a@b.test', 'hunter2', 'Ada');
    });

    expect(api.register).toHaveBeenCalledWith({
      email: 'a@b.test',
      password: 'hunter2',
      name: 'Ada',
    });
    expect(result.current.user).toEqual(USER);
    expect(returned).toEqual({ pendingVerification: false });
  });

  it('does not adopt a user when signup is pending email verification', async () => {
    // Regression: the server returns no `user` until the address is verified.
    // Writing `response.user` unconditionally would set `user` to `undefined`
    // and every `user?.field` in the app would silently read as signed out while
    // the API believes a session exists.
    api.me.mockRejectedValue(new Error('401'));
    api.register.mockResolvedValue({ pendingVerification: true });
    const { result } = await mount();

    let returned: { pendingVerification?: boolean } | undefined;
    await act(async () => {
      returned = await result.current.signup('a@b.test', 'hunter2');
    });

    expect(returned).toEqual({ pendingVerification: true });
    expect(result.current.user).toBeNull();
  });

  it('does not sign out an existing session when a second signup is pending', async () => {
    // Regression, and the case the test above structurally cannot see: with a
    // null starting user, "did not write" and "wrote null" look identical. The
    // difference only appears when there is a session to lose, so this starts
    // signed in. Writing `response.user` unconditionally would null the user and
    // sign them out because they opened a second signup tab.
    api.me.mockResolvedValue({ user: USER });
    const { result } = await mount();
    expect(result.current.user).toEqual(USER);

    api.register.mockResolvedValue({ pendingVerification: true });
    await act(async () => {
      await result.current.signup('other@b.test', 'hunter2');
    });

    expect(result.current.user).toEqual(USER);
  });
});

describe('AuthProvider logout', () => {
  it('clears the user and returns to the root', async () => {
    const { result } = await mount();
    expect(result.current.user).toEqual(USER);

    await act(async () => {
      await result.current.logout();
    });

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
    expect(push).toHaveBeenCalledWith('/');
  });

  it('clears the user even when the logout request fails', async () => {
    // Regression: the clear-and-navigate sit in a `finally`. This is the whole
    // point of the test — a logout that fails server-side (expired session, no
    // network) must still sign the user out locally. Otherwise the header keeps
    // showing their name and their canvas keeps syncing with a cookie nobody can
    // revoke, and there is no UI anywhere to sign out.
    api.logout.mockRejectedValue(new Error('401 Unauthorized'));
    const { result } = await mount();

    await act(async () => {
      await result.current.logout().catch(() => undefined);
    });

    expect(result.current.user).toBeNull();
    expect(push).toHaveBeenCalledWith('/');
  });

  it('still propagates the failure after signing out', async () => {
    // The control for the test above: `finally` must not swallow the rejection.
    // A caller that needs to report "could not reach the server" depends on this.
    api.logout.mockRejectedValue(new Error('network down'));
    const { result } = await mount();

    await expect(
      act(async () => {
        await result.current.logout();
      })
    ).rejects.toThrow('network down');
  });
});

describe('AuthProvider profile', () => {
  it('replaces the whole user from the update response', async () => {
    // Regression: the response is the authority, not a merge with the cached
    // user. A merge would let a field the server chose to omit keep its stale
    // local value — a renamed account that keeps showing the old name until a
    // hard refresh.
    const renamed = { ...USER, name: 'Ada Lovelace', image: 'https://x.test/a.png' };
    api.updateProfile.mockResolvedValue({ user: renamed });
    const { result } = await mount();

    await act(async () => {
      await result.current.updateProfile('Ada Lovelace', 'https://x.test/a.png');
    });

    expect(result.current.user).toEqual(renamed);
  });

  it('replaces rather than merges, so a field the server omits does not survive', async () => {
    // The control for the test above, and the only way to tell a replacement from
    // a merge. With a complete response the two are identical. `updateProfile`
    // takes `name` and `image` as optionals, so a request that changes one field
    // is the case where the response can legitimately carry fewer keys — and a
    // merge would keep the stale local value for the other, so a user who cleared
    // their avatar would still see it after any other profile edit.
    api.updateProfile.mockResolvedValue({ user: { id: USER.id, email: USER.email } });
    const { result } = await mount();
    expect(result.current.user).toEqual(USER);

    await act(async () => {
      await result.current.updateProfile('Ada Lovelace');
    });

    expect(result.current.user).toEqual({ id: USER.id, email: USER.email });
    // The old name is gone rather than merged through.
    expect(result.current.user?.name).toBeUndefined();
  });

  it('leaves the user alone when a profile update fails', async () => {
    // Regression: there is no `catch`, so a rejected update must leave the
    // previous user intact. Nulling it would sign the user out over a failed
    // avatar upload.
    api.updateProfile.mockRejectedValue(new Error('too large'));
    const { result } = await mount();

    await act(async () => {
      await result.current.updateProfile('Ada Lovelace').catch(() => undefined);
    });

    expect(result.current.user).toEqual(USER);
  });
});

describe('AuthProvider pass-through calls', () => {
  it('forwards every argument verbatim', async () => {
    // Regression: these are one-line wrappers over `apiClient`, and the only way
    // they break is by dropping or renaming an argument — which TypeScript
    // would not catch for a positional call with the same arity, and which shows
    // up as "the reset link does not work". Each is asserted on the exact payload.
    api.googleLogin.mockResolvedValue({ user: USER });
    api.forgotPassword.mockResolvedValue({ ok: true });
    api.resetPassword.mockResolvedValue({ ok: true });
    api.verifyEmail.mockResolvedValue({ message: 'ok' });
    api.resendVerification.mockResolvedValue({ ok: true });
    api.changePassword.mockResolvedValue({ ok: true });

    const { result } = await mount();

    await act(async () => {
      await result.current.googleLogin('google-token');
      await result.current.forgotPassword('a@b.test');
      await result.current.resetPassword('reset-token', 'new-password');
      await result.current.verifyEmail('verify-token');
      await result.current.resendVerification('a@b.test');
      await result.current.changePassword('old-password', 'new-password');
    });

    expect(api.googleLogin).toHaveBeenCalledWith({ token: 'google-token' });
    expect(api.forgotPassword).toHaveBeenCalledWith({ email: 'a@b.test' });
    expect(api.resetPassword).toHaveBeenCalledWith({
      token: 'reset-token',
      password: 'new-password',
    });
    expect(api.verifyEmail).toHaveBeenCalledWith({ token: 'verify-token' });
    expect(api.resendVerification).toHaveBeenCalledWith({ email: 'a@b.test' });
    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
  });

  it('does not touch the session for a password reset', async () => {
    // Regression: resetting a password happens while signed out. If any of these
    // wrappers wrote `user`, a mid-reset navigation would present a half-signed-in
    // state — and a successful reset must not implicitly sign anyone in.
    api.resetPassword.mockResolvedValue({ ok: true });
    const { result } = await mount();
    api.me.mockClear();

    await act(async () => {
      await result.current.resetPassword('t', 'p');
      await result.current.verifyEmail('t');
      await result.current.forgotPassword('a@b.test');
      await result.current.resendVerification('a@b.test');
    });

    expect(result.current.user).toEqual(USER);
    // No re-check was triggered either: these must not re-enter refreshUser.
    expect(api.me).not.toHaveBeenCalled();
  });

  it('adopts the user from a Google sign-in', async () => {
    // Regression: the Google path is the only sign-in that returns a user from a
    // provider token, and it must go through the same `setUser` as password
    // login — otherwise the header renders signed-out on a successful OAuth
    // round trip.
    api.googleLogin.mockResolvedValue({ user: USER });
    const { result } = await mount();

    await act(async () => {
      await result.current.googleLogin('google-token');
    });

    expect(result.current.user).toEqual(USER);
  });

  it('re-checks the session on demand', async () => {
    // Regression: `refreshUser` is exposed so a component can re-read the session
    // (after a cookie is set by an OAuth callback, for instance). It must flip
    // `loading` while it runs and settle either way.
    const { result } = await mount();
    const changed = { ...USER, name: 'Renamed' };
    api.me.mockResolvedValue({ user: changed });

    await act(async () => {
      await result.current.refreshUser();
    });

    expect(result.current.user).toEqual(changed);
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it('signs the user out when an on-demand re-check finds no session', async () => {
    // The control for the test above: `refreshUser` is the one path that turns a
    // *signed-in* context into a signed-out one, and it must not require a reload.
    const { result } = await mount();
    expect(result.current.user).toEqual(USER);

    api.me.mockRejectedValue(new Error('401'));
    await act(async () => {
      await result.current.refreshUser();
    });

    expect(result.current.user).toBeNull();
  });
});

describe('AuthProvider legacy surface', () => {
  it('exposes an inert token surface', async () => {
    // Regression: `token`, `generateToken` and `validateToken` are stubs left in
    // the context's shape for callers that have not migrated. They are pinned as
    // inert on purpose: the dangerous change is someone "fixing" `token` to
    // return the user's id or a JWT and shipping it, so a test that only checked
    // the field existed would not notice. If a caller ever needs a real token,
    // this test must change deliberately rather than by accident.
    const { result } = await mount();

    expect(result.current.token).toBeNull();
    await expect(result.current.generateToken()).resolves.toBe('');
    await expect(result.current.validateToken('anything')).resolves.toBe(false);
  });

  it('keeps the context value referentially stable when nothing changed', async () => {
    // Regression: the `useMemo` dep list omits nothing observable, but a missing
    // dep would rebuild `value` on every render and re-render every consumer of
    // `useAuth` on every keystroke anywhere in the app.
    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });
});
