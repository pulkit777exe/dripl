import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `instrumentation.ts` -- the one function Next calls once per server process, at
 * boot, before anything else.
 *
 * It has no application logic, which is exactly why it is easy to leave untested:
 * the consequences show up as a boot-time crash or a silently missing
 * initialisation, both noticed late. Three decisions live here:
 *
 *   runtime split -- Node and Edge are built as separate bundles, so importing the
 *      wrong config either breaks the build or leaves one runtime's Sentry
 *      unconfigured. Both branches are asserted by *which* config module was
 *      actually loaded.
 *   DATABASE_URL gate -- the Prisma client is initialised only when a database URL
 *      is configured, because an unconfigured deployment still has to boot.
 *   onRequestError -- Next 16 calls this for every unhandled route error, and it is
 *      wired straight to Sentry's capture. `export const x = fn` leaves no
 *      alternative implementation to drift towards, so what matters is that the
 *      export *is* Sentry's function, by identity.
 *
 * The configs are replaced with `vi.doMock` keyed on a path derived from
 * `import.meta.url`. Two reasons, both learned the hard way here:
 *
 *   - A relative `vi.mock('../sentry.server.config')` does **not** intercept the
 *     `import('./sentry.server.config')` inside `instrumentation.ts`. Vitest keys
 *     mocks by the resolved module id, and the two specifiers do not resolve to
 *     one id. The absolute path is the id both specifiers agree on.
 *   - `vi.doMock` per test, with `vi.resetModules()`, because a top-level mock is
 *     evaluated once and cached: the *first* test would see the load and every
 *     later one would see an empty log, which reads exactly like a branch that
 *     never runs. Re-importing `register` per test is what makes the observation
 *     per-test.
 */

const sentryCaptureRequestError = vi.hoisted(() =>
  // The real signature is `(error, request, errorContext) => void`, where `request`
  // is Sentry's vendored `RequestInfo` -- `{ path, method, headers }`, not a DOM
  // `Request`. Typing the mock that way is what keeps the assertion below honest
  // about what Next actually passes.
  vi.fn<(error: unknown, request: RequestInfo, errorContext: ErrorContext) => void>()
);

type RequestInfo = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

vi.mock('@sentry/nextjs', () => ({
  captureRequestError: sentryCaptureRequestError,
  // The real config modules call `Sentry.init` at import time. They are replaced
  // below, so this is only a guard in case a replacement stops resolving -- and a
  // no-op rather than a throwing stub, so a mis-wired test fails on its own
  // assertions rather than on an unrelated missing export.
  init: vi.fn(),
}));

const initializeDb = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock('@dripl/db', () => ({ initializeDb }));

/** Records which config module `register()` pulled in, per test. */
const imported: string[] = [];

/**
 * A single causal-order log, written by whichever mock is active.
 *
 * `null` outside a test that cares about ordering; the config mock records into it
 * only when set, so tests that assert `imported` are unaffected.
 */
let orderLog: string[] | null = null;

const SERVER_CONFIG = new URL('../../sentry.server.config.ts', import.meta.url).pathname;
const EDGE_CONFIG = new URL('../../sentry.edge.config.ts', import.meta.url).pathname;

/**
 * `register` with both configs replaced.
 *
 * `vi.resetModules()` in `beforeEach` plus a fresh `import` here is what makes the
 * import log per-test rather than once-per-file.
 */
async function loadRegister(): Promise<() => Promise<void>> {
  vi.doMock(SERVER_CONFIG, () => {
    imported.push('sentry.server.config');
    orderLog?.push('server-config');
    return {};
  });
  vi.doMock(EDGE_CONFIG, () => {
    imported.push('sentry.edge.config');
    orderLog?.push('edge-config');
    return {};
  });
  const instrumentation = await import('@/instrumentation');
  return instrumentation.register;
}

const originalRuntime = process.env.NEXT_RUNTIME;
const originalDatabaseUrl = process.env.DATABASE_URL;

describe('register', () => {
  beforeEach(() => {
    // Reset *all* state a test reads: the import log, the module registry, the db
    // call log and its implementation, and both env vars. A `NEXT_RUNTIME` left at
    // 'edge' makes every later assertion about the Node branch pass for the wrong
    // reason, and a `mockRejectedValueOnce` left queued would make a later test
    // fail for the wrong reason too.
    imported.length = 0;
    orderLog = null;
    vi.resetModules();
    initializeDb.mockReset();
    initializeDb.mockResolvedValue(undefined);
    sentryCaptureRequestError.mockClear();
  });

  afterEach(() => {
    vi.doUnmock(SERVER_CONFIG);
    vi.doUnmock(EDGE_CONFIG);
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  // Regression: the runtime split. Asserted by the import log rather than by "it
  // did not throw", which a no-op implementation would also satisfy.
  it('loads the server config in the nodejs runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.DATABASE_URL;

    await (
      await loadRegister()
    )();

    expect(imported).toContain('sentry.server.config');
    expect(imported).not.toContain('sentry.edge.config');
  });

  it('loads the edge config in the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    delete process.env.DATABASE_URL;

    await (
      await loadRegister()
    )();

    expect(imported).toContain('sentry.edge.config');
    expect(imported).not.toContain('sentry.server.config');
  });

  // Regression: an unrecognised runtime must load *neither*. Loading both would
  // initialise Sentry twice in a bundle that supports only one, and the failure
  // shows up as duplicate events rather than as an error.
  it.each([
    ['an unset runtime', undefined],
    ['an unrecognised runtime', 'workerd'],
    ['an empty runtime', ''],
  ])('loads no config for %s', async (_label, runtime) => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;

    await (
      await loadRegister()
    )();

    expect(imported).toEqual([]);
  });

  // Regression: the DATABASE_URL gate. An unconfigured deployment still has to
  // boot, so a missing URL must skip the database *without* skipping the Sentry
  // config -- those are separate lines guarding separate concerns.
  it('initialises the database on nodejs when DATABASE_URL is configured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dripl';

    await (
      await loadRegister()
    )();

    expect(initializeDb).toHaveBeenCalledTimes(1);
    expect(imported).toEqual(['sentry.server.config']);
  });

  it.each([
    ['a missing URL', undefined],
    ['an empty URL', ''],
  ])('boots without the database when there is %s', async (_label, url) => {
    process.env.NEXT_RUNTIME = 'nodejs';
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;

    await (
      await loadRegister()
    )();

    expect(initializeDb).not.toHaveBeenCalled();
    // The Sentry config is still loaded: an unconfigured database is not a reason
    // to go blind to boot-time errors.
    expect(imported).toEqual(['sentry.server.config']);
  });

  // Regression: the edge runtime has no Prisma client, so the import must not be
  // reachable there. Asserted through the call count rather than through the
  // import log, because the two would otherwise look identical if the gate were
  // dropped and `@dripl/db` happened to be already cached.
  it('never touches the database in the edge runtime, even with a URL configured', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dripl';

    await (
      await loadRegister()
    )();

    expect(initializeDb).not.toHaveBeenCalled();
  });

  // Regression: the `await`. Both the import and the initialisation are async, and
  // Next does not block the first request on the returned promise. A missing
  // `await` lets early requests through with no database client, which surfaces as
  // a query failure rather than as a boot error.
  //
  // Proved by *causal order* rather than by a timer: the db mock and the config
  // mock each push onto one log, so the assertion is that the config import cannot
  // happen before the initialisation settles. Waiting "a bit and see" would not
  // separate the two -- microtasks drain before any timer callback, so the un-awaited
  // path always reaches the config import first, and the gate is released only
  // after the db call has been *observed*.
  it('loads the config only after the database initialisation has settled', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dripl';
    const order: string[] = [];
    orderLog = order;
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    initializeDb.mockImplementation(async () => {
      order.push('db-start');
      await gate;
      order.push('db-settled');
    });
    const register = await loadRegister();

    const pending = register().then(() => {
      order.push('register-resolved');
    });

    await vi.waitFor(() => expect(initializeDb).toHaveBeenCalledTimes(1));
    // The gate is still closed here. An implementation that fired the config import
    // without awaiting would have logged it already, because a mocked dynamic
    // import resolves in microtasks and microtasks drain before the timer that
    // `waitFor` polls on.
    expect(order).toEqual(['db-start']);

    release();
    await pending;

    // The config import is logged between the two, so the full order is asserted
    // explicitly rather than as a `toContain` -- the point is that it sits *after*
    // `db-settled`, not merely that it happened.
    expect(order).toEqual(['db-start', 'db-settled', 'server-config', 'register-resolved']);
    expect(imported).toEqual(['sentry.server.config']);
    orderLog = null;
  });

  // Regression: the rejection is propagated. Swallowing it would boot a process
  // with no database client and report every later query as a failure.
  it('propagates a database initialisation failure rather than swallowing it', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dripl';
    initializeDb.mockRejectedValue(new Error('DATABASE_URL is unreachable'));

    const register = await loadRegister();

    await expect(register()).rejects.toThrow('DATABASE_URL is unreachable');
    expect(imported).toEqual([]);
  });

  it('is safe to call with neither env var set', async () => {
    delete process.env.NEXT_RUNTIME;
    delete process.env.DATABASE_URL;

    const register = await loadRegister();

    await expect(register()).resolves.toBeUndefined();
    expect(initializeDb).not.toHaveBeenCalled();
  });
});

describe('onRequestError', () => {
  beforeEach(() => {
    sentryCaptureRequestError.mockClear();
  });

  it('is Sentry captureRequestError itself, by identity', async () => {
    // `export const onRequestError = Sentry.captureRequestError` is the whole
    // implementation, so a wrapper is the thing to catch: one that swallowed the
    // error, retried it, or renamed the event.
    const { onRequestError } = await import('@/instrumentation');

    expect(onRequestError).toBe(sentryCaptureRequestError);
  });

  it('forwards the error, the request and the router context unchanged', async () => {
    const { onRequestError } = await import('@/instrumentation');
    const error = new Error('route exploded');
    // Sentry's `RequestInfo`, which is what Next hands the hook -- not a DOM
    // `Request`. A plain object would pass this assertion while proving nothing
    // about the real call shape.
    const request: RequestInfo = {
      path: '/dashboard',
      method: 'GET',
      headers: { accept: 'text/html' },
    };
    const errorContext: ErrorContext = {
      routerKind: 'App Router',
      routePath: '/dashboard',
      routeType: 'render',
    };

    const result = onRequestError(error, request, errorContext);

    expect(sentryCaptureRequestError).toHaveBeenCalledTimes(1);
    expect(sentryCaptureRequestError.mock.calls[0]![0]).toBe(error);
    expect(sentryCaptureRequestError.mock.calls[0]![1]).toBe(request);
    expect(sentryCaptureRequestError.mock.calls[0]![2]).toBe(errorContext);
    // Sentry's hook is void, and the alias must not turn it into something else.
    expect(result).toBeUndefined();
  });
});
