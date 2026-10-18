import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * Tests the real `public/sw.js`, loaded and executed rather than reimplemented
 * here. That distinction is the point of the file: the worker's entire job is a
 * *policy* about what may be stored, and a test that restates the policy in its
 * own words would keep passing if the shipped script were replaced by the old,
 * unsafe one. These tests load the bytes Next actually serves.
 *
 * The worker is driven through its `fetch` listener with synthetic events, the
 * way a browser drives it. Only the four globals it touches are supplied —
 * `self`, `caches`, `fetch`, and the `Response` constructor it builds its
 * offline body with.
 *
 * The security property under test is narrow and worth naming. `/dashboard`,
 * `/teams/*`, `/settings/*` and `/share/[token]` are Server Components that
 * render one user's file list and membership; Next marks them `private,
 * no-cache, no-store`, and that header is the only thing standing between that
 * body and a cache the next person on a shared machine could read. The previous
 * worker ignored it, and cached the dashboard HTML for anyone. Every "does not
 * store" assertion below is a regression test for that specific bug.
 */

const SW_SOURCE = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');

const ORIGIN = 'https://app.example';
const IMMUTABLE_PREFIX = '/_next/static/';

/** The four listener types the worker registers. */
type Listener = (event: unknown) => void;

interface FakeResponse {
  ok: boolean;
  type: string;
  status: number;
  headers: { get(name: string): string | null };
  body: unknown;
  clone(): FakeResponse;
}

/**
 * A duck-typed Response.
 *
 * Real `Response` objects would work for most cases, but `opaque` cannot be
 * constructed outside a no-cors fetch, and that case needs its own assertion.
 * The worker reads exactly `ok`, `type`, `headers.get` and `clone`, so a stand-in
 * covering those is both sufficient and the only way to reach `opaque`.
 */
function makeResponse(options: {
  status?: number;
  type?: string;
  cacheControl?: string | null;
  body?: unknown;
}): FakeResponse {
  const status = options.status ?? 200;
  const headerMap = new Map<string, string>();
  if (options.cacheControl !== null && options.cacheControl !== undefined) {
    headerMap.set('Cache-Control', options.cacheControl);
  }

  const response: FakeResponse = {
    ok: status >= 200 && status < 300,
    type: options.type ?? 'basic',
    status,
    body: options.body ?? null,
    headers: { get: name => headerMap.get(name) ?? null },
    clone: () => ({ ...response, clone: response.clone }),
  };
  return response;
}

/** A minimal Cache Storage: keyed by URL string, with the worker's real API. */
function makeCaches() {
  const stores = new Map<string, Map<string, FakeResponse>>();
  return {
    stores,
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async match(request: { url: string }) {
          return store.get(request.url);
        },
        async put(request: { url: string }, response: FakeResponse) {
          store.set(request.url, response);
        },
        async keys() {
          return [...store.keys()].map(url => ({ url }));
        },
        async delete(request: { url: string }) {
          return store.delete(request.url);
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
}

/** Execute `public/sw.js` against stubs and hand back what it registered. */
async function loadServiceWorker(options: {
  fetchImpl: (request: { url: string }) => Promise<unknown>;
  initialCaches?: string[];
}) {
  const listeners = new Map<string, Listener[]>();
  const caches = makeCaches();
  for (const name of options.initialCaches ?? []) caches.stores.set(name, new Map());

  const self = {
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };

  const sandbox = {
    self,
    caches,
    fetch: options.fetchImpl,
    Response: globalThis.Response,
    URL: globalThis.URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: 'sw.js' });

  /** Dispatch a `fetch` event and settle whatever the worker answered with. */
  async function dispatchFetch(request: { url: string; method?: string; mode?: string }) {
    const full = { method: 'GET', mode: 'no-cors', ...request };
    let responded: Promise<unknown> | undefined;
    const event = {
      request: full,
      respondWith: (value: unknown) => (responded = value as Promise<unknown>),
    };
    for (const listener of listeners.get('fetch') ?? []) listener(event);
    return responded ? await responded : undefined;
  }

  return { listeners, caches, self, dispatchFetch };
}

const staticAsset = (name: string) => `${ORIGIN}${IMMUTABLE_PREFIX}${name}`;

describe('public/sw.js — what may be stored', () => {
  // The load-bearing assertion. This is the exact response Next sends for
  // `/dashboard`, `/teams/*`, `/settings/*` and `/share/[token]`, and the exact
  // header the old worker ignored before writing that body to Cache Storage.
  it('never stores a response the server marks no-store', async () => {
    const { caches, dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () =>
        makeResponse({
          status: 200,
          cacheControl: 'private, no-cache, no-store, max-age=0, must-revalidate',
        }) as unknown as Response,
    });

    await dispatchFetch({ url: `${ORIGIN}/dashboard` });

    expect(caches.stores.size).toBe(1);
    expect([...caches.stores.values()][0]!.size).toBe(0);
  });

  // `private` alone is the same refusal: a body for one session must not enter
  // a cache every session shares. Asserted separately because a fix that only
  // matched the literal `no-store` would pass the test above.
  it('never stores a response marked private', async () => {
    const { caches, dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () =>
        makeResponse({ status: 200, cacheControl: 'private, max-age=0' }) as unknown as Response,
    });

    await dispatchFetch({ url: `${ORIGIN}/settings/profile` });

    expect([...caches.stores.values()][0]!.size).toBe(0);
  });

  // The old worker cached whatever the network returned, so a transient 502
  // was written and then served as if it were the page.
  it('never stores an unsuccessful response', async () => {
    const { caches, dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () =>
        makeResponse({ status: 502, cacheControl: 'public, max-age=60' }) as unknown as Response,
    });

    await dispatchFetch({ url: `${ORIGIN}/login` });

    expect([...caches.stores.values()][0]!.size).toBe(0);
  });

  // An opaque response has unreadable headers and an unreadable body. Storing
  // one would mean caching bytes nobody in this app has inspected.
  it('never stores an opaque response', async () => {
    const { caches, dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () => makeResponse({ status: 200, type: 'opaque' }) as unknown as Response,
    });

    await dispatchFetch({ url: `${ORIGIN}/maple.webp` });

    expect([...caches.stores.values()][0]!.size).toBe(0);
  });

  // Third-party responses are left to the browser's own cache, so nothing this
  // app owns has to reason about bytes it did not produce. The worker declines
  // the request outright — it never calls fetch and never stores the result.
  it('does not touch cross-origin requests at all', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 200 }) as unknown as Response);
    const { caches, dispatchFetch } = await loadServiceWorker({ fetchImpl });

    const answered = await dispatchFetch({ url: 'https://fonts.gstatic.com/s/inter/x.woff2' });

    expect(answered).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect([...caches.stores.values()].every(store => store.size === 0)).toBe(true);
  });
});

describe('public/sw.js — what is not intercepted', () => {
  // `/api/` is the session's own traffic; the worker must not sit in front of it.
  it('passes /api/ requests straight through', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 200 }) as unknown as Response);
    const { dispatchFetch } = await loadServiceWorker({ fetchImpl });

    const answered = await dispatchFetch({ url: `${ORIGIN}/api/files` });

    expect(answered).toBeUndefined();
  });

  it('passes non-GET requests straight through', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 200 }) as unknown as Response);
    const { dispatchFetch } = await loadServiceWorker({ fetchImpl });

    const answered = await dispatchFetch({ url: `${ORIGIN}/api/files`, method: 'POST' });

    expect(answered).toBeUndefined();
  });
});

describe('public/sw.js — hashed build output', () => {
  // The performance case for the whole worker. These files carry their content
  // hash in the name, so a hit needs no revalidation and no network.
  it('serves a cached immutable asset without hitting the network', async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ status: 200 }) as unknown as Response);
    const { dispatchFetch } = await loadServiceWorker({ fetchImpl });

    const first = (await dispatchFetch({ url: staticAsset('chunk.js') })) as FakeResponse;
    const second = (await dispatchFetch({ url: staticAsset('chunk.js') })) as FakeResponse;

    expect(first.ok).toBe(true);
    // `put` stores `response.clone()`, so a hit is a different object with the
    // same bytes. What matters is that the network was reached exactly once.
    expect(second).toStrictEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stores an immutable asset the first time it is seen', async () => {
    const { caches, dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () =>
        makeResponse({
          status: 200,
          cacheControl: 'public, max-age=31536000, immutable',
        }) as unknown as Response,
    });

    await dispatchFetch({ url: staticAsset('chunk.js') });

    const store = [...caches.stores.values()][0]!;
    expect([...store.keys()]).toEqual([staticAsset('chunk.js')]);
  });
});

describe('public/sw.js — network failure', () => {
  // A navigation is the one case a fallback body helps: the user asked for a
  // page and can be told it is unavailable.
  it('answers a failed navigation with a 503 rather than throwing', async () => {
    const { dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });

    const response = (await dispatchFetch({
      url: `${ORIGIN}/login`,
      mode: 'navigate',
    })) as Response;

    expect(response.status).toBe(503);
  });

  // Asserted against the old behaviour: it answered *every* failure with
  // `new Response('Offline', { status: 503 })`, which made a missing image look
  // like a server outage and cost real time in diagnosing an unrelated bug.
  it('lets a failed subresource failure surface instead of masking it', async () => {
    const { dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });

    await expect(dispatchFetch({ url: staticAsset('chunk.js') })).rejects.toThrow('network down');
  });

  // Offline still works, and only for what was actually stored — which, given
  // the rules above, means a shell page and hashed assets, never a user's
  // dashboard.
  it('falls back to a stored response when the network is gone', async () => {
    let offline = false;
    const { dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () => {
        if (offline) throw new Error('network down');
        return makeResponse({
          status: 200,
          cacheControl: 'public, max-age=60',
        }) as unknown as Response;
      },
    });

    await dispatchFetch({ url: `${ORIGIN}/canvas`, mode: 'navigate' });
    offline = true;
    const response = (await dispatchFetch({
      url: `${ORIGIN}/canvas`,
      mode: 'navigate',
    })) as FakeResponse;

    expect(response.ok).toBe(true);
  });
});

describe('public/sw.js — lifecycle', () => {
  // A cache that is never bounded is a cache that grows until the browser
  // evicts it, which is not a policy. Oldest entries are dropped first.
  it('caps the cache by dropping the oldest entries', async () => {
    const { caches, dispatchFetch } = await loadServiceWorker({
      fetchImpl: async () =>
        makeResponse({ status: 200, cacheControl: 'public, max-age=60' }) as unknown as Response,
    });

    const total = 260;
    for (let i = 0; i < total; i += 1) {
      await dispatchFetch({ url: `${ORIGIN}/asset-${String(i).padStart(4, '0')}.js` });
    }

    const store = [...caches.stores.values()][0]!;
    expect(store.size).toBeLessThanOrEqual(200);
    // The newest survives, which is what makes dropping the oldest safe.
    expect(store.has(`${ORIGIN}/asset-0259.js`)).toBe(true);
    expect(store.has(`${ORIGIN}/asset-0000.js`)).toBe(false);
  });

  // Removing a stale cache on activation is what stops a deploy from leaving
  // the previous build's bytes behind forever.
  it('deletes caches left over by an older worker on activation', async () => {
    const { listeners, caches } = await loadServiceWorker({
      fetchImpl: async () => makeResponse({ status: 200 }) as unknown as Response,
      initialCaches: ['dripl-v1', 'dripl-v2', 'dripl-v4'],
    });

    let waited: Promise<unknown> | undefined;
    const event = { waitUntil: (value: unknown) => (waited = value as Promise<unknown>) };
    for (const listener of listeners.get('activate') ?? []) listener(event);
    await waited;

    expect(await caches.keys()).toEqual(['dripl-v4']);
  });

  // `skipWaiting` on install is what lets a new worker take over without
  // waiting for every tab to close. Without it a deploy stalls until then.
  it('calls skipWaiting on install so an update is not held open', async () => {
    const { listeners, self } = await loadServiceWorker({
      fetchImpl: async () => makeResponse({ status: 200 }) as unknown as Response,
    });

    for (const listener of listeners.get('install') ?? []) listener({});

    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
