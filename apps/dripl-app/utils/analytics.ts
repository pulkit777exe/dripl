import { logInfo } from '@dripl/common';

type EventCategory =
  'canvas' | 'actions' | 'auth' | 'export' | 'navigation' | 'collaboration' | 'ui';

interface AnalyticsEvent {
  category: EventCategory;
  action: string;
  label?: string;
  value?: number;
  timestamp: number;
  userAgent?: string;
  /**
   * Origin plus a redacted pathname. Deliberately **not** `location.href`:
   * see `safeLocation`.
   */
  path?: string;
}

function isAnalyticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const consent = localStorage.getItem('dripl-cookie-consent');
  if (!consent) return false;

  try {
    const parsed = JSON.parse(consent);
    return !!parsed.accepted;
  } catch {
    return false;
  }
}

/**
 * Route segments whose value is a capability or an opaque id, redacted before
 * the path is ever put on the wire.
 *
 * `/share/<token>` is a public capability link: anyone holding it can read the
 * shared canvas. `/file/<id>` and `/canvas/<roomId>` are the owner's ids. None of
 * them belong in an analytics payload.
 */
const SENSITIVE_SEGMENTS = /^\/(share|file|canvas|verify-email|reset-password)\/[^/]+/;

/**
 * The one place a location is turned into something sendable.
 *
 * `location.href` is the wrong value and was a real leak, not a theoretical one:
 * this repository carries the E2EE decryption key in the URL **fragment**
 * (`#key=...`, see `appendKeyToUrl` in `@dripl/utils/encryption`), and fragments
 * are not sent to servers by ordinary navigation — but they *are* part of the
 * href string, so posting `location.href` to an analytics endpoint would have
 * handed over the key material for every encrypted shared canvas. The query
 * string is dropped for the same reason.
 *
 * So: origin and pathname only, with the identifying segment of the routes above
 * replaced by `:token`.
 */
function safeLocation(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname } = window.location;
  return `${origin}${pathname.replace(SENSITIVE_SEGMENTS, (_match, seg: string) => `/${seg}/:token`)}`;
}

/**
 * Deliver the event.
 *
 * The transport is a plain HTTP POST to `NEXT_PUBLIC_ANALYTICS_ENDPOINT`, so the
 * vendor stays the maintainer's choice: point it at whatever ingest URL they use
 * and the payload shape above is the contract. With the variable unset the
 * event is still logged for local debugging and nothing leaves the browser.
 *
 * `sendBeacon` is preferred because it survives page unload, which is exactly
 * when the events most worth having (export completed, share created) tend to
 * fire; it returns `false` when the browser's queue is full, in which case this
 * falls back to a `keepalive` fetch. Both paths are wrapped because an analytics
 * failure must never surface as an error in whatever feature emitted the event.
 */
function deliver(event: AnalyticsEvent): void {
  logInfo(JSON.stringify({ type: 'analytics', ...event }));

  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
  if (!endpoint) return;

  const body = JSON.stringify({ type: 'analytics', ...event });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const queued = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      if (queued) return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // A blocked endpoint, a CSP rejection, a serialization failure. Swallowed on
    // purpose: the caller's feature succeeded and must not be made to look broken.
  }
}

export function trackEvent(
  category: EventCategory,
  action: string,
  options?: {
    label?: string;
    value?: number;
  }
): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  const event: AnalyticsEvent = {
    category,
    action,
    label: options?.label,
    value: options?.value,
    timestamp: Date.now(),
    path: safeLocation(),
  };

  deliver(event);
}

export function trackCanvasEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('canvas', action, options);
}

export function trackAuthEvent(action: string, options?: { label?: string; value?: number }): void {
  trackEvent('auth', action, options);
}

export function trackExportEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('export', action, options);
}

export function trackNavigationEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('navigation', action, options);
}

export function trackCollaborationEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('collaboration', action, options);
}

export function trackUIAction(action: string, options?: { label?: string; value?: number }): void {
  trackEvent('ui', action, options);
}

export function getAnalyticsConsent(): boolean {
  return isAnalyticsEnabled();
}

export function resetAnalyticsConsent(): void {
  localStorage.removeItem('dripl-cookie-consent');
}
