import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackEvent } from '@/utils/analytics';

/**
 * Two things are pinned here, and the first one is the reason this file exists.
 *
 * `trackEvent` used to put `window.location.href` straight into the payload. That
 * is a **leak**, not a stylistic problem: this repository carries the E2EE
 * decryption key in the URL fragment (`#key=...`, written by `appendKeyToUrl` in
 * `@dripl/utils/encryption`). A fragment is never sent to a server by ordinary
 * navigation, which is exactly why it is safe there — but it *is* part of the href
 * string, so posting the href anywhere hands over the key for every encrypted
 * shared canvas. `/share/<token>` is a public capability link in the same string.
 *
 * The second is the transport. `logInfo` is `console.info`, which the production
 * build strips via `removeConsole`, so before this change tracked events reached
 * no data path at all in a production bundle.
 */

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const ENDPOINT = 'https://ingest.example/v1/events';
const SECRET_KEY = 'c2VjcmV0LWRlY3J5cHRpb24ta2V5LW1hdGVyaWFs';

/** Point `window.location` at an arbitrary URL. */
function setLocation(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    },
  });
}

/** The payload most recent delivery handed to the network. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
}

describe('analytics transport and redaction', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockReturnValue(JSON.stringify({ accepted: true }));
    vi.clearAllMocks();

    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    beaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: beaconMock,
    });

    delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    setLocation('https://app.dripl.test/dashboard');
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    vi.unstubAllGlobals();
  });

  describe('what leaves the browser', () => {
    it('sends nothing when no endpoint is configured', () => {
      trackEvent('canvas', 'element-created');

      expect(beaconMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends nothing without consent, even with an endpoint configured', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      localStorageMock.getItem.mockReturnValue(JSON.stringify({ accepted: false }));

      trackEvent('canvas', 'element-created');

      expect(beaconMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('prefers sendBeacon, which survives page unload', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;

      trackEvent('export', 'png');

      expect(beaconMock).toHaveBeenCalledTimes(1);
      expect(beaconMock.mock.calls[0]?.[0]).toBe(ENDPOINT);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to a keepalive fetch when the beacon queue is full', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      beaconMock.mockReturnValue(false);

      trackEvent('export', 'png');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(init?.method).toBe('POST');
      expect(init?.keepalive).toBe(true);
    });

    it('falls back to fetch when sendBeacon is unavailable', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      trackEvent('export', 'png');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never lets a failed delivery throw at the caller', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      beaconMock.mockImplementation(() => {
        throw new Error('blocked by CSP');
      });

      expect(() => trackEvent('canvas', 'element-created')).not.toThrow();
    });

    it('never lets a rejected fetch throw at the caller', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      beaconMock.mockReturnValue(false);
      fetchMock.mockRejectedValue(new Error('network down'));

      expect(() => trackEvent('canvas', 'element-created')).not.toThrow();
    });

    it('carries the event fields the endpoint receives', () => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      beaconMock.mockReturnValue(false);

      trackEvent('canvas', 'element-created', { label: 'rectangle', value: 2 });

      const body = JSON.parse(sentBody(fetchMock)) as Record<string, unknown>;
      expect(body).toMatchObject({
        type: 'analytics',
        category: 'canvas',
        action: 'element-created',
        label: 'rectangle',
        value: 2,
      });
    });
  });

  describe('redaction — the reason this file exists', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = ENDPOINT;
      beaconMock.mockReturnValue(false);
    });

    it('never sends the URL fragment, which carries the E2EE key', () => {
      setLocation(`https://app.dripl.test/share/abc123#key=${SECRET_KEY}`);

      trackEvent('canvas', 'element-created');

      const body = sentBody(fetchMock);
      expect(body).not.toContain(SECRET_KEY);
      expect(body).not.toContain('key=');
    });

    it('never sends the query string', () => {
      setLocation('https://app.dripl.test/file/abc?token=supersecretvalue');

      trackEvent('canvas', 'element-created');

      expect(sentBody(fetchMock)).not.toContain('supersecretvalue');
    });

    it('redacts a share capability token from the path', () => {
      setLocation('https://app.dripl.test/share/AbCdEf0123456789XYZ');

      trackEvent('canvas', 'element-created');

      const body = sentBody(fetchMock);
      expect(body).not.toContain('AbCdEf0123456789XYZ');
      expect(JSON.parse(body).path).toBe('https://app.dripl.test/share/:token');
    });

    it.each(['file', 'canvas'])('redacts the id from a /%s path', segment => {
      setLocation(`https://app.dripl.test/${segment}/f0001111-2222-3333`);

      trackEvent('canvas', 'element-created');

      expect(sentBody(fetchMock)).not.toContain('f0001111-2222-3333');
    });

    it('leaves an ordinary route intact so the signal is still useful', () => {
      setLocation('https://app.dripl.test/dashboard/folders');

      trackEvent('navigation', 'opened');

      expect(JSON.parse(sentBody(fetchMock)).path).toBe('https://app.dripl.test/dashboard/folders');
    });

    it('does not redact a route that merely starts with a sensitive word', () => {
      setLocation('https://app.dripl.test/dashboard');

      trackEvent('navigation', 'opened');

      expect(JSON.parse(sentBody(fetchMock)).path).toBe('https://app.dripl.test/dashboard');
    });
  });
});
