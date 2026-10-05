import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logError } from '@dripl/common';

/**
 * `components/SWRegistration.tsx` renders nothing and registers a service
 * worker. The whole file is a two-term guard, and both terms have a failure mode
 * that nothing else in the suite would notice:
 *
 *   `'serviceWorker' in navigator` — jsdom has no `serviceWorker`, so in a test
 *     environment the guard is false and the registration never happens unless
 *     the property is defined. The stubs here are therefore per-describe and
 *     removed in `afterEach`; leaving one behind would make the "does not
 *     register" case pass for the wrong reason.
 *   `process.env.NODE_ENV !== 'development'` — the app registers in production
 *     and *test* alike, because a service worker in dev caches the very modules a
 *     developer is editing. Both terms of the conjunction are asserted in both
 *     directions, since either one alone could be dropped and the happy path
 *     would still be green.
 *
 * The failure path matters too: `register()` returns a promise, and an
 * unhandled rejection from it (a missing `/sw.js`, a scope error, an insecure
 * origin) is exactly the kind of thing that surfaces as a console error nobody
 * attributes. `.catch(logError)` is asserted by *identity* — the same `logError`
 * the module imports — so a `catch(() => {})` that merely satisfies the type is
 * caught here.
 */

const logErrorMock = vi.mocked(logError);

vi.mock('@dripl/common', async importOriginal => ({
  ...(await importOriginal<typeof import('@dripl/common')>()),
  logError: vi.fn(),
}));

import { SWRegistration } from '@/components/SWRegistration';

/** A `ServiceWorkerContainer` stub whose `register` resolves or rejects on demand. */
function serviceWorkerStub(register: (script: string) => Promise<unknown>) {
  return { register } as unknown as ServiceWorkerContainer;
}

type Register = (script: string) => Promise<unknown>;

const register = vi.fn<Register>();

/** Define `navigator.serviceWorker`, which jsdom does not provide. */
function withServiceWorker(container: ServiceWorkerContainer) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  });
}

/** Remove the property again, restoring jsdom's `in` answer for it. */
function withoutServiceWorker() {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
}

beforeEach(() => {
  register.mockReset().mockResolvedValue({});
  register.mockClear();
  logErrorMock.mockClear();
  withoutServiceWorker();
});

afterEach(() => {
  withoutServiceWorker();
  vi.unstubAllEnvs();
});

describe('SWRegistration with a service worker available', () => {
  beforeEach(() => {
    withServiceWorker(serviceWorkerStub((script: string) => register(script)));
  });

  // Regression: the working direction. The script path is not `/service-worker.js`
  // or the manifest -- it is the file `public/sw.js` serves at the origin root, and
  // a wrong path registers nothing while failing silently (the promise rejects,
  // `logError` records it, and the app works exactly as it did before).
  it('registers the service worker script at the origin root', async () => {
    render(<SWRegistration />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0]).toEqual(['/sw.js']);
  });

  // Regression: the script is registered relative to the origin, not to the
  // current route. A registration made on `/canvas/abc` would otherwise be
  // scoped to that page and stop controlling it on the next navigation.
  it('registers only once per mount', async () => {
    render(<SWRegistration />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    // The effect has an empty dependency list, so a re-render must not stack up
    // registrations -- each one of which would re-install the worker.
  });

  // Regression: the component renders nothing. It is mounted into the app shell as
  // a side-effect-only island; any markup it emitted would land in the shell.
  it('renders nothing at all', () => {
    const { container } = render(<SWRegistration />);

    expect(container.innerHTML).toBe('');
  });

  // Regression: the failure path. `.catch(logError)` is what keeps a rejected
  // registration from becoming an unhandled rejection, and it reports through the
  // repo's logging boundary rather than the console.
  it('reports a failed registration through the logging boundary', async () => {
    const failure = new Error('scope is not covered by this document');
    register.mockRejectedValueOnce(failure);

    render(<SWRegistration />);

    await waitFor(() => expect(logErrorMock).toHaveBeenCalledTimes(1));
    expect(logErrorMock).toHaveBeenCalledWith(failure);
    // A rejected registration must not take the mount down with it: the effect
    // returning normally is what keeps the rest of the shell alive.
    expect(register).toHaveBeenCalledTimes(1);
  });

  // Regression: a *successful* registration must not be logged as an error. A
  // `catch` attached where it should not be -- or a `.then(logError)` -- would
  // report every successful install, which trains everyone to ignore the log.
  it('logs nothing when the registration succeeds', async () => {
    render(<SWRegistration />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  // Regression: the effect is not re-run on a re-render. Its dependency list is
  // empty because there is nothing to depend on -- `navigator` and
  // `process.env.NODE_ENV` are both ambient. If the list grew to include
  // something unstable, every parent render of the app shell would re-register.
  it('does not register again when the shell re-renders', async () => {
    const view = render(<SWRegistration />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));

    view.rerender(<SWRegistration />);
    view.rerender(<SWRegistration />);

    expect(register).toHaveBeenCalledTimes(1);
  });

  // Regression: unmounting must not leave a pending registration behind that
  // reports into a component that is gone. The rejection is still logged -- that
  // is the point -- but nothing is rendered either way, so the observable claim
  // is that the mount tears down cleanly.
  it('survives an unmount while the registration is still pending', async () => {
    let release: () => void = () => {};
    register.mockReturnValueOnce(
      new Promise<void>(resolve => {
        release = resolve;
      })
    );

    const view = render(<SWRegistration />);
    view.unmount();
    release();

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe('SWRegistration without a service worker', () => {
  // Regression: the `'serviceWorker' in navigator` term. Browsers without service
  // worker support -- or an insecure origin, where the property is absent -- must
  // not throw. `navigator.serviceWorker` here is genuinely undefined, which is
  // jsdom's default and therefore the case the guard exists for.
  it('does nothing when the browser has no service worker', () => {
    expect('serviceWorker' in navigator).toBe(false);

    const { container } = render(<SWRegistration />);

    expect(container.innerHTML).toBe('');
    expect(register).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  // A note on what is deliberately *not* tested here: the case of
  // `serviceWorker` being present but nullish. It cannot happen. The WebIDL is
  // `[SecureContext, SameObject] readonly attribute ServiceWorkerContainer
  // serviceWorker` on `partial interface Navigator` (Service Workers spec
  // §3.3), and a `[SecureContext]` member is not exposed at all on a non-secure
  // context -- so `in` answers false there, which is the case above. Stubbing
  // the property to `undefined` while keeping it present therefore describes no
  // browser, and asserting on it would only ever describe the stub. (The
  // component would in fact throw on such a stub: it calls `.register` on the
  // value without re-checking it. That is not a bug to fix here -- it is
  // unreachable -- and the trade is deliberate: a defensive second check would
  // cost a line to guard a state no engine produces.)
});

describe('SWRegistration in development', () => {
  beforeEach(() => {
    withServiceWorker(serviceWorkerStub((script: string) => register(script)));
  });

  // Regression: the `NODE_ENV` term, and the reason it exists. A registered
  // worker serves the *previously cached* modules, so in development every code
  // change a developer makes appears not to have taken effect until they clear
  // site data by hand. Skipping the registration is the fix, and dropping the
  // condition is a bug that only shows up as confusion.
  it('does not register in development even when a service worker is available', () => {
    vi.stubEnv('NODE_ENV', 'development');

    const { container } = render(<SWRegistration />);

    expect(container.innerHTML).toBe('');
    expect(register).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  // The control for the test above: the same environment with the guard satisfied
  // does register. Without it, "does not register" would be satisfied by a
  // component that never registers anything.
  it('registers outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');

    render(<SWRegistration />);

    // Registration is fire-and-forget, so this waits on the observable call
    // rather than on a timer.
    return waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });
});
