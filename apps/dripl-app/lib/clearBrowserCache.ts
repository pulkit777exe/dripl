import { logError } from '@dripl/common';

/**
 * Drop every browser-side cache this origin owns, on sign-out.
 *
 * Two caches exist on the client: the HTTP cache and the service worker's
 * Cache Storage (`public/sw.js`). The worker no longer stores anything the
 * server marks `private, no-store`, so a route like `/dashboard` cannot reach
 * the cache even through its offline fallback — that is the load-bearing fix,
 * and it does not depend on this function running at all.
 *
 * This is the belt for that. The HTTP cache is not subject to the worker's
 * rules and can hold bodies the worker never saw, and a sign-out is the one
 * moment where a stale body is worth paying a refetch to avoid: a shared
 * machine handed to the next person should have nothing of the last user's to
 * serve, whether or not any given cache is one this code knows to look in.
 *
 * Failure is logged and swallowed. Sign-out has already succeeded by this
 * point — the session is revoked server-side and the user is being returned to
 * the landing page — and refusing to leave the screen because a cache delete
 * was refused by the browser would trade a security cleanup for a stuck UI.
 */
export async function clearBrowserCache(): Promise<void> {
  try {
    await caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
  } catch (error) {
    // `caches` is undefined on insecure origins and in browsers without the
    // Cache API, where there is nothing to clear.
    logError('Failed to clear service worker caches on sign-out:', error);
  }
}
