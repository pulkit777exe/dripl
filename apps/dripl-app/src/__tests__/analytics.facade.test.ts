import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAnalyticsConsent,
  resetAnalyticsConsent,
  trackCollaborationEvent,
  trackEvent,
  trackExportEvent,
  trackNavigationEvent,
  trackUIAction,
} from '@/utils/analytics';

/**
 * `utils/analytics.ts` — the category facade and the "never throws" contract.
 *
 * This module has exactly two kinds of interesting behaviour, and neither is
 * "it emits an event":
 *
 * 1. **It does not fire.** Analytics is gated on a consent record in
 *    `localStorage`, and the gate has to hold on the server too, where there is
 *    no `window` and no consent store at all. A guard written for the browser
 *    that reads `localStorage` unguarded would throw during SSR — i.e. inside a
 *    React render — and take a page down because a *metrics* call could not be
 *    made. So "no window means no analytics" is asserted as a returned value and
 *    as an absence of network traffic, in both directions: the guard must
 *    return `false`, and tracking while the guard is engaged must be a silent
 *    no-op rather than an exception.
 *
 * 2. **It never throws.** `trackEvent` is called from the success path of
 *    unrelated features (export finished, share created). An analytics failure
 *    surfacing as an error in *those* features is the whole failure mode the
 *    module is written to avoid, and it is invisible to a suite that only
 *    checks the emitted payload.
 *
 * The six category wrappers are trivial forwarders, and they are here because
 * each one can forward the wrong category string and nothing else would notice:
 * an event filed under `export` instead of `collaboration` is silently
 * unattributable forever after.
 */

const CONSENT_KEY = 'dripl-cookie-consent';
const ENDPOINT = 'https://ingest.example/v1/events';

/** Point `window.location` at an arbitrary URL, with an empty query and fragment. */
function setLocation(pathname: string): void {
  const origin = 'https://app.dripl.test';
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: `${origin}${pathname}`, origin, pathname, search: '', hash: '' },
  });
}

/** The analytics payload most recent delivery handed to the network. */
function deliveredPayload(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const body = fetchMock.mock.calls.at(-1)?.[1]?.body;
  expect(typeof body).toBe('string');
  return JSON.parse(String(body)) as Record<string, unknown>;
}

/**
 * Withhold `window` for the duration of `body`, then put it back.
 *
 * `vi.stubGlobal` would do the same, but the restore here is explicit and
 * synchronous, so a throw inside `body` cannot leave the global environment
 * without a window for the tests that follow.
 */
function withoutWindow<T>(body: () => T): T {
  const original = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    return body();
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: original,
    });
  }
}

describe('analytics — consent gate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENDPOINT', ENDPOINT);
    vi.clearAllMocks();

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    // The beacon is stubbed to refuse, so every delivery takes the `fetch` path
    // and the payload is readable as a string instead of as a Blob.
    beaconMock = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beaconMock,
    });

    window.localStorage.clear();
    setLocation('/dashboard');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.removeItem(CONSENT_KEY);
  });

  it('treats a missing window as no consent, and delivers nothing', () => {
    // SSR. Every export here is called from a module that the app renders on
    // the server, where `window` does not exist. The consent read must return a
    // value, not raise.
    const consented = withoutWindow(() => getAnalyticsConsent());
    expect(consented).toBe(false);

    expect(() => withoutWindow(() => trackEvent('canvas', 'element-created'))).not.toThrow();

    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports consent again once the window is back, so the guard is not just always false', () => {
    // Direction control for the test above: it fails if the window restore is
    // broken (everything reads as `false`) just as it fails if the guard is
    // deleted (the read throws). Without this, "always false" passes vacuously.
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true }));
    expect(getAnalyticsConsent()).toBe(true);

    window.localStorage.removeItem(CONSENT_KEY);
    expect(getAnalyticsConsent()).toBe(false);
  });

  it('treats a consent record with no `accepted` key as consent withheld', () => {
    // `!!parsed.accepted` is a truthiness test, so `{}` and `{"accepted":null}`
    // are both refusals. An object-valued `accepted` is truthy and is honoured —
    // recorded because that is what the code does, not because it is desirable.
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ timestamp: 1 }));
    expect(getAnalyticsConsent()).toBe(false);

    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: null }));
    expect(getAnalyticsConsent()).toBe(false);

    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: 'yes' }));
    expect(getAnalyticsConsent()).toBe(true);
  });

  it('rejects a consent record that is not JSON at all', () => {
    window.localStorage.setItem(CONSENT_KEY, 'accepted');
    expect(getAnalyticsConsent()).toBe(false);
  });

  it('honours withdrawal through resetAnalyticsConsent', () => {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true }));
    expect(getAnalyticsConsent()).toBe(true);

    resetAnalyticsConsent();
    expect(getAnalyticsConsent()).toBe(false);

    // The contract is withdrawal, not merely local bookkeeping: an endpoint is
    // configured for the whole session, so a stale key is the only thing that
    // could keep events flowing after a withdrawal.
    trackEvent('canvas', 'after-withdrawal');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('analytics — category facade', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENDPOINT', ENDPOINT);
    vi.clearAllMocks();

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });

    window.localStorage.clear();
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true }));
    setLocation('/dashboard');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.removeItem(CONSENT_KEY);
  });

  /**
   * Assert that `emit` produced exactly one event, filed under `category`, and
   * that the label and value it was given survived the forward.
   *
   * Deriving the expectation from the call's own arguments rather than from a
   * recorded snapshot is what keeps this from passing for a wrapper that files
   * every event under one hardcoded category.
   */
  function expectOneEventUnder(
    category: string,
    action: string,
    emit: () => void,
    options?: { label?: string; value?: number }
  ): void {
    emit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliveredPayload(fetchMock)).toMatchObject({
      type: 'analytics',
      category,
      action,
      label: options?.label,
      value: options?.value,
    });
  }

  it('files a navigation event under navigation', () => {
    expectOneEventUnder('navigation', 'opened', () => trackNavigationEvent('opened'));
  });

  it('files a collaboration event under collaboration', () => {
    expectOneEventUnder('collaboration', 'peer-joined', () =>
      trackCollaborationEvent('peer-joined')
    );
  });

  it('files an export event under export, and carries its label and value', () => {
    expectOneEventUnder(
      'export',
      'png',
      () => trackExportEvent('png', { label: 'canvas-1', value: 3 }),
      { label: 'canvas-1', value: 3 }
    );
  });

  it('files a UI action under ui', () => {
    expectOneEventUnder('ui', 'toolbar-opened', () => trackUIAction('toolbar-opened'));
  });

  it('sends no more than one event per wrapper call', () => {
    // A forwarder that called `trackEvent` twice would double-count every
    // button press in the product's funnel.
    trackUIAction('one');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('analytics — sensitive path segments', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENDPOINT', ENDPOINT);
    vi.clearAllMocks();

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });

    window.localStorage.clear();
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.removeItem(CONSENT_KEY);
  });

  /**
   * `/verify-email/<token>` and `/reset-password/<token>` carry the one-time
   * token from the emailed link. They are redacted by the same alternation as
   * `/share`, and are named here separately because removing either from it
   * would post a live credential to the analytics endpoint — with no other test
   * in the suite failing.
   */
  it.each(['verify-email', 'reset-password', 'share', 'file', 'canvas'])(
    'redacts the opaque id on a /%s path',
    segment => {
      const secret = 'AbCdEf0123456789XYZ';
      setLocation(`/${segment}/${secret}`);

      trackEvent('navigation', 'opened');

      const path = deliveredPayload(fetchMock).path;
      expect(path).toBe(`https://app.dripl.test/${segment}/:token`);
      expect(String(path)).not.toContain(secret);
    }
  );

  it('leaves a sensitive segment with no id alone, because there is nothing to redact', () => {
    setLocation('/share');

    trackEvent('navigation', 'opened');

    expect(deliveredPayload(fetchMock).path).toBe('https://app.dripl.test/share');
  });
});
