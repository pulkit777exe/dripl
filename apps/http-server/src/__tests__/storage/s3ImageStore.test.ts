import { describe, expect, it } from 'vitest';
import { createS3ImageStore } from '../../storage/s3ImageStore';
import { ImageStoreError, InvalidImageKeyError } from '../../storage/imageStore';
import { sha256Hex, SHA256_OF_EMPTY_PAYLOAD } from '../../storage/sigv4';
import type { S3Fetch, S3FetchInit } from '../../storage/s3ImageStore';

/**
 * The S3 driver with no bucket, no network and no credentials.
 *
 * The seam that makes this possible is `fetch`: the driver signs a request and
 * hands the result to whatever function it was given, so a test can assert on
 * the exact bytes this code produced — URL, headers, payload hash, body — with
 * nothing mocked except the socket. Mocking the driver instead would only
 * prove the mock works.
 */

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const SESSION_TOKEN = 'FQoGZXIvYXdzEBYaTHISisNotARealToken0000000';
const KEY = '9f8b2c1d-0000-4000-8000-abcdefabcdef.png';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const FIXED_NOW = new Date('2026-03-04T05:06:07Z');

interface CapturedRequest {
  url: string;
  init: S3FetchInit;
}

type ScriptedResponse = { status: number; body?: Buffer } | Error;

function scriptedFetch(script: ScriptedResponse[]): { fetch: S3Fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  let index = 0;
  const fetch: S3Fetch = (url, init) => {
    calls.push({ url, init });
    const step = script[index++];
    if (!step) return Promise.reject(new Error(`unexpected request: ${init.method} ${url}`));
    if (step instanceof Error) return Promise.reject(step);
    const bytes = Uint8Array.from(step.body ?? Buffer.alloc(0));
    return Promise.resolve({
      status: step.status,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    });
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

function makeStore(
  fetch: S3Fetch,
  overrides: Partial<Parameters<typeof createS3ImageStore>[0]> = {}
) {
  return createS3ImageStore({
    bucket: 'dripl-images',
    region: 'eu-west-1',
    endpoint: 'https://s3.eu-west-1.amazonaws.com',
    forcePathStyle: true,
    credentials: () => ({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET }),
    fetch,
    now: () => FIXED_NOW,
    ...overrides,
  });
}

/** Pull the three signed pieces back out of an `Authorization` header. */
function parseAuthorization(header: string) {
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/([^/]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      header
    );
  if (!match) throw new Error(`Authorization header does not have the SigV4 shape: ${header}`);
  return {
    accessKeyId: match[1],
    dateStamp: match[2],
    region: match[3],
    service: match[4],
    terminator: match[5],
    signedHeaders: match[6],
    signature: match[7],
  };
}

describe('s3 image store — the signed request it actually sends', () => {
  it('signs a PUT with the payload hash of the body and sends those exact bytes', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    await makeStore(fetch).put(KEY, PNG, 'image/png');

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;

    expect(init.method).toBe('PUT');
    expect(url).toBe(`https://s3.eu-west-1.amazonaws.com/dripl-images/${KEY}`);

    const signed = parseAuthorization(init.headers.authorization!);
    expect(signed.accessKeyId).toBe(ACCESS_KEY);
    expect(signed.dateStamp).toBe('20260304');
    expect(signed.region).toBe('eu-west-1');
    expect(signed.service).toBe('s3');
    expect(signed.terminator).toBe('aws4_request');
    expect(signed.signedHeaders).toBe('content-type;host;x-amz-content-sha256;x-amz-date');

    // The payload hash must be over the bytes on the wire, and the bytes on the
    // wire must be the image, untransformed.
    expect(init.headers['x-amz-content-sha256']).toBe(sha256Hex(PNG));
    expect(Buffer.compare(init.body as Buffer, PNG)).toBe(0);
    expect(init.headers['content-type']).toBe('image/png');
    expect(init.headers['x-amz-date']).toBe('20260304T050607Z');
    expect(init.headers.host).toBeUndefined();
  });

  it('signs a GET with the empty-payload hash and no body', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200, body: PNG }]);
    const body = await makeStore(fetch).get(KEY);

    expect(body?.equals(PNG)).toBe(true);
    const { url, init } = calls[0]!;
    expect(init.method).toBe('GET');
    expect(url).toBe(`https://s3.eu-west-1.amazonaws.com/dripl-images/${KEY}`);
    expect(init.body).toBeUndefined();
    expect(init.headers['x-amz-content-sha256']).toBe(SHA256_OF_EMPTY_PAYLOAD);
    expect(init.headers['content-type']).toBeUndefined();
    expect(parseAuthorization(init.headers.authorization!).signedHeaders).toBe(
      'host;x-amz-content-sha256;x-amz-date'
    );
  });

  it('changes the signature when the region, the body or the key changes', async () => {
    const signatureFor = async (
      overrides: Partial<Parameters<typeof makeStore>[1]> = {},
      key = KEY,
      body = PNG
    ) => {
      const { fetch, calls } = scriptedFetch([{ status: 200 }]);
      await makeStore(fetch, overrides).put(key, body, 'image/png');
      return parseAuthorization(calls[0]!.init.headers.authorization!).signature;
    };

    const signatures = [
      await signatureFor(),
      await signatureFor({ region: 'us-east-2' }),
      await signatureFor({}, KEY, Buffer.from([137, 80, 78, 71])),
      await signatureFor({}, '00000000-0000-4000-8000-000000000000.png'),
    ];

    // Four different requests, four different signatures: nothing about the
    // signature is constant except the algorithm and the key.
    expect(new Set(signatures).size).toBe(4);
  });

  it('addresses the bucket path-style by default and virtual-hosted on request', async () => {
    const pathStyle = scriptedFetch([{ status: 200 }]);
    await makeStore(pathStyle.fetch).put(KEY, PNG, 'image/png');
    expect(pathStyle.calls[0]!.url).toBe(`https://s3.eu-west-1.amazonaws.com/dripl-images/${KEY}`);

    const virtual = scriptedFetch([{ status: 200 }]);
    await makeStore(virtual.fetch, { forcePathStyle: false }).put(KEY, PNG, 'image/png');
    expect(virtual.calls[0]!.url).toBe(`https://dripl-images.s3.eu-west-1.amazonaws.com/${KEY}`);
    // The bucket is in the hostname, so it must not also be in the path.
    expect(new URL(virtual.calls[0]!.url).pathname).toBe(`/${KEY}`);
  });

  it('reaches R2, MinIO and B2 by endpoint alone, with no provider branch', async () => {
    const providers: Array<[string, string]> = [
      ['https://acct.r2.cloudflarestorage.com', 'auto'],
      ['http://127.0.0.1:9000', 'us-east-1'],
      ['https://s3.us-west-004.backblazeb2.com', 'us-west-004'],
    ];

    for (const [endpoint, region] of providers) {
      const { fetch, calls } = scriptedFetch([{ status: 200 }]);
      await makeStore(fetch, { endpoint, region }).put(KEY, PNG, 'image/png');
      expect(calls[0]!.url).toBe(`${endpoint}/dripl-images/${KEY}`);
      // The same code path signs all three; only the endpoint and region differ.
      expect(parseAuthorization(calls[0]!.init.headers.authorization!).region).toBe(region);
      expect(parseAuthorization(calls[0]!.init.headers.authorization!).service).toBe('s3');
    }
  });

  it('resolves credentials per request so a rotated key is picked up', async () => {
    const issued: string[] = ['AKIAFIRST', 'AKIASECOND'];
    let calls = 0;
    const { fetch, calls: requests } = scriptedFetch([{ status: 200 }, { status: 200 }]);
    const store = makeStore(fetch, {
      credentials: () => {
        const accessKeyId = issued[calls++]!;
        return { accessKeyId, secretAccessKey: SECRET };
      },
    });

    await store.put(KEY, PNG, 'image/png');
    await store.put(KEY, PNG, 'image/png');

    expect(
      requests.map(r => parseAuthorization(r.init.headers.authorization!).accessKeyId)
    ).toEqual(['AKIAFIRST', 'AKIASECOND']);
  });

  it('sends a session token as x-amz-security-token and signs it', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    await makeStore(fetch, {
      credentials: () => ({
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET,
        sessionToken: SESSION_TOKEN,
      }),
    }).put(KEY, PNG, 'image/png');

    const { init } = calls[0]!;
    expect(init.headers['x-amz-security-token']).toBe(SESSION_TOKEN);
    expect(parseAuthorization(init.headers.authorization!).signedHeaders).toContain(
      'x-amz-security-token'
    );
  });

  it('bounds every request with an abort signal', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    await makeStore(fetch, { requestTimeoutMs: 1234 }).put(KEY, PNG, 'image/png');

    const signal = calls[0]!.init.signal;
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
  });
});

describe('s3 image store — failure behaviour', () => {
  it('reports 404 as absence, not as a failure', async () => {
    const { fetch } = scriptedFetch([{ status: 404 }]);
    await expect(makeStore(fetch).get(KEY)).resolves.toBeNull();
  });

  it('refuses to conflate a permission failure with absence', async () => {
    const { fetch } = scriptedFetch([{ status: 403 }]);
    const error = await failure(makeStore(fetch).get(KEY));

    expect(error.code).toBe('forbidden');
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(403);
    expect(error.storeKind).toBe('s3');
  });

  it('marks a 5xx retryable and a 4xx not', async () => {
    const server = await failure(makeStore(scriptedFetch([{ status: 503 }]).fetch).get(KEY));
    const client = await failure(makeStore(scriptedFetch([{ status: 400 }]).fetch).get(KEY));

    expect(server.retryable).toBe(true);
    expect(server.code).toBe('unexpected_response');
    expect(client.retryable).toBe(false);
  });

  it('never falls back to a local directory when the bucket is unreachable', async () => {
    const { fetch, calls } = scriptedFetch([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ]);
    const store = makeStore(fetch);

    const readError = await failure(store.get(KEY));
    const writeError = await failure(store.put(KEY, PNG, 'image/png'));

    expect(calls).toHaveLength(2);
    for (const error of [readError, writeError]) {
      expect(error.code).toBe('unreachable');
      expect(error.retryable).toBe(true);
      expect(error.storeKind).toBe('s3');
    }
  });

  it('rejects a key that is not in our own generated format before any request', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 200 }]);
    const store = makeStore(fetch);

    for (const key of [
      '../secret.png',
      'a/b.png',
      'x.png/../../y',
      '%2e%2e%2fsecret.png',
      'secret.png ',
      '',
      'not-an-image.txt',
      'zzzz.png',
    ]) {
      await expect(store.get(key)).rejects.toBeInstanceOf(InvalidImageKeyError);
      await expect(store.put(key, PNG, 'image/png')).rejects.toBeInstanceOf(InvalidImageKeyError);
    }
    // Not one request was attempted, so a traversal-shaped id cannot become a
    // URL path segment even before the route's own validation is considered.
    expect(calls).toHaveLength(0);
  });

  it('accepts the four extensions the route allows, case-insensitively', async () => {
    for (const key of ['abc123.png', 'abc123.jpg', 'abc123.gif', 'abc123.webp', 'ABC.PNG']) {
      const { fetch, calls } = scriptedFetch([{ status: 404 }]);
      await expect(makeStore(fetch).get(key)).resolves.toBeNull();
      expect(calls).toHaveLength(1);
    }
  });
});

describe('s3 image store — credential material never leaves the Authorization header', () => {
  /**
   * The classic way this goes wrong is a credential in a URL: a presigned link
   * that ends up in browser history, a `Referer` header, or an access log. The
   * second classic is an error message built by interpolating a request line,
   * which then gets logged and shipped to whatever error tracker is configured.
   *
   * So this test collects every string the driver emits — the URL of every
   * request, every header value, and the message of every error it can produce
   * — and asserts that the secret access key appears in none of them, and that
   * the access key id appears only inside the `Authorization` header.
   */
  it('never emits the secret key, and never emits an identifier outside Authorization', async () => {
    const credentials = () => ({
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET,
      sessionToken: SESSION_TOKEN,
    });

    const { fetch, calls } = scriptedFetch([
      { status: 200 },
      { status: 200, body: PNG },
      { status: 403 },
      { status: 500 },
      { status: 404 },
      new TypeError('connect ECONNREFUSED 10.0.0.1:443'),
    ]);
    const store = createS3ImageStore({
      bucket: 'dripl-images',
      region: 'eu-west-1',
      endpoint: 'https://s3.eu-west-1.amazonaws.com',
      forcePathStyle: true,
      credentials,
      fetch,
      now: () => FIXED_NOW,
    });

    await store.put(KEY, PNG, 'image/png');
    await store.get(KEY);
    // Every status this driver can produce an error for, plus a transport
    // failure, so no error path escapes the sweep below.
    const errorMessages: string[] = [];
    for (const call of [
      () => store.get(KEY),
      () => store.get(KEY),
      () => store.get(KEY),
      () => store.put(KEY, PNG, 'image/png'),
      () => store.get(KEY),
    ]) {
      errorMessages.push(
        await call().then(
          () => '',
          (e: unknown) => String(e)
        )
      );
    }

    const urls = calls.map(call => call.url);
    const headerValues = calls.flatMap(call => Object.entries(call.init.headers).map(([, v]) => v));

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toContain(SECRET);
      expect(url).not.toContain(SESSION_TOKEN);
      expect(url).not.toContain(ACCESS_KEY);
    }
    for (const value of headerValues) {
      expect(value).not.toContain(SECRET);
    }
    for (const message of errorMessages) {
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(SESSION_TOKEN);
      expect(message).not.toContain(ACCESS_KEY);
    }

    // The one place the access key id is allowed to appear.
    for (const call of calls) {
      const authorization = call.init.headers.authorization!;
      expect(authorization).toContain(ACCESS_KEY);
      for (const [name, value] of Object.entries(call.init.headers)) {
        if (name !== 'authorization') expect(value).not.toContain(ACCESS_KEY);
      }
    }
    // And the session token is confined to the header the protocol names.
    for (const call of calls) {
      for (const [name, value] of Object.entries(call.init.headers)) {
        if (name !== 'x-amz-security-token') expect(value).not.toContain(SESSION_TOKEN);
      }
    }
  });

  it('redacts credentials that an upstream error message happens to contain', async () => {
    // A fetch implementation that echoes the request into its error text is
    // exactly the leak this guards, and it is outside this module's control.
    const { fetch } = scriptedFetch([
      new Error(`request failed for key ${SECRET} with token ${SESSION_TOKEN}`),
    ]);

    const error = await failure(
      makeStore(fetch, {
        credentials: () => ({
          accessKeyId: ACCESS_KEY,
          secretAccessKey: SECRET,
          sessionToken: SESSION_TOKEN,
        }),
      }).get(KEY)
    );

    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(SESSION_TOKEN);
    // It stays diagnosable: what the error was, and where it went.
    expect(error.message).toContain('s3.eu-west-1.amazonaws.com');
    expect(error.message).toContain('GET');
  });
});
