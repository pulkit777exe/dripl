import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  createFirebaseImageStore,
  createFirebaseSigner,
  DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS,
  FIREBASE_STORAGE_PREFIXES,
  FIREBASE_STORAGE_SCOPE,
  normalizeFirebasePrivateKey,
  redactFirebaseSecrets,
  type FirebaseFetch,
  type FirebaseFetchInit,
  type FirebaseFetchResponse,
  type FirebaseImageStoreOptions,
  type FirebaseServiceAccount,
} from '../../storage/firebaseImageStore';
import {
  ImageStoreError,
  InvalidImageKeyError,
  type ImageStoreKind,
} from '../../storage/imageStore';

/**
 * The Firebase driver with no bucket, no network and no credentials.
 *
 * Two seams make that possible, and the split between them is the point:
 * `fetch` receives the fully-built request, so these tests assert on the URL,
 * the headers and the bytes this code produced rather than on a mock of it;
 * and `signer` replaces the token mint wholesale, so nothing here reaches
 * `oauth2.googleapis.com` and no test needs a service account.
 *
 * The private key below is generated in-process, not pasted. It is a real
 * RSA key that signs nothing anyone can use, and it is the honest way to test
 * that the driver accepts a genuine PEM — a fake one would make the
 * "rejects a mangled key" test pass for the wrong reason.
 */
const { privateKey: generatedKeyObject } = generateKeyPairSync('rsa', { modulusLength: 2048 });
/**
 * Trimmed, because `normalizeFirebasePrivateKey` trims: a PEM arrives with a
 * trailing newline from `export`, and the env file that carries it adds more.
 * Comparing against the untrimmed form would assert that the normalizer
 * *adds* whitespace.
 */
const PRIVATE_KEY_PEM = generatedKeyObject
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .trim();

/** A private key as service-account JSON actually delivers it to a process. */
const PRIVATE_KEY_JSON_ESCAPED = JSON.stringify(PRIVATE_KEY_PEM).slice(1, -1);

const CLIENT_EMAIL = 'dripl-images@dripl-staging.iam.gserviceaccount.com';
const KEY = '9f8b2c1d-0000-4000-8000-abcdefabcdef.png';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const FIXED_NOW = new Date('2026-03-04T05:06:07Z');
const FIXED_NOW_MS = FIXED_NOW.getTime();
const TOKEN = 'ya29.stub-access-token-that-is-not-real';

interface CapturedRequest {
  url: string;
  init: FirebaseFetchInit;
}

type ScriptedResponse = { status: number; body?: Buffer; headers?: Record<string, string> } | Error;

function responseOf(step: Exclude<ScriptedResponse, Error>): FirebaseFetchResponse {
  const bytes = Uint8Array.from(step.body ?? Buffer.alloc(0));
  const headerLookup = step.headers;
  return {
    status: step.status,
    arrayBuffer: () => Promise.resolve(bytes.buffer),
    headers: headerLookup
      ? { get: (name: string) => headerLookup[name.toLowerCase()] ?? null }
      : null,
  };
}

function scriptedFetch(script: ScriptedResponse[]): {
  fetch: FirebaseFetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  let index = 0;
  const fetch: FirebaseFetch = (url, init) => {
    calls.push({ url, init });
    const step = script[index++];
    if (!step) return Promise.reject(new Error(`unexpected request: ${init.method} ${url}`));
    if (step instanceof Error) return Promise.reject(step);
    return Promise.resolve(responseOf(step));
  };
  return { fetch, calls };
}

/** Run an operation that is expected to fail and hand back the typed error. */
async function failure(promise: Promise<unknown>): Promise<ImageStoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImageStoreError) return error;
    throw error;
  }
  throw new Error('expected an ImageStoreError, but the operation succeeded');
}

/** A signer that always mints the same token, with an hour of validity. */
function stubSigner(token = TOKEN) {
  let calls = 0;
  return {
    calls: () => calls,
    sign: async () => {
      calls += 1;
      return { token, expiresAt: FIXED_NOW_MS + 3_600_000 };
    },
  };
}

function makeStore(overrides: Partial<FirebaseImageStoreOptions> = {}): {
  store: ReturnType<typeof createFirebaseImageStore>;
  signer: ReturnType<typeof stubSigner>;
} {
  const signer = stubSigner();
  const store = createFirebaseImageStore({
    bucket: 'dripl-images.appspot.com',
    endpoint: 'https://firebasestorage.googleapis.com',
    prefix: FIREBASE_STORAGE_PREFIXES.images,
    serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM },
    fetch: scriptedFetch([{ status: 200 }]).fetch,
    signer: signer.sign,
    now: () => FIXED_NOW,
    ...overrides,
  });
  return { store, signer };
}

/** The Google JSON error document Firebase returns for a failed request. */
function googleErrorBody(status: number, googleStatus: string, message: string, reason?: string) {
  return Buffer.from(
    JSON.stringify({
      error: {
        code: status,
        message,
        status: googleStatus,
        ...(reason ? { errors: [{ domain: 'global', reason, message }] } : {}),
      },
    })
  );
}

describe('firebase image store — the request it actually sends', () => {
  it('uploads with a bearer token, the media upload type, and the key under the prefix', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    const { store } = makeStore({ fetch });

    await store.put(KEY, PNG, 'image/png');

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;

    // POST, not PUT: Firebase Storage has no PUT verb. The path is the bucket,
    // the query carries `uploadType=media` (single-request upload) and the
    // object name — and the name's `/` is percent-encoded, which is the whole
    // reason `assertImageKey` and this driver's prefix check both exist.
    expect(init.method).toBe('POST');
    expect(url).toBe(
      'https://firebasestorage.googleapis.com/v0/b/dripl-images.appspot.com/o' +
        `?uploadType=media&name=images%2F${KEY}`
    );
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['content-type']).toBe('image/png');
    // The bytes on the wire must be the image, untransformed.
    expect(Buffer.compare(init.body as Buffer, PNG)).toBe(0);
  });

  it('downloads the bytes with alt=media in one round trip, not two', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, body: PNG }]);
    const { store } = makeStore({ fetch });

    const body = await store.get(KEY);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(init.method).toBe('GET');
    expect(url).toBe(
      'https://firebasestorage.googleapis.com/v0/b/dripl-images.appspot.com/o/' +
        `${encodeURIComponent(`images/${KEY}`)}?alt=media`
    );
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.body).toBeUndefined();
    expect(Buffer.compare(body as Buffer, PNG)).toBe(0);
  });

  it('honours a custom prefix rather than hard-coding the default', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    const { store } = makeStore({ fetch, prefix: 'tenants/acme/images' });

    await store.put(KEY, PNG, 'image/png');

    expect(calls[0]!.url).toContain(`name=${encodeURIComponent(`tenants/acme/images/${KEY}`)}`);
  });

  it('sends nothing but the authorization header on a download', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, body: PNG }]);
    const { store } = makeStore({ fetch });

    await store.get(KEY);

    // A content type on a body-less GET would be a lie about the request.
    expect(Object.keys(calls[0]!.init.headers)).toEqual(['authorization']);
  });

  it('reports itself as the firebase kind', () => {
    expect(makeStore().store.kind).toBe('firebase');
  });
});

describe('the ImageStoreKind union — pinned to exactly the three drivers', () => {
  it('has no member beyond filesystem, s3 and firebase', () => {
    // Compile-time assertion, asserted at runtime as well: a union is widened
    // silently, so nothing else in this suite would notice a fourth driver
    // kind appearing — and a `kind` the driver does not implement is exactly
    // how a config resolver ends up handing the route a store that lies about
    // which backend it is using. `NoOtherKind extends ...` fails to compile if a
    // member is added.
    type Kind = ImageStoreKind;
    type NoOtherKind = Kind extends 'filesystem' | 's3' | 'firebase' ? true : never;
    const exact: NoOtherKind = true;

    const declared: readonly Kind[] = ['filesystem', 's3', 'firebase'];
    expect(declared).toHaveLength(3);
    expect(exact).toBe(true);
  });

  it('is what the firebase store reports, so kind and union cannot drift', () => {
    const kind: ImageStoreKind = makeStore().store.kind;
    expect(kind).toBe('firebase');
  });
});

describe('firebase image store — the token seam', () => {
  it('mints once and reuses the token across requests', async () => {
    const { fetch } = scriptedFetch([{ status: 200 }, { status: 200 }, { status: 200 }]);
    const { store, signer } = makeStore({ fetch });

    await store.put(KEY, PNG, 'image/png');
    await store.get(KEY);
    await store.get(KEY);

    // The signer is per-request-resolved (so a rotated key is picked up), but a
    // live token is cached: three requests, one token.
    expect(signer.calls()).toBe(1);
  });

  it('re-mints when the cached token is inside the refresh skew', async () => {
    const { fetch } = scriptedFetch([{ status: 200 }, { status: 200 }]);
    // Expires one minute from now, which is inside the five-minute skew, so
    // the cached token is never treated as usable and the signer runs per
    // request.
    const signer = {
      calls: 0,
      sign: async () => {
        signer.calls += 1;
        return { token: TOKEN, expiresAt: FIXED_NOW_MS + 60_000 };
      },
    };
    const store = createFirebaseImageStore({
      bucket: 'dripl-images.appspot.com',
      endpoint: 'https://firebasestorage.googleapis.com',
      prefix: 'images',
      serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM },
      fetch,
      signer: signer.sign,
      now: () => FIXED_NOW,
    });

    await store.get(KEY);
    await store.get(KEY);

    expect(signer.calls).toBe(2);
  });

  it('rejects a signer that returns no token as not_configured', async () => {
    const { fetch } = scriptedFetch([{ status: 200 }]);
    const { store } = makeStore({ fetch, signer: async () => ({ token: '', expiresAt: 0 }) });

    const error = await failure(store.get(KEY));

    expect(error.code).toBe('not_configured');
    expect(error.storeKind).toBe('firebase');
  });

  it('never trusts a signer-supplied expiry that is already in the past', async () => {
    // A signer that says its token died a minute ago is either broken or lying.
    // Believing it means re-minting on every request forever; believing a
    // future-but-absurd expiry means caching a dead token until Firebase 401s.
    // The replacement is Google's one-hour lifetime in both cases, and the
    // observable consequence is that a single mint serves many requests.
    const { fetch } = scriptedFetch([{ status: 200 }, { status: 200 }]);
    const signer = {
      calls: 0,
      sign: async () => {
        signer.calls += 1;
        return { token: TOKEN, expiresAt: FIXED_NOW_MS - 60_000 };
      },
    };
    const store = createFirebaseImageStore({
      bucket: 'dripl-images.appspot.com',
      endpoint: 'https://firebasestorage.googleapis.com',
      prefix: 'images',
      serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM },
      fetch,
      signer: signer.sign,
      now: () => FIXED_NOW,
    });

    await store.get(KEY);
    await store.get(KEY);

    // Trusting the stale expiry would give 2; substituting a usable one gives 1.
    expect(signer.calls).toBe(1);
  });

  it('never trusts a non-finite expiry either', async () => {
    const { fetch } = scriptedFetch([{ status: 200 }, { status: 200 }]);
    const signer = {
      calls: 0,
      sign: async () => {
        signer.calls += 1;
        return { token: TOKEN, expiresAt: Number.NaN };
      },
    };
    const store = createFirebaseImageStore({
      bucket: 'dripl-images.appspot.com',
      endpoint: 'https://firebasestorage.googleapis.com',
      prefix: 'images',
      serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM },
      fetch,
      signer: signer.sign,
      now: () => FIXED_NOW,
    });

    await store.get(KEY);
    await store.get(KEY);

    expect(signer.calls).toBe(1);
  });

  it('turns a signer failure into a typed error, never a raw crypto throw', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    const { store } = makeStore({
      fetch,
      signer: async () => {
        throw new Error('connect ECONNREFUSED oauth2.googleapis.com:443');
      },
    });

    const error = await failure(store.get(KEY));

    expect(error.code).toBe('unreachable');
    expect(error.retryable).toBe(true);
    // No request is attempted with no token to send it with.
    expect(calls).toHaveLength(0);
  });
});

describe('firebase image store — absence is not an error', () => {
  it('returns null for a 404 on read, and does not read the body', async () => {
    const { fetch } = scriptedFetch([
      { status: 404, body: googleErrorBody(404, 'NOT_FOUND', 'Not Found', 'notFound') },
    ]);
    const { store } = makeStore({ fetch });

    expect(await store.get(KEY)).toBeNull();
  });

  it('does NOT return null for a 403, because "may not read" is not "absent"', async () => {
    // The regression this guards: a revoked service account must not make every
    // image in the deployment report itself as a 404.
    const { fetch } = scriptedFetch([
      { status: 403, body: googleErrorBody(403, 'PERMISSION_DENIED', 'Permission denied') },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.code).toBe('forbidden');
  });
});

describe('firebase image store — failure modes map to distinct codes', () => {
  it('maps 401 to forbidden, because the token was rejected rather than the request', async () => {
    const { fetch } = scriptedFetch([
      {
        status: 401,
        body: googleErrorBody(
          401,
          'UNAUTHENTICATED',
          'Request had invalid authentication credentials.'
        ),
      },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.code).toBe('forbidden');
    expect(error.status).toBe(401);
    // Repeating an identical request cannot fix a rejected credential.
    expect(error.retryable).toBe(false);
  });

  it('maps 403 to forbidden with the permission explanation', async () => {
    const { fetch } = scriptedFetch([
      {
        status: 403,
        body: googleErrorBody(403, 'PERMISSION_DENIED', 'Required IAM permission', 'forbidden'),
      },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.put(KEY, PNG, 'image/png'));

    expect(error.code).toBe('forbidden');
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('lacks permission');
    // Google's own status and reason are carried through for the log.
    expect(error.message).toContain('PERMISSION_DENIED');
  });

  it('maps 400 to unexpected_response and not retryable: a bad request stays bad', async () => {
    const { fetch } = scriptedFetch([
      { status: 400, body: googleErrorBody(400, 'INVALID_ARGUMENT', 'Invalid object name') },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.put(KEY, PNG, 'image/png'));

    expect(error.code).toBe('unexpected_response');
    expect(error.status).toBe(400);
    expect(error.retryable).toBe(false);
  });

  it('maps a 404 on upload to unexpected_response, not not_configured', async () => {
    // Firebase returns the identical 404 for "no such object" and "no such
    // bucket". The driver cannot prove which, so it must not claim the
    // configuration is broken — that would send an operator to fix env vars
    // that are fine.
    const { fetch } = scriptedFetch([
      { status: 404, body: googleErrorBody(404, 'NOT_FOUND', 'Not Found', 'notFound') },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.put(KEY, PNG, 'image/png'));

    expect(error.code).toBe('unexpected_response');
    expect(error.code).not.toBe('not_configured');
    expect(error.message).toContain('does not distinguish');
  });

  it.each([
    ['a 429 rate limit', 429, 'RESOURCE_EXHAUSTED', true],
    ['a 500', 500, 'INTERNAL', true],
    ['a 503', 503, 'UNAVAILABLE', true],
    ['a 408 deadline', 408, 'DEADLINE_EXCEEDED', true],
  ])('marks %s retryable and not forbidden', async (_label, status, googleStatus, retryable) => {
    const { fetch } = scriptedFetch([
      { status, body: googleErrorBody(status, googleStatus, 'transient') },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    // The backend ANSWERED, so this is `unexpected_response` rather than
    // `unreachable` — the code means "the backend could not be reached", and a
    // 503 is a reach.
    expect(error.code).toBe('unexpected_response');
    expect(error.retryable).toBe(retryable);
  });

  it('survives a non-JSON error body', async () => {
    const { fetch } = scriptedFetch([
      { status: 500, body: Buffer.from('<html>upstream connect error</html>', 'utf8') },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.code).toBe('unexpected_response');
    expect(error.status).toBe(500);
  });

  it('maps a transport failure to unreachable and retryable', async () => {
    const { fetch } = scriptedFetch([new Error('fetch failed: ECONNRESET')]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.put(KEY, PNG, 'image/png'));

    expect(error.code).toBe('unreachable');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('ECONNRESET');
  });

  it('does not read a huge error body into a log line', async () => {
    // A large VALID error document, so the only thing keeping it out of the
    // message is the read cap. A large blob of junk would pass either way: an
    // unparseable body contributes nothing to the message, so the test would
    // pass for the wrong reason.
    const { fetch } = scriptedFetch([
      {
        status: 500,
        headers: { 'content-length': String(2 * 1024 * 1024) },
        body: googleErrorBody(500, 'INTERNAL', `spilled: ${'x'.repeat(2 * 1024 * 1024)}`),
      },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.message).not.toContain('spilled');
    expect(error.message.length).toBeLessThan(1024);
  });

  it('bounds a body whose content-length lied about being small', async () => {
    // The declared length is only allowed to decide whether reading is worth
    // it. The slice is what actually bounds what reaches a log, because a
    // lying or absent content-length cannot make that read past the cap.
    const { fetch } = scriptedFetch([
      {
        status: 500,
        headers: { 'content-length': '12' },
        body: googleErrorBody(500, 'INTERNAL', `spilled: ${'y'.repeat(512 * 1024)}`),
      },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.message).not.toContain('spilled');
    expect(error.message.length).toBeLessThan(1024);
  });

  it('still carries a small error body through, so the cap costs nothing useful', async () => {
    // The opposite probe: a cap that also ate the diagnostics would satisfy both
    // assertions above and be useless on-call.
    const { fetch } = scriptedFetch([
      {
        status: 500,
        body: googleErrorBody(500, 'INTERNAL', 'backend connect error', 'backendError'),
      },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.message).toContain('INTERNAL');
    expect(error.message).toContain('backend connect error');
    expect(error.message).toContain('backendError');
  });
});

describe('firebase image store — never leaks a credential', () => {
  it('keeps the private key out of a message that quotes a failing request', async () => {
    const leakyFetch: FirebaseFetch = () =>
      Promise.reject(new Error(`signing failed; key was ${PRIVATE_KEY_PEM}`));
    const { store } = makeStore({ fetch: leakyFetch });

    const error = await failure(store.get(KEY));

    expect(error.message).not.toContain('BEGIN PRIVATE KEY');
    expect(error.message).toContain('[redacted]');
  });

  it('keeps the bearer token out of a transport error message', async () => {
    const leakyFetch: FirebaseFetch = () =>
      Promise.reject(new Error(`socket closed while sending Authorization: Bearer ${TOKEN}`));
    const { store } = makeStore({ fetch: leakyFetch });

    const error = await failure(store.get(KEY));

    expect(error.message).not.toContain(TOKEN);
  });

  it('keeps a reflected private key out of a remote error body', async () => {
    const { fetch } = scriptedFetch([
      { status: 400, body: Buffer.from(JSON.stringify({ error: { message: PRIVATE_KEY_PEM } })) },
    ]);
    const { store } = makeStore({ fetch });

    const error = await failure(store.get(KEY));

    expect(error.message).not.toContain('BEGIN PRIVATE KEY');
  });
});

describe('redactFirebaseSecrets', () => {
  it('redacts every secret it is given and leaves the rest legible', () => {
    const out = redactFirebaseSecrets('a=one b=two c=three', ['one', 'three']);
    expect(out).toBe('a=[redacted] b=two c=[redacted]');
  });

  it('ignores empty and non-string entries rather than blanking the message', () => {
    // An empty string as a needle would match between every character.
    expect(redactFirebaseSecrets('unchanged', ['', 'absent'])).toBe('unchanged');
  });
});

describe('firebase image store — key validation and the request budget', () => {
  it('refuses a key that is not an image id, before any request', async () => {
    const { fetch, calls } = scriptedFetch([]);
    const { store } = makeStore({ fetch });

    await expect(store.put('../escape.png', PNG, 'image/png')).rejects.toBeInstanceOf(
      InvalidImageKeyError
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a traversal-shaped key on read too', async () => {
    const { fetch, calls } = scriptedFetch([]);
    const { store } = makeStore({ fetch });

    await expect(store.get('a/b.png')).rejects.toBeInstanceOf(InvalidImageKeyError);
    expect(calls).toHaveLength(0);
  });

  it('bounds every request with a timeout signal', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    const { store } = makeStore({ fetch, requestTimeoutMs: 1234 });

    await store.get(KEY);

    const signal = calls[0]!.init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('defaults the timeout rather than leaving a request unbounded', () => {
    expect(DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS).toBe(15_000);
  });
});

describe('createFirebaseSigner — key handling, checked without a network', () => {
  const serviceAccount: FirebaseServiceAccount = {
    clientEmail: CLIENT_EMAIL,
    privateKey: PRIVATE_KEY_PEM,
  };

  it('accepts a real PEM, so a mangle is what makes it throw rather than a fixture', () => {
    expect(() => createFirebaseSigner({ serviceAccount })).not.toThrow();
  });

  it('rejects a mangled private key at construction, not inside a request', () => {
    // The point of the eager check: this is a `not_configured` at build time
    // rather than an opaque OpenSSL throw from inside a user's upload.
    expect(() =>
      createFirebaseSigner({
        serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: 'not-a-pem' },
      })
    ).toThrow(ImageStoreError);
  });

  it('does not echo the key it rejected', () => {
    try {
      createFirebaseSigner({
        serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: 'leaky-key' },
      });
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as ImageStoreError).code).toBe('not_configured');
      expect((error as Error).message).not.toContain('leaky-key');
      expect((error as Error).message).toContain('IMAGE_FIREBASE_PRIVATE_KEY');
    }
  });
});

describe('normalizeFirebasePrivateKey — the JSON escaping trap', () => {
  it('turns the literal backslash-n of service-account JSON into newlines', () => {
    const normalized = normalizeFirebasePrivateKey(PRIVATE_KEY_JSON_ESCAPED);

    expect(normalized).toBe(PRIVATE_KEY_PEM);
    // And the result is actually usable, which is the whole point.
    expect(() =>
      createFirebaseSigner({
        serviceAccount: { clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_JSON_ESCAPED },
      })
    ).not.toThrow();
  });

  it('leaves a key that already has real newlines exactly as it is', () => {
    expect(normalizeFirebasePrivateKey(PRIVATE_KEY_PEM)).toBe(PRIVATE_KEY_PEM);
  });

  it('trims the surrounding whitespace an env file leaves behind', () => {
    expect(normalizeFirebasePrivateKey(`\n${PRIVATE_KEY_PEM}\n`)).toBe(PRIVATE_KEY_PEM);
  });

  it('yields empty for an unset variable rather than throwing', () => {
    expect(normalizeFirebasePrivateKey('')).toBe('');
    expect(normalizeFirebasePrivateKey('   ')).toBe('');
  });
});

describe('the Excalidraw-derived names this driver keeps', () => {
  it('names the single prefix it actually implements', () => {
    // Upstream declares files/scenes/snapshots because it stores whole
    // documents. This driver stores one kind of thing, and declaring the rest
    // would be a list of features that do not exist.
    expect(FIREBASE_STORAGE_PREFIXES).toEqual({ images: 'images' });
  });

  it('requests the read_write scope, because it both uploads and downloads', () => {
    // A read-only scope would make every `put` fail with a 403 that reads as a
    // permissions problem rather than a scope problem.
    expect(FIREBASE_STORAGE_SCOPE).toBe('https://www.googleapis.com/auth/devstorage.read_write');
  });
});
