/**
 * Dripl service worker.
 *
 * What may be stored is decided by the server, not by this file. Next.js
 * already emits a precise `Cache-Control` on every response — `private,
 * no-cache, no-store` for routes that render a signed-in user's data, `public,
 * immutable` for the content-hashed build output — and this worker obeys those
 * directives instead of second-guessing them.
 *
 * The split matters because of what the previous version did. It stored every
 * GET whose URL did not contain `/api/`, which included the server-rendered
 * HTML of `/dashboard`, `/teams/*`, `/settings/*` and `/share/[token]` — the
 * routes whose pages carry a user's file list and team membership, and whose own
 * comments describe `Cache-Control: private, no-store` as "the security
 * property". Nothing ever cleared that cache. A logged-out browser therefore
 * still held the previous user's dashboard HTML in Cache Storage, and the next
 * person to hit a failed request was served it.
 *
 * Three rules follow from that, and each is asserted by
 * `src/__tests__/serviceWorker.test.ts`, which runs this exact file:
 *
 *   1. A response whose `Cache-Control` forbids storage is never stored.
 *   2. Only successful responses are stored. The old worker cached whatever the
 *      network returned, so a transient 502 was written and kept.
 *   3. Only same-origin GETs are considered at all, so third-party responses
 *      cannot accumulate here either.
 *
 * The one piece of genuine caching value — the hashed build output under
 * `/_next/static/` — is served cache-first, which removes a network round trip
 * from every repeat load. That is safe precisely because the filenames carry
 * the content hash: a miss can only mean the file is gone, never that it is
 * stale.
 */

const CACHE_NAME = 'dripl-v4';

/** Build output, keyed by content hash. Safe to serve without revalidation. */
const IMMUTABLE_PREFIX = '/_next/static/';

/** Cap on stored entries, so a long-lived profile cannot grow this without end. */
const MAX_ENTRIES = 200;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Whether this response may be written to Cache Storage.
 *
 * `no-store` and `private` are the load-bearing directives: they are how the
 * dashboard and its siblings say "this body belongs to one session". Honoring
 * them is the entire point of the rewrite.
 */
function mayStore(response) {
  if (!response.ok) return false;
  // `Response.type` is 'opaque' for a cross-origin no-cors response, whose
  // headers are unreadable and whose body must not be served. Not stored.
  if (response.type === 'opaque') return false;

  const control = (response.headers.get('Cache-Control') || '').toLowerCase();
  if (control.includes('no-store') || control.includes('private')) return false;
  return true;
}

self.addEventListener('fetch', event => {
  const { request } = event;

  // Non-GET is never cached, and `/api/` carries the session's own traffic.
  if (request.method !== 'GET') return;

  // Cross-origin is left entirely to the browser's own cache. This worker used
  // to store font files here, which added no value — those responses are
  // already `public, max-age=31536000` — and put third-party bytes in a cache
  // this app owns and must reason about.
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.url.includes('/api/')) return;

  if (new URL(request.url).pathname.startsWith(IMMUTABLE_PREFIX)) {
    event.respondWith(serveImmutable(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

/**
 * Cache-first, for content-hashed assets only.
 *
 * There is no revalidation step because there is nothing to revalidate: the
 * name changes when the bytes change. A hit costs no network, which is the
 * whole performance case for this worker — a cold load fetches around twenty of
 * these and a warm load fetched all twenty of them again on every visit.
 */
async function serveImmutable(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (mayStore(response)) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

/**
 * Network-first, for everything else: shell pages and static assets that are
 * not content-addressed.
 *
 * The network is authoritative when it answers. The cache is consulted only
 * when it does not, which is what makes honoring `no-store` safe rather than
 * costly — a route that forbids storage can never be reached through the
 * fallback.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (mayStore(response)) {
      await cache.put(request, response.clone());
      await trim(cache);
    }
    return response;
  } catch (networkError) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Only navigations get a fallback body. Fabricating a 503 for an image or
    // a script masks the real failure — the page cannot tell this apart from a
    // server that is genuinely down, and the earlier version's blanket
    // `new Response('Offline', { status: 503 })` is what made a missing API
    // stub look like a service-worker bug.
    if (request.mode === 'navigate') {
      return new Response('Offline', {
        status: 503,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      });
    }
    throw networkError;
  }
}

/**
 * Drop oldest entries past `MAX_ENTRIES`.
 *
 * Kept deliberately crude: the cache holds hashed assets and shell pages, both
 * of which are re-fetched on the next miss, so an approximate bound is worth
 * more here than an LRU would be.
 */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;

  // `keys()` returns in most-recently-stored order, so the front is the oldest.
  const excess = keys.slice(0, keys.length - MAX_ENTRIES);
  await Promise.all(excess.map(key => cache.delete(key)));
}
