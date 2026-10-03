import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `lib/api.ts` is the browser's only door to the http-server.
 *
 * Everything that can go wrong between the two — a non-2xx response, a body
 * that is not JSON, a 204, a transport throw, an abort, an expired CSRF token,
 * a missing session cookie — is either handled here or silently becomes an
 * unhandled rejection somewhere in a React effect. So the emphasis in this file
 * is deliberately on the failure paths and on the two invariants callers rely
 * on: a rejection is an `Error` carrying `.status`, and a `Response` never
 * escapes the module.
 *
 * `apiClient` is a module-level singleton with cached CSRF state, so each test
 * re-imports it with `vi.resetModules()` to get a clean client.
 */

/**
 * One recorded request.
 *
 * Headers are flattened to a lower-cased record: the client hands `fetch` a real
 * `Headers` object, whose entries live in internal slots and are not enumerable,
 * and whose names are case-insensitive.
 */
interface FetchCall {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

/** Records every fetch and answers from a queue of scripted responses. */
function stubFetch(...responses: Array<Response | Error | (() => Response | Error)>) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const mock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ url: String(url), init: { ...init }, headers });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    const value = typeof next === 'function' ? next() : next;
    // Distinguish a transport failure from a response by shape, not by
    // `instanceof Error`: jsdom's `DOMException` is NOT an Error, and an abort
    // is exactly the case this has to model.
    if (typeof (value as Response).ok !== 'boolean') throw value as Error;
    return value as Response;
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

/** Minimal Response stand-in covering exactly what the client reads. */
function res(body: unknown, init: { status?: number; text?: string } = {}): Response {
  const status = init.status ?? 200;
  const text = init.text ?? (typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (text === '') throw new SyntaxError('Unexpected end of JSON input');
      return JSON.parse(text) as unknown;
    },
    clone: () => res(body, init),
  } as unknown as Response;
}

/** A fresh, isolated `apiClient`. */
async function loadClient(apiUrl = 'http://api.test/api') {
  vi.resetModules();
  process.env.NEXT_PUBLIC_API_URL = apiUrl;
  const apiModule = await import('@/lib/api');
  return apiModule.apiClient;
}

type Client = Awaited<ReturnType<typeof loadClient>>;

const CSRF_URL = 'http://api.test/csrf-token';
const csrf = (token = 'tok-1') => res({ token });

/** A client whose CSRF token is already warm, so tests exercise one request. */
/**
 * The raw strings written to `document.cookie`, plus a tiny jar of what a
 * browser would hand back.
 *
 * jsdom exposes cookie ATTRIBUTES nowhere, so `Secure`, `SameSite` and `max-age`
 * can only be checked by intercepting the writes; and `getSessionToken` reads
 * `document.cookie` as one `name=value; name=value` string, which the jar
 * reproduces exactly.
 */
let cookieWrites: string[];

function installCookieJar(): void {
  const jar = new Map<string, string>();
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    set: (raw: string) => {
      cookieWrites.push(raw);
      const [pair, ...attributes] = raw.split(';');
      const separator = pair!.indexOf('=');
      const name = pair!.slice(0, separator).trim();
      const value = pair!.slice(separator + 1);
      const expired = attributes.some(attribute => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  cookieWrites = [];
  installCookieJar();
});

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  // Drop the own property so jsdom's Document.prototype accessor comes back.
  delete (document as unknown as Record<string, unknown>).cookie;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** The error the client threw, as `Error & { status?: number }`. */
async function rejection(promise: Promise<unknown>): Promise<Error & { status?: number }> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection but the promise resolved');
    },
    (e: unknown) => e
  );
  return error as Error & { status?: number };
}

describe('URL composition', () => {
  it('prefixes every path with the configured base, including the /api segment', async () => {
    const client = await loadClient('https://api.example.com/api');
    stubFetch(res({ user: null }));
    await client.me();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'https://api.example.com/api/auth/me'
    );
  });

  it('takes the env var verbatim, so a bare origin loses the /api segment', async () => {
    // Documented divergence from `utils/api/images.ts`, which normalises. Pinned
    // rather than fixed: `.env.example` and `docker-compose.yml` both document
    // the value WITH `/api`, so no deployment is affected today.
    const client = await loadClient('https://api.example.com');
    stubFetch(res({ user: null }));
    await client.me();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'https://api.example.com/auth/me'
    );
  });

  it('interpolates a file id into the path', async () => {
    const client = await loadClient();
    stubFetch(res({ file: {} }));
    await client.getFile('file-123');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/files/file-123'
    );
  });

  it('encodes a share token in the websocket-ticket path', async () => {
    const client = await loadClient();
    stubFetch(res({ ticket: 't' }));
    await client.getShareWsTicket('a b/c?d');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/share/a%20b%2Fc%3Fd/ws-ticket'
    );
  });

  it('encodes a share token in the shared-room path', async () => {
    const client = await loadClient();
    stubFetch(res({ room: {}, permission: 'VIEW', expiresAt: '' }));
    await client.getSharedRoom('a b/c');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/rooms/share/a%20b%2Fc'
    );
  });

  /**
   * `getSharedFile` is the one token path that does NOT encode.
   *
   * `getShareWsTicket` and `getSharedRoom` both call `encodeURIComponent`;
   * this one interpolates raw. It is latent rather than live only because the
   * server mints tokens with `randomBytes(24).toString('base64url')`
   * (`apps/http-server/src/services/shareService.ts:26`), whose alphabet is
   * `A-Za-z0-9-_` — all URL-safe. A token from any other source, or a future
   * change to the alphabet, would break the route. Pinned as-is so a fix is
   * noticed.
   */
  it('DIVERGES: getSharedFile does not encode its token, unlike the other two', async () => {
    const client = await loadClient();
    stubFetch(res({ file: {}, permission: 'view', encryptedPayload: null, elements: null }));
    await client.getSharedFile('a b/c');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/share/a b/c'
    );
  });

  it('handles a base64url share token correctly in all three token paths', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(
      res({ file: {}, permission: 'view', encryptedPayload: null, elements: null }),
      res({ ticket: 't' }),
      res({ room: {}, permission: 'VIEW', expiresAt: '' })
    );
    const token = 'AbC-123_XYZ';
    await client.getSharedFile(token);
    await client.getShareWsTicket(token);
    await client.getSharedRoom(token);
    expect(mock.mock.calls.map(c => c[0])).toEqual([
      `http://api.test/api/share/${token}`,
      `http://api.test/api/share/${token}/ws-ticket`,
      `http://api.test/api/rooms/share/${token}`,
    ]);
  });
});

describe('credentials and headers', () => {
  it('sends cookies on every request, including safe ones', async () => {
    const client = await loadClient();
    stubFetch(res({ user: null }));
    await client.me();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      credentials: 'include',
    });
  });

  it('sets Content-Type: application/json when there is a body', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({}), res({}));
    await client.deleteFile('f1');
    await client.register({ email: 'a@b.c', password: 'p' });
    const withBody = calls.at(-1)!;
    expect(withBody.headers['content-type']).toBe('application/json');
    expect(withBody.init.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'p' }));
  });

  it('omits Content-Type when there is no body, so a bodyless DELETE is not typed', async () => {
    const client = await loadClient();
    stubFetch(csrf(), res({}, { status: 204 }));
    await client.deleteFile('f1');
    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]![1]
      .headers as Headers;
    expect(headers.get('content-type')).toBeNull();
  });

  it('does not overwrite a Content-Type the caller set', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf(), res({}));
    // No public method takes custom headers, so this exercises the helper the
    // way a future caller would.
    await (
      client as unknown as { request: (p: string, i: RequestInit) => Promise<unknown> }
    ).request('/x', {
      method: 'POST',
      body: 'raw',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(calls.at(-1)!.headers['content-type']).toBe('text/plain');
  });

  it('sends the session cookie as a bearer token when the app domain holds one', async () => {
    document.cookie = 'dripl-session=sess-abc; path=/';
    const client = await loadClient();
    const { calls } = stubFetch(res({ user: null }));
    await client.me();
    expect(calls[0]!.headers.authorization).toBe('Bearer sess-abc');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('percent-decodes the session cookie value', async () => {
    document.cookie = `dripl-session=${encodeURIComponent('a b/c')}; path=/`;
    const client = await loadClient();
    const { calls } = stubFetch(res({ user: null }));
    await client.me();
    expect(calls[0]!.headers.authorization).toBe('Bearer a b/c');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('sends no Authorization header when there is no session cookie', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(res({ user: null }));
    await client.me();
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('sends no Authorization header for a malformed percent-encoded cookie', async () => {
    document.cookie = 'dripl-session=%E0%A4%A; path=/';
    const client = await loadClient();
    const { calls } = stubFetch(res({ user: null }));
    await client.me();
    expect(calls[0]!.headers.authorization).toBeUndefined();
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('does not mistake another cookie for the session cookie', async () => {
    document.cookie = 'other=zzz; path=/';
    const client = await loadClient();
    const { calls } = stubFetch(res({ user: null }));
    await client.me();
    expect(calls[0]!.headers.authorization).toBeUndefined();
    document.cookie = 'other=; path=/; max-age=0';
  });
});

describe('CSRF token handling', () => {
  it('fetches the token from the ORIGIN root, not from under /api', async () => {
    // `new URL('/csrf-token', '.../api')` resolves against the origin, and the
    // server mounts `app.get('/csrf-token')` at the root — NOT under /api.
    const client = await loadClient();
    stubFetch(csrf('abc'));
    await expect(client.getCsrfToken()).resolves.toBe('abc');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(CSRF_URL);
  });

  it('requests the token with cookies, so the Set-Cookie is stored', async () => {
    const client = await loadClient();
    stubFetch(csrf());
    await client.getCsrfToken();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      credentials: 'include',
      method: 'GET',
    });
  });

  it('attaches the token to POST, PUT, PATCH and DELETE', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({}), res({}), res({}), res({}, { status: 204 }));
    await client.register({ email: 'a@b.c', password: 'p' });
    await client.updateFile('f', { name: 'x' });
    await client.changePassword({ currentPassword: 'a', newPassword: 'b' });
    await client.revokeShare('f');
    for (const call of calls.slice(1)) {
      expect(call.headers['x-csrf-token']).toBe('t');
    }
  });

  it('never attaches the token to GET, HEAD or OPTIONS', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({ ticket: 'x' }));
    await client.me();
    await client.getShareWsTicket('tok');
    for (const call of calls.slice(1)) {
      expect(call.headers['x-csrf-token']).toBeUndefined();
    }
  });

  it('caches the token: two mutations fetch it once', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(csrf('t'), res({}), res({}));
    await client.register({ email: 'a@b.c', password: 'p' });
    await client.forgotPassword({ email: 'a@b.c' });
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('collapses concurrent token fetches into one request', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(csrf('t'), res({}), res({}));
    await Promise.all([
      client.register({ email: 'a@b.c', password: 'p' }),
      client.forgotPassword({ email: 'a@b.c' }),
      client.changePassword({ currentPassword: 'a', newPassword: 'b' }),
    ]);
    expect(mock.mock.calls.filter(c => String(c[0]) === CSRF_URL)).toHaveLength(1);
  });

  it('refetches once when forced, and caches the new value', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('first'), csrf('second'));
    await expect(client.getCsrfToken()).resolves.toBe('first');
    await expect(client.getCsrfToken(true)).resolves.toBe('second');
    await expect(client.getCsrfToken()).resolves.toBe('second');
    expect(calls.filter(c => c.url === CSRF_URL)).toHaveLength(2);
  });

  it('does not cache a failed token fetch, so the next attempt retries', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(res({}, { status: 500 }));
    await expect(client.getCsrfToken()).rejects.toThrow('Failed to initialize security token');
    await expect(client.getCsrfToken()).rejects.toThrow('Failed to initialize security token');
    // Both attempts actually went to the network rather than replaying a cache.
    expect(mock.mock.calls.filter(c => String(c[0]) === CSRF_URL)).toHaveLength(2);
  });

  it('rejects when the token endpoint returns 200 with no token', async () => {
    const client = await loadClient();
    stubFetch(res({}));
    await expect(client.getCsrfToken()).rejects.toThrow('Failed to initialize security token');
  });

  it('rejects when the token endpoint is unreachable', async () => {
    const client = await loadClient();
    stubFetch(new TypeError('Failed to fetch'));
    await expect(client.getCsrfToken()).rejects.toThrow('Failed to fetch');
  });

  it('rejects a mutation before making it when the token cannot be fetched', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(res({}, { status: 500 }));
    await expect(client.register({ email: 'a@b.c', password: 'p' })).rejects.toThrow(
      'Failed to initialize security token'
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('CSRF recovery on 403', () => {
  it('retries once with a fresh token when the server says the token is missing', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('stale'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      csrf('fresh'),
      res({ ok: true })
    );

    await expect(client.register({ email: 'a@b.c', password: 'p' })).resolves.toEqual({ ok: true });

    expect(calls.map(c => c.url)).toEqual([
      CSRF_URL,
      'http://api.test/api/auth/register',
      CSRF_URL,
      'http://api.test/api/auth/register',
    ]);
    expect(calls[1]!.headers['x-csrf-token']).toBe('stale');
    expect(calls[3]!.headers['x-csrf-token']).toBe('fresh');
  });

  it('retries on the invalid-token message too', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('stale'),
      res({ message: 'CSRF token invalid' }, { status: 403 }),
      csrf('fresh'),
      res({ ok: true })
    );
    await expect(client.register({ email: 'a@b.c', password: 'p' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(4);
  });

  it('replays the request body on the retry', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('stale'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      csrf('fresh'),
      res({ ok: true })
    );
    await client.updateFile('f1', { name: 'renamed' });
    expect(calls[1]!.init.body).toBe(JSON.stringify({ name: 'renamed' }));
    expect(calls[3]!.init.body).toBe(JSON.stringify({ name: 'renamed' }));
  });

  it('keeps credentials on the retry', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('stale'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      csrf('fresh'),
      res({ ok: true })
    );
    await client.register({ email: 'a@b.c', password: 'p' });
    expect(calls[3]!.init.credentials).toBe('include');
  });

  it('does NOT retry a 403 whose message is something else', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({ message: 'Forbidden' }, { status: 403 }));
    await expect(client.register({ email: 'a@b.c', password: 'p' })).rejects.toThrow('Forbidden');
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry a 403 with a CSRF word in an unrelated message', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('t'),
      res({ message: 'CSRF token missing but also rate limited' }, { status: 403 })
    );
    await expect(client.register({ email: 'a@b.c', password: 'p' })).rejects.toThrow(
      'CSRF token missing but also rate limited'
    );
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry a 403 on a safe method', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(res({ message: 'CSRF token missing' }, { status: 403 }));
    await expect(client.me()).rejects.toThrow('CSRF token missing');
    expect(calls).toHaveLength(1);
  });

  it('gives up after one retry, so a 403 cannot loop', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('a'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      csrf('b'),
      res({ message: 'CSRF token missing' }, { status: 403 })
    );
    await expect(client.register({ email: 'a@b.c', password: 'p' })).rejects.toThrow(
      'CSRF token missing'
    );
    expect(calls).toHaveLength(4);
  });

  it('reports the RETRY failure, not the first one, so a stale token does not mask the real error', async () => {
    // `parseError` reads a `clone()`, so the 403 that triggered the retry does
    // not consume the body. Getting this wrong would surface "CSRF token
    // missing" for an unrelated second failure.
    const client = await loadClient();
    stubFetch(
      csrf('a'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      csrf('b'),
      res({ message: 'Session expired' }, { status: 401 })
    );
    const error = await rejection(client.register({ email: 'a@b.c', password: 'p' }));
    expect(error.message).toBe('Session expired');
    expect(error.status).toBe(401);
  });

  it('recognises the CSRF message sent in the `error` field too', async () => {
    // `parseError` reads `message ?? error`, and the server happens to put the
    // sentence in `message`, but a proxy might not.
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('a'),
      res({ error: 'CSRF token missing' }, { status: 403 }),
      csrf('b'),
      res({ ok: true })
    );
    await expect(client.register({ email: 'a@b.c', password: 'p' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(4);
  });
});

describe('error mapping', () => {
  it('prefers the human message over the machine code, as the server defines them', async () => {
    const client = await loadClient();
    stubFetch(
      res({ error: 'NOT_FOUND', message: 'File not found', statusCode: 404 }, { status: 404 })
    );
    const error = await rejection(client.getFile('missing'));
    expect(error.message).toBe('File not found');
    expect(error.status).toBe(404);
  });

  it('falls back to the error field when there is no message', async () => {
    const client = await loadClient();
    stubFetch(res({ error: 'NOT_FOUND' }, { status: 404 }));
    expect((await rejection(client.getFile('x'))).message).toBe('NOT_FOUND');
  });

  it('falls back to a generic message when the body has neither field', async () => {
    const client = await loadClient();
    stubFetch(res({}, { status: 500 }));
    expect((await rejection(client.me())).message).toBe('Request failed');
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const client = await loadClient();
    stubFetch(res('', { status: 502, text: '<html>bad gateway</html>' }));
    const error = await rejection(client.me());
    expect(error.message).toBe('Request failed');
    expect(error.status).toBe(502);
  });

  it('handles a JSON array body without crashing', async () => {
    const client = await loadClient();
    stubFetch(res([], { status: 400 }));
    // `parsed.message` on an array is undefined, so it falls through.
    expect((await rejection(client.me())).message).toBe('Request failed');
  });

  it('never leaks the raw Response', async () => {
    const client = await loadClient();
    const response = res({ error: 'X', message: 'boom' }, { status: 400 });
    stubFetch(response);
    const error = await rejection(client.me());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(response);
    for (const leaked of ['json', 'clone', 'bodyUsed', 'headers', 'status'] as const) {
      // `status` is copied onto the error deliberately; everything else is not.
      if (leaked === 'status') continue;
      expect((error as unknown as Record<string, unknown>)[leaked]).toBeUndefined();
    }
  });

  it('attaches the numeric status for every failing status class', async () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503]) {
      const client = await loadClient();
      stubFetch(res({ message: 'nope' }, { status }));
      const error = await rejection(client.me());
      expect(error.status).toBe(status);
    }
  });

  it('propagates a transport throw unchanged, so AbortError stays recognisable', async () => {
    const client = await loadClient();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    stubFetch(abort);
    const error = await rejection(client.me());
    expect(error).toBe(abort);
    expect(error.name).toBe('AbortError');
  });

  it('propagates a network TypeError unchanged, with no fabricated status', async () => {
    const client = await loadClient();
    const failure = new TypeError('Failed to fetch');
    stubFetch(failure);
    const error = await rejection(client.me());
    expect(error).toBe(failure);
    expect(error.status).toBeUndefined();
  });
});

describe('abort and signals', () => {
  it('passes the caller signal straight through', async () => {
    const client = await loadClient();
    const controller = new AbortController();
    const { calls } = stubFetch(csrf('t'), res({ ticket: 'ok' }));
    await client.getWsTicket(controller.signal);
    expect(calls[1]!.init.signal).toBe(controller.signal);
  });

  it('surfaces an abort as an AbortError, not a generic failure', async () => {
    const client = await loadClient();
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    stubFetch(csrf('t'), abort);
    controller.abort();
    const error = await rejection(client.getWsTicket(controller.signal));
    expect(error.name).toBe('AbortError');
  });

  it('passes a signal on the safe share-ticket request too', async () => {
    const client = await loadClient();
    const controller = new AbortController();
    const { calls } = stubFetch(res({ ticket: 'ok' }));
    await client.getShareWsTicket('tok', controller.signal);
    expect(calls[0]!.init.signal).toBe(controller.signal);
  });

  it('sends no signal when the caller supplies none', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({ ticket: 'ok' }));
    await client.getWsTicket();
    expect(calls[1]!.init.signal).toBeUndefined();
  });
});

describe('success bodies', () => {
  it('parses a JSON body', async () => {
    const client = await loadClient();
    stubFetch(res({ user: { id: 'u1', email: 'a@b.c', name: null, image: null } }));
    await expect(client.me()).resolves.toEqual({
      user: { id: 'u1', email: 'a@b.c', name: null, image: null },
    });
  });

  it('returns undefined for a 204 and never reads the body', async () => {
    const client = await loadClient();
    let jsonCalled = false;
    stubFetch(csrf('t'), {
      ok: true,
      status: 204,
      json: async () => {
        jsonCalled = true;
        return {};
      },
    } as unknown as Response);
    await expect(client.deleteFile('f1')).resolves.toBeUndefined();
    expect(jsonCalled).toBe(false);
  });

  it('returns undefined for a 204 on every void method', async () => {
    for (const call of [
      (c: Client) => c.deleteFile('f'),
      (c: Client) => c.revokeShare('f'),
      (c: Client) => c.deleteFolder('d'),
      (c: Client) => c.deleteCanvasRoom('r'),
    ]) {
      const client = await loadClient();
      stubFetch(csrf('t'), res({}, { status: 204 }));
      await expect(call(client)).resolves.toBeUndefined();
    }
  });

  it('rejects a 200 with an empty body, because only 204 short-circuits', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res('', { text: '' }));
    const error = await rejection(client.deleteFile('f'));
    expect(error).toBeInstanceOf(SyntaxError);
  });

  it('discards the parsed body of a void method', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res({ ok: true }));
    await expect(client.deleteFile('f')).resolves.toBeUndefined();
  });

  /**
   * The one gap in the error contract.
   *
   * A 2xx with a body that is not JSON rejects with a raw `SyntaxError` from
   * `response.json()`, so `.status` is `undefined` and callers that branch on
   * it cannot tell "the server sent something odd" from "the network is down".
   * The server always sends JSON, so this is a robustness gap rather than a
   * live failure; reported rather than fixed, because wrapping it would change
   * what a 2xx-with-HTML currently rejects with.
   */
  it('rejects with a status-less SyntaxError on a 2xx with an unparseable body', async () => {
    const client = await loadClient();
    stubFetch(res('', { text: '<!doctype html><title>proxy</title>' }));
    const error = await rejection(client.me());
    expect(error).toBeInstanceOf(SyntaxError);
    expect(error.status).toBeUndefined();
  });
});

describe('method and path table', () => {
  it('maps every public method to the documented verb and path', async () => {
    const cases: Array<[string, (c: Client) => Promise<unknown>, string, string]> = [
      ['register', c => c.register({ email: 'a@b.c', password: 'p' }), 'POST', '/auth/register'],
      ['login', c => c.login({ email: 'a@b.c', password: 'p' }), 'POST', '/auth/login'],
      ['logout', c => c.logout(), 'POST', '/auth/logout'],
      ['googleLogin', c => c.googleLogin({ token: 'g' }), 'POST', '/auth/google'],
      [
        'forgotPassword',
        c => c.forgotPassword({ email: 'a@b.c' }),
        'POST',
        '/auth/forgot-password',
      ],
      [
        'resetPassword',
        c => c.resetPassword({ token: 't', password: 'p' }),
        'POST',
        '/auth/reset-password',
      ],
      ['verifyEmail', c => c.verifyEmail({ token: 't' }), 'POST', '/auth/verify-email'],
      [
        'resendVerification',
        c => c.resendVerification({ email: 'a@b.c' }),
        'POST',
        '/auth/resend-verification',
      ],
      ['updateProfile', c => c.updateProfile({ name: 'n' }), 'PUT', '/auth/profile'],
      [
        'changePassword',
        c => c.changePassword({ currentPassword: 'a', newPassword: 'b' }),
        'POST',
        '/auth/change-password',
      ],
      ['me', c => c.me(), 'GET', '/auth/me'],
      ['listFiles', c => c.listFiles(), 'GET', '/files'],
      ['listSharedFiles', c => c.listSharedFiles(), 'GET', '/files/shared'],
      ['createFile', c => c.createFile(), 'POST', '/files'],
      ['getFile', c => c.getFile('f1'), 'GET', '/files/f1'],
      ['updateFile', c => c.updateFile('f1', { name: 'n' }), 'PATCH', '/files/f1'],
      ['deleteFile', c => c.deleteFile('f1'), 'DELETE', '/files/f1'],
      ['shareFile', c => c.shareFile('f1', { permission: 'view' }), 'POST', '/files/f1/share'],
      ['revokeShare', c => c.revokeShare('f1'), 'DELETE', '/files/f1/share'],
      ['getSharedFile', c => c.getSharedFile('t1'), 'GET', '/share/t1'],
      ['listFolders', c => c.listFolders(), 'GET', '/folders'],
      ['createFolder', c => c.createFolder({ name: 'n' }), 'POST', '/folders'],
      ['updateFolder', c => c.updateFolder('d1', { name: 'n' }), 'PATCH', '/folders/d1'],
      ['deleteFolder', c => c.deleteFolder('d1'), 'DELETE', '/folders/d1'],
      ['listCanvasRooms', c => c.listCanvasRooms(), 'GET', '/rooms'],
      ['createCanvasRoom', c => c.createCanvasRoom(), 'POST', '/rooms'],
      ['getCanvasRoom', c => c.getCanvasRoom('r1'), 'GET', '/rooms/r1'],
      ['updateCanvasRoom', c => c.updateCanvasRoom('r1', { name: 'n' }), 'PUT', '/rooms/r1'],
      ['deleteCanvasRoom', c => c.deleteCanvasRoom('r1'), 'DELETE', '/rooms/r1'],
      ['getWsTicket', c => c.getWsTicket(), 'POST', '/auth/ws-ticket'],
    ];

    for (const [name, call, method, path] of cases) {
      const client = await loadClient();
      const { calls } = stubFetch(csrf('t'), res({ ok: true, room: { slug: 's' } }));
      await call(client).catch(() => undefined);
      const request = calls.find(c => c.url !== CSRF_URL)!;
      expect(request.url, name).toBe(`http://api.test/api${path}`);
      // Safe methods are sent with no `method` at all, which `fetch` defaults
      // to GET; the table records the verb the server will see.
      expect(request.init.method ?? 'GET', name).toBe(method);
    }
  });

  it('defaults listFiles to no query string at all', async () => {
    const client = await loadClient();
    stubFetch(res({ files: [], total: 0, page: 1, limit: 20 }));
    await client.listFiles();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/files'
    );
  });

  it('builds the listFiles query from the params it was given', async () => {
    const client = await loadClient();
    stubFetch(res({ files: [], total: 0, page: 1, limit: 20 }));
    await client.listFiles({ search: 'my board', folderId: 'f1', page: 2, limit: 50 });
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(url).toBe('http://api.test/api/files?search=my+board&folderId=f1&page=2&limit=50');
  });

  it('omits falsy params, so a page of 0 or an empty search is not sent', async () => {
    const client = await loadClient();
    stubFetch(res({ files: [], total: 0, page: 1, limit: 20 }));
    await client.listFiles({ search: '', folderId: undefined, page: 0, limit: 0 });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/files'
    );
  });

  it('builds the listSharedFiles query, which has no folderId', async () => {
    const client = await loadClient();
    stubFetch(res({ files: [], total: 0, page: 1, limit: 20 }));
    await client.listSharedFiles({ search: 'x', page: 3, limit: 5 });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      'http://api.test/api/files/shared?search=x&page=3&limit=5'
    );
  });

  it('sends the optimistic-concurrency fence it was given', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({}));
    await client.updateFile('f1', { name: 'n', expectedUpdatedAt: '2026-01-01T00:00:00Z' });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      name: 'n',
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('sends an empty object for a createFile with no payload', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res({ id: 'f', name: 'n' }));
    await client.createFile();
    expect(calls[1]!.init.body).toBe('{}');
  });
});

describe('websocket tickets', () => {
  it('returns the ticket from a POST', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res({ ticket: 'ws-1' }));
    await expect(client.getWsTicket()).resolves.toBe('ws-1');
  });

  it('throws when the ticket is missing', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res({}));
    await expect(client.getWsTicket()).rejects.toThrow('Authentication ticket was not returned');
  });

  it('throws when the share ticket is missing', async () => {
    const client = await loadClient();
    stubFetch(res({}));
    await expect(client.getShareWsTicket('t')).rejects.toThrow(
      'Share collaboration ticket was not returned'
    );
  });

  it('returns the share ticket from a GET', async () => {
    const client = await loadClient();
    stubFetch(res({ ticket: 'ws-2' }));
    await expect(client.getShareWsTicket('t')).resolves.toBe('ws-2');
  });
});

describe('session cookie lifecycle', () => {
  const LOGIN_BODY = {
    user: { id: 'u', email: 'e', name: null, image: null },
    sessionToken: 'sess-1',
  };

  it('stores the login session token on the app domain for later bearer use', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(csrf('t'), res(LOGIN_BODY), res({ user: null }));
    await client.login({ email: 'a@b.c', password: 'p' });

    expect(document.cookie).toContain('dripl-session=sess-1');
    // The next request carries it as a bearer header, which is what makes a
    // cross-origin call to the API authentic at all.
    await client.me();
    expect(calls[2]!.headers.authorization).toBe('Bearer sess-1');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('writes a week-long, Lax, path=/ cookie with the token percent-encoded', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res({ user: null, sessionToken: 'a b/c' }));
    await client.login({ email: 'a@b.c', password: 'p' });
    expect(cookieWrites).toHaveLength(1);
    const written = cookieWrites[0]!;
    expect(written).toContain('dripl-session=a%20b%2Fc');
    expect(written).toContain('path=/');
    // 7 * 24 * 60 * 60 seconds.
    expect(written).toContain('max-age=604800');
    expect(written).toContain('SameSite=Lax');
    // jsdom serves http, so the cookie must NOT be marked Secure or the
    // browser would drop it entirely.
    expect(written).not.toContain('Secure');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('percent-encodes on the way out so the header carries the raw token', async () => {
    const client = await loadClient();
    const { calls } = stubFetch(
      csrf('t'),
      res({ user: null, sessionToken: 'a b/c' }),
      res({ user: null })
    );
    await client.login({ email: 'a@b.c', password: 'p' });
    await client.me();
    expect(calls[2]!.headers.authorization).toBe('Bearer a b/c');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('stores the google session token too', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res({ user: null, sessionToken: 'g-1' }));
    await client.googleLogin({ token: 'g' });
    expect(document.cookie).toContain('dripl-session=g-1');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('stores no cookie when the server returns no session token', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res({ user: null }));
    await client.login({ email: 'a@b.c', password: 'p' });
    expect(cookieWrites).toHaveLength(0);
    expect(document.cookie).not.toContain('dripl-session=');
  });

  it('returns the whole login payload, session token included', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res(LOGIN_BODY));
    await expect(client.login({ email: 'a@b.c', password: 'p' })).resolves.toEqual(LOGIN_BODY);
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('clears the client cookie on logout by expiring it immediately', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res(LOGIN_BODY), res({ ok: true }));
    await client.login({ email: 'a@b.c', password: 'p' });
    expect(document.cookie).toContain('dripl-session=sess-1');
    cookieWrites.length = 0;

    await client.logout();

    expect(cookieWrites.at(-1)).toBe('dripl-session=; path=/; max-age=0');
    expect(document.cookie).not.toContain('dripl-session=sess-1');
  });

  it('keeps the cookie when logout fails, so a failed logout is visible', async () => {
    const client = await loadClient();
    stubFetch(csrf('t'), res(LOGIN_BODY), res({ message: 'Session expired' }, { status: 401 }));
    await client.login({ email: 'a@b.c', password: 'p' });
    cookieWrites.length = 0;

    await expect(client.logout()).rejects.toThrow('Session expired');
    // Nothing was expired: the user is still signed in, and silently clearing
    // the cookie would hide a server-side session that is still alive.
    expect(cookieWrites).toHaveLength(0);
    expect(document.cookie).toContain('dripl-session=sess-1');
    document.cookie = 'dripl-session=; path=/; max-age=0';
  });

  it('does not forget the cached CSRF token on logout', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(csrf('t'), res({ ok: true }), res({ ok: true }));
    await client.logout();
    await client.register({ email: 'a@b.c', password: 'p' });
    // One token fetch across both mutations: logout is not a cache flush.
    expect(mock.mock.calls.filter(c => String(c[0]) === CSRF_URL)).toHaveLength(1);
  });
});

describe('createCanvasRoom compatibility shim', () => {
  it('mirrors room.slug into the deprecated roomId', async () => {
    const client = await loadClient();
    const room = { id: 'id-1', slug: 'slug-1', name: 'n', isPublic: true, content: '[]' };
    stubFetch(csrf('t'), res({ room }));
    const result = await client.createCanvasRoom({ name: 'n' });
    expect(result.room).toEqual(room);
    expect(result.roomId).toBe('slug-1');
  });

  it('overrides any roomId the server sent, because roomId is defined as the slug', async () => {
    const client = await loadClient();
    stubFetch(
      csrf('t'),
      res({
        room: { id: 'id-1', slug: 'slug-1', name: 'n', isPublic: true, content: '[]' },
        roomId: 'id-1',
      })
    );
    expect((await client.createCanvasRoom()).roomId).toBe('slug-1');
  });

  it('returns undefined rather than throwing when the response has no room', async () => {
    // The deprecated field reads `response.room.slug`, which throws on a
    // malformed body. Pinned so the shape of the failure is recorded.
    const client = await loadClient();
    stubFetch(csrf('t'), res({}));
    await expect(client.createCanvasRoom()).rejects.toBeDefined();
  });
});

describe('client is reusable after every kind of failure', () => {
  it('keeps working after a transport throw', async () => {
    const client = await loadClient();
    stubFetch(new TypeError('Failed to fetch'));
    await expect(client.me()).rejects.toThrow('Failed to fetch');
    stubFetch(res({ user: { id: 'u', email: 'e', name: null, image: null } }));
    await expect(client.me()).resolves.toBeDefined();
  });

  it('keeps working after a CSRF retry storm', async () => {
    // Attempt 1: stale token -> retry -> stale again -> gives up.
    // Attempt 2: fresh token -> succeeds, so the client is not poisoned.
    const client = await loadClient();
    const { mock } = stubFetch(
      csrf('a'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      csrf('b'),
      res({ message: 'CSRF token missing' }, { status: 403 }),
      res({ ok: true })
    );
    await expect(client.register({ email: 'a@b.c', password: 'p' })).rejects.toThrow(
      'CSRF token missing'
    );
    // The second attempt reuses the token cached by the failed attempt's retry,
    // so it needs no third token fetch and succeeds.
    await expect(client.register({ email: 'a@b.c', password: 'p' })).resolves.toEqual({ ok: true });
    expect(mock.mock.calls.filter(c => String(c[0]) === CSRF_URL)).toHaveLength(2);
    expect(mock).toHaveBeenCalledTimes(5);
  });
});

describe('warm-client smoke path', () => {
  it('reuses a warmed token without another CSRF fetch', async () => {
    const client = await loadClient();
    const { mock } = stubFetch(csrf('t'), res({ user: null }));
    await client.getCsrfToken();
    await client.register({ email: 'a@b.c', password: 'p' });
    await client.forgotPassword({ email: 'a@b.c' });
    expect(mock.mock.calls.filter(c => String(c[0]) === CSRF_URL)).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('falls back to a relative CSRF URL when the base URL is unusable', async () => {
    // `new URL('/csrf-token', base)` throws for a non-absolute base, and the
    // catch returns a root-relative path that the browser resolves against the
    // page. Reachable in production if NEXT_PUBLIC_API_URL is misconfigured.
    const client = await loadClient('not-a-url');
    const { mock } = stubFetch(csrf('t'), res({ ok: true }), res({ ok: true }));
    await client.getCsrfToken();
    expect(String(mock.mock.calls[0]![0])).toBe('/csrf-token');
    await client.register({ email: 'a@b.c', password: 'p' });
    expect(String(mock.mock.calls.at(-1)![0])).toBe('not-a-url/auth/register');
  });
});
