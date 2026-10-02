import { ImageStoreError, assertImageKey, type ImageStore } from './imageStore';
import {
  SHA256_OF_EMPTY_PAYLOAD,
  sha256Hex,
  signRequest,
  uriEncode,
  type SigV4Credentials,
} from './sigv4';

/**
 * The second driver: plain S3 REST requests signed with SigV4.
 *
 * "Plain S3 REST" is the whole compatibility strategy. AWS S3, Cloudflare R2,
 * MinIO and Backblaze B2 all speak the same HTTP API with the same signing
 * scheme and differ only in endpoint, region, and addressing style. There is
 * no provider branch anywhere in this file, and adding one would be the signal
 * that the abstraction has leaked.
 */

export interface S3Credentials extends SigV4Credentials {
  /** Present for temporary credentials (STS, IAM roles). Sent as `x-amz-security-token`. */
  sessionToken?: string;
}

/**
 * Resolved per request rather than captured once, so a credential that rotates
 * underneath a long-running process is picked up without a restart.
 */
export type S3CredentialProvider = () => S3Credentials | Promise<S3Credentials>;

export interface S3FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
}

export interface S3FetchResponse {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * The HTTP seam. Taking it as a parameter is what lets this driver be tested
 * against an exact signed request with no network and no bucket: the test
 * asserts on the bytes this code produces rather than on a mock of this code.
 */
export type S3Fetch = (url: string, init: S3FetchInit) => Promise<S3FetchResponse>;

export interface S3ImageStoreOptions {
  bucket: string;
  region: string;
  /** Absolute origin, e.g. `https://s3.us-east-1.amazonaws.com`. */
  endpoint: string;
  /**
   * `true` addresses objects as `{endpoint}/{bucket}/{key}`; `false` as
   * `{bucket}.{endpoint}/{key}`.
   *
   * Path style is the default because it is the only style R2, MinIO and B2
   * support with a single wildcard-free hostname, and AWS still accepts it for
   * existing buckets. Virtual-hosted style is the escape hatch for a
   * bucket created where AWS has retired path-style addressing.
   */
  forcePathStyle: boolean;
  credentials: S3CredentialProvider;
  fetch?: S3Fetch;
  now?: () => Date;
  /**
   * Upper bound on one request. Without it, a black-holed network holds the
   * HTTP connection open indefinitely and the image request hangs instead of
   * failing — which is the same outage as far as the user is concerned, but
   * without a log line.
   */
  requestTimeoutMs?: number;
}

export const DEFAULT_S3_REQUEST_TIMEOUT_MS = 15_000;

/** SigV4's service scope for every S3-compatible endpoint. */
const S3_SERVICE = 's3';

export function createS3ImageStore(options: S3ImageStoreOptions): ImageStore {
  const endpoint = new URL(options.endpoint);
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_S3_REQUEST_TIMEOUT_MS;

  const objectUrl = (key: string): string => {
    const encodedKey = key
      .split('/')
      .map(segment => uriEncode(segment))
      .join('/');
    if (options.forcePathStyle) {
      return `${endpoint.protocol}//${endpoint.host}/${options.bucket}/${encodedKey}`;
    }
    return `${endpoint.protocol}//${options.bucket}.${endpoint.host}/${encodedKey}`;
  };

  const send = async (
    key: string,
    method: 'GET' | 'PUT',
    body: Buffer | undefined,
    contentType: string | undefined
  ): Promise<S3FetchResponse> => {
    const credentials = await options.credentials();
    // S3 requires `x-amz-content-sha256` on the wire for SigV4 header auth;
    // it is not just an input to the hash. Sent unsigned-payload style instead
    // would need the bucket to be configured for it.
    const payloadHash = body ? sha256Hex(body) : SHA256_OF_EMPTY_PAYLOAD;
    const extraHeaders: Record<string, string> = { 'x-amz-content-sha256': payloadHash };
    if (contentType !== undefined) extraHeaders['content-type'] = contentType;
    if (credentials.sessionToken) {
      extraHeaders['x-amz-security-token'] = credentials.sessionToken;
    }

    const signed = signRequest({
      method,
      host: endpoint.host,
      path: key,
      headers: extraHeaders,
      payloadHash,
      credentials,
      region: options.region,
      service: S3_SERVICE,
      date: now(),
    });

    const url = objectUrl(key);
    const init: S3FetchInit = { method, headers: signed.headers };
    if (body) init.body = body;
    init.signal = AbortSignal.timeout(timeoutMs);

    let response: S3FetchResponse;
    try {
      response = await (options.fetch ?? defaultFetch)(url, init);
    } catch (error) {
      throw new ImageStoreError({
        code: 'unreachable',
        storeKind: 's3',
        retryable: true,
        message:
          `Image object store at ${endpoint.host} did not answer ` +
          `${method} ${key}: ${redact(describe(error), credentials)}`,
      });
    }
    return response;
  };

  return {
    kind: 's3',

    async put(key: string, body: Buffer, contentType: string): Promise<void> {
      assertImageKey(key);
      const response = await send(key, 'PUT', body, contentType);
      if (response.status < 200 || response.status >= 300) {
        throw failure(key, 'PUT', response.status);
      }
      // The body is not read on success either: an S3 PUT echoes nothing, and
      // draining an unread response keeps the socket from stalling teardown.
      await response.arrayBuffer().catch(() => undefined);
    },

    async get(key: string): Promise<Buffer | null> {
      assertImageKey(key);
      const response = await send(key, 'GET', undefined, undefined);
      // 404 is the one non-success status that is a normal answer. A 403 is
      // not treated as absence on purpose: "we may not read this" and "this
      // does not exist" are different facts, and collapsing them would make an
      // expired or under-scoped key look like a deleted image.
      if (response.status === 404) return null;
      if (response.status < 200 || response.status >= 300) {
        throw failure(key, 'GET', response.status);
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

function failure(key: string, method: string, status: number): ImageStoreError {
  const forbidden = status === 401 || status === 403;
  return new ImageStoreError({
    code: forbidden ? 'forbidden' : 'unexpected_response',
    storeKind: 's3',
    // 5xx and 429 are worth another attempt; 4xx means the request or the
    // credentials are wrong and repeating it verbatim will not help.
    retryable: status >= 500 || status === 429,
    status,
    message:
      `Image object store rejected ${method} ${key} with status ${status}` +
      (forbidden ? ' (credentials or bucket policy refused the request)' : ''),
  });
}

/**
 * Redact credential material out of any string this module is about to put in
 * an error message.
 *
 * The driver never writes a secret into a URL or a log line by construction —
 * the access key id appears only in the `Credential=` field of the
 * `Authorization` header, the session token only in `x-amz-security-token`,
 * and the secret key nowhere at all. This is the belt to that braces: an
 * upstream library's error message is text this code does not control, so it
 * is scrubbed before it can reach a log. Redaction is by exact substring, so
 * the original message stays legible.
 */
export function redact(message: string, credentials: S3Credentials): string {
  const secrets = [credentials.secretAccessKey, credentials.accessKeyId, credentials.sessionToken];
  let out = message;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}

/**
 * Declared without the ambient DOM lib's `fetch` type so this module's
 * compilation does not depend on which `lib` the consuming tsconfig happens to
 * select. The runtime object is the platform's `fetch`, and it is structurally
 * compatible.
 */
type FetchHost = { fetch?: (url: string, init: S3FetchInit) => Promise<S3FetchResponse> };

const defaultFetch: S3Fetch = (url, init) => {
  const candidate = (globalThis as FetchHost).fetch;
  if (!candidate) {
    return Promise.reject(new Error('global fetch is unavailable in this runtime'));
  }
  return candidate.call(globalThis, url, init);
};
