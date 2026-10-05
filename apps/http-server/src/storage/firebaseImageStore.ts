import { createPrivateKey } from 'node:crypto';
import { JWT } from 'google-auth-library';
import { ImageStoreError, assertImageKey, type ImageStore } from './imageStore';
import { uriEncode } from './sigv4';

/**
 * The third driver: Firebase Storage's REST API, called directly.
 *
 * WHY NOT `firebase-admin`. It is not installed and adding it would drag ~40
 * transitive packages, a bundled `grpc` binary and a Firestore client this
 * service has no use for, in order to perform two HTTP verbs. Firebase
 * Storage *is* an HTTP API with published request and error shapes, so the S3
 * driver's approach applies unchanged: build the URL, put a bearer token in a
 * header, read the status. `sigv4.ts` is the precedent — this repository signs
 * its own requests rather than trusting a client object graph, and that is
 * still cheaper here than the alternative.
 *
 * WHY THE TOKEN IS NOT HAND-ROLLED. SigV4 had to be hand-rolled because
 * nothing in the tree could sign an AWS request. The Google assertion JWT
 * already has a signer in the tree: `google-auth-library@10.9.1` is a *direct*
 * dependency of this app (`package.json` `dependencies`, not a transitive one)
 * and `src/routes/auth.ts` already imports it for Google OAuth. Minting a
 * service-account assertion with it adds zero dependencies and zero bundle
 * weight, and it gets the RS256 key handling, the claim construction, the
 * `aud`/`scope` rules and the token cache right for free — four things where a
 * local reimplementation would be a liability rather than a saving. The signer
 * still sits behind an injectable seam (`FirebaseTokenSigner`), so the tests
 * stub it and never reach `oauth2.googleapis.com`.
 *
 * NAMING. Upstream Excalidraw's Firebase module
 * (`excalidraw-app/data/firebase.ts`) calls its two operations
 * `saveFilesToFirebase` / `loadFilesFromFirebase` and names its namespace
 * prefixes `FIREBASE_STORAGE_PREFIXES`. Both names are kept: the operations
 * here are `saveFileToFirebase` / `loadFileFromFirebase`, singular because this
 * seam moves exactly one object per call and a plural name would promise a
 * batch that does not exist, and the prefix constant keeps Excalidraw's name.
 */

export interface FirebaseServiceAccount {
  /** The `client_email` from the service account JSON. An identifier, not a secret. */
  clientEmail: string;
  /** The `private_key` from the service account JSON: a PEM, newlines intact. */
  privateKey: string;
}

export interface FirebaseAccessToken {
  token: string;
  /** Epoch milliseconds after which the token stops being accepted. */
  expiresAt: number;
}

/**
 * Resolved per request rather than captured once, so a service account whose
 * key is rotated underneath a long-running process is picked up without a
 * restart — the same reason `S3CredentialProvider` is a function.
 */
export type FirebaseTokenSigner = () => Promise<FirebaseAccessToken>;

export interface FirebaseFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
}

export interface FirebaseFetchResponse {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  /**
   * Present so a large error body can be skipped before it is read into
   * memory; optional because a test double only needs the status and the
   * bytes. See `readErrorBody`.
   */
  readonly headers?: { get(name: string): string | null } | null;
}

/**
 * The HTTP seam. Same argument as `S3Fetch`: the driver builds a request and
 * hands it to a function it was given, so a test asserts on the exact bytes
 * this code produced with nothing mocked except the socket.
 */
export type FirebaseFetch = (
  url: string,
  init: FirebaseFetchInit
) => Promise<FirebaseFetchResponse>;

export interface FirebaseImageStoreOptions {
  bucket: string;
  /** Absolute origin, e.g. `https://firebasestorage.googleapis.com`. */
  endpoint: string;
  /** Object-name prefix, e.g. `images`. The key is appended to it. */
  prefix: string;
  serviceAccount: FirebaseServiceAccount;
  fetch?: FirebaseFetch;
  /**
   * Omit to mint access tokens with `google-auth-library`. A test passes a
   * stub; so does a caller holding credentials in some other shape.
   */
  signer?: FirebaseTokenSigner;
  now?: () => Date;
  /** Upper bound on one request. See `S3ImageStoreOptions.requestTimeoutMs`. */
  requestTimeoutMs?: number;
}

export const DEFAULT_FIREBASE_ENDPOINT = 'https://firebasestorage.googleapis.com';
export const DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Excalidraw's constant, kept under Excalidraw's name.
 *
 * Upstream declares four namespaces (`files`, `scenes`, `snapshots`, and the
 * collaboration store) because it stores a whole Firebase document per
 * logical thing. This service stores exactly one kind of thing, so declaring
 * the other three would be a list of features that do not exist — the constant
 * is the one place a reader looks to see what this driver can reach, and dead
 * entries there are a lie. `images` is the only prefix, and it is the default
 * for `IMAGE_FIREBASE_PREFIX`.
 */
export const FIREBASE_STORAGE_PREFIXES = {
  images: 'images',
} as const;

/**
 * The scope Firebase Storage needs. `read_write` because this driver both
 * uploads and downloads; a read-only scope would make every `put` fail with a
 * 403 that looks like a permissions problem rather than a scope problem.
 */
export const FIREBASE_STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/**
 * Mint an access token before this one would expire, so a request is never
 * signed with a token that dies in flight. Google's access tokens live an hour;
 * five minutes of headroom costs nothing and removes the 401 class entirely.
 */
const TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

/** Google's one-hour access-token lifetime, used when the signer cannot say. */
const GOOGLE_ACCESS_TOKEN_LIFETIME_MS = 3_600_000;

/**
 * An error body is remote text on its way into a log line. Read at most this
 * much of it: the diagnostics that matter (a status string and a reason) are in
 * the first few hundred bytes, and a truncated string cannot flood a log.
 */
const MAX_ERROR_BODY_BYTES = 4_096;

export function createFirebaseImageStore(options: FirebaseImageStoreOptions): ImageStore {
  const apiRoot = new URL(options.endpoint);
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS;
  const sign = options.signer ?? createFirebaseSigner({ serviceAccount: options.serviceAccount });

  const objectName = (key: string): string => `${options.prefix}/${key}`;

  const uploadUrl = (name: string): string =>
    `${apiRoot.origin}/v0/b/${uriEncode(options.bucket)}/o` +
    `?uploadType=media&name=${uriEncode(name)}`;

  const downloadUrl = (name: string): string =>
    `${apiRoot.origin}/v0/b/${uriEncode(options.bucket)}/o/${uriEncode(name)}?alt=media`;

  /**
   * Cached for the life of this store object. `createImageStore` is called per
   * request, so this cache only helps a long-lived store — but it is what makes
   * the cost of a `get` one cheap clock read rather than a token mint.
   */
  let cachedToken: { header: string; validUntil: number } | null = null;

  const authorizationHeader = async (): Promise<string> => {
    const at = now().getTime();
    if (cachedToken !== null && cachedToken.validUntil - TOKEN_REFRESH_SKEW_MS > at) {
      return cachedToken.header;
    }
    const minted = await mintAccessToken(sign, at);
    cachedToken = { header: `Bearer ${minted.token}`, validUntil: minted.expiresAt };
    return cachedToken.header;
  };

  const send = async (
    method: 'GET' | 'POST',
    url: string,
    body: Buffer | undefined,
    contentType: string | undefined
  ): Promise<FirebaseFetchResponse> => {
    let authorization: string;
    try {
      authorization = await authorizationHeader();
    } catch (error) {
      // The signer already typed anything it could identify; this is the
      // catch-all so a token failure is still an `ImageStoreError` rather than
      // a raw crypto throw the route cannot classify.
      if (error instanceof ImageStoreError) throw error;
      throw new ImageStoreError({
        code: 'unreachable',
        storeKind: 'firebase',
        retryable: true,
        message:
          `Firebase Storage could not issue an access token for ${method}: ` +
          redactFirebaseSecrets(describeError(error), [options.serviceAccount.privateKey]),
      });
    }

    const headers: Record<string, string> = { authorization };
    if (contentType !== undefined) headers['content-type'] = contentType;

    const init: FirebaseFetchInit = { method, headers };
    if (body) init.body = body;
    init.signal = AbortSignal.timeout(timeoutMs);

    try {
      return await (options.fetch ?? defaultFetch)(url, init);
    } catch (error) {
      throw new ImageStoreError({
        code: 'unreachable',
        storeKind: 'firebase',
        retryable: true,
        message:
          `Firebase Storage at ${apiRoot.host} did not answer ${method}: ` +
          redactFirebaseSecrets(describeError(error), [
            options.serviceAccount.privateKey,
            authorization,
          ]),
      });
    }
  };

  return {
    kind: 'firebase',

    /**
     * Excalidraw's `saveFilesToFirebase`, narrowed to one object.
     *
     * `uploadType=media` is the single-request upload, which is the only one
     * this seam needs: the route has already buffered the whole body to check
     * its magic bytes, so a resumable session would add a second round trip to
     * a code path that already holds every byte in memory.
     */
    async put(key: string, body: Buffer, contentType: string): Promise<void> {
      assertImageKey(key);
      const name = objectName(key);
      const response = await send('POST', uploadUrl(name), body, contentType);
      if (response.status < 200 || response.status >= 300) {
        throw await failure('put', key, response, options.serviceAccount);
      }
      // Not read on success either: the reply is object metadata this driver
      // has no use for, and draining keeps the socket from stalling teardown.
      await response.arrayBuffer().catch(() => undefined);
    },

    /**
     * Excalidraw's `loadFilesFromFirebase`, narrowed to one object.
     *
     * `alt=media` returns the bytes instead of the metadata document, so this
     * is the download and not a metadata probe — one round trip, not two.
     */
    async get(key: string): Promise<Buffer | null> {
      assertImageKey(key);
      const name = objectName(key);
      const response = await send('GET', downloadUrl(name), undefined, undefined);
      // 404 is the one non-success status that is a normal answer. A 403 is
      // not treated as absence, for the same reason as the S3 driver: "we may
      // not read this" and "this does not exist" are different facts, and
      // collapsing them makes a revoked service account look like a deleted
      // image — every image in the deployment reporting itself missing.
      if (response.status === 404) return null;
      if (response.status < 200 || response.status >= 300) {
        throw await failure('get', key, response, options.serviceAccount);
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/**
 * One access token, or a typed refusal.
 *
 * The signer is trusted for the token's *value* and its *shape*, never for its
 * expiry: a stub that returns `NaN`, a negative number, or a timestamp already
 * in the past would otherwise poison the cache and the store would either
 * re-mint on every request or keep using a dead token until Firebase 401'd it.
 * An untrustworthy expiry is replaced with Google's one-hour lifetime, which
 * errs towards re-minting — cheap — rather than towards a 401.
 */
async function mintAccessToken(
  sign: FirebaseTokenSigner,
  nowMs: number
): Promise<FirebaseAccessToken> {
  const minted = await sign();
  if (typeof minted.token !== 'string' || minted.token.length === 0) {
    throw new ImageStoreError({
      code: 'not_configured',
      storeKind: 'firebase',
      message: 'Object storage is misconfigured: the Firebase token signer returned no token',
    });
  }
  const usableExpiry =
    Number.isFinite(minted.expiresAt) && minted.expiresAt > nowMs ? minted.expiresAt : null;
  return {
    token: minted.token,
    expiresAt: usableExpiry ?? nowMs + GOOGLE_ACCESS_TOKEN_LIFETIME_MS,
  };
}

/**
 * Firebase answers a failed request with a Google JSON error document. Both
 * fields are read because the two are not the same signal: `status` is the
 * canonical code (`PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`)
 * and `reason` is the legacy `global`-domain string, and older Firebase
 * Storage deployments emit only the latter.
 */
function parseGoogleError(body: string): { status?: string; reason?: string; message?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const outer = (parsed as Record<string, unknown>).error;
  if (typeof outer !== 'object' || outer === null) return {};
  const record = outer as Record<string, unknown>;

  const status = typeof record.status === 'string' ? record.status : undefined;
  const message = typeof record.message === 'string' ? record.message : undefined;

  const details = record.errors;
  const first = Array.isArray(details) ? details[0] : undefined;
  const reason =
    typeof first === 'object' &&
    first !== null &&
    typeof (first as Record<string, unknown>).reason === 'string'
      ? ((first as Record<string, unknown>).reason as string)
      : undefined;

  return { status, reason, message };
}

async function readErrorBody(response: FirebaseFetchResponse): Promise<string> {
  // Trust the declared length only to decide whether reading is worth it; the
  // slice below is what actually bounds what reaches a log, because a lying or
  // absent `content-length` cannot make this read past the cap.
  const declared = response.headers?.get('content-length') ?? null;
  if (declared !== null && Number(declared) > MAX_ERROR_BODY_BYTES) return '';
  try {
    const raw = Buffer.from(await response.arrayBuffer());
    return raw.subarray(0, MAX_ERROR_BODY_BYTES).toString('utf8');
  } catch {
    // A body that cannot be read must not replace the real diagnosis with a
    // second error. The status alone is still a complete answer.
    return '';
  }
}

/**
 * Map one Firebase HTTP status onto the driver's error codes.
 *
 * WHAT IS HONESTLY DISTINGUISHABLE, because Firebase separates them:
 *  - 401 `UNAUTHENTICATED`: the token was rejected (wrong account, revoked
 *    key, clock skew). `forbidden`, and repeating the identical request will
 *    fail identically.
 *  - 403 `PERMISSION_DENIED`: the identity is fine and the grant is not — a
 *    missing IAM role or a Firebase Storage rule. `forbidden`.
 *  - 400 `INVALID_ARGUMENT`, 409, 412: the request or the bucket is wrong.
 *    `unexpected_response`, not retryable.
 *  - 408, 429 `RESOURCE_EXHAUSTED`, 5xx `INTERNAL`/`UNAVAILABLE`: the same
 *    request can plausibly succeed on a retry, so `retryable` is set. These are
 *    `unexpected_response` rather than `unreachable` because the backend DID
 *    answer; `unreachable` is reserved for a request that never got one.
 *  - 404 on a GET is absence, handled by `get()` before this is reached.
 *
 * WHAT IS NOT, and is therefore not claimed here:
 *  - 404 on an upload. Firebase returns the same 404/`NOT_FOUND` for "this
 *    object does not exist" and "this bucket does not exist", with nothing in
 *    the body to tell them apart. It is mapped to `unexpected_response` and not
 *    to `not_configured` because the driver cannot prove which it is, and a
 *    wrong `not_configured` would send an operator to fix configuration that is
 *    fine.
 *  - `Retry-After` on a 429/503 is read from nothing here, because
 *    `ImageStoreError` has no field to carry it. A caller that needs
 *    backoff-aware retries needs that field first.
 *  - Firebase's own retry metadata and the difference between a Firebase
 *    Security Rule refusal and an IAM refusal are not separated; both arrive as
 *    a 403 and are reported as one `forbidden`.
 */
async function failure(
  operation: 'put' | 'get',
  key: string,
  response: FirebaseFetchResponse,
  serviceAccount: FirebaseServiceAccount
): Promise<ImageStoreError> {
  const status = response.status;
  const body = await readErrorBody(response);
  const google = parseGoogleError(body);

  const forbidden = status === 401 || status === 403;
  const retryable = status === 408 || status === 429 || status >= 500;

  const detail = [google.status, google.reason, google.message].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  );

  let explanation: string;
  if (status === 401) {
    explanation =
      ' (the access token was rejected: wrong service account, revoked key, or clock skew)';
  } else if (status === 403) {
    explanation = ' (the service account lacks permission on this bucket or object)';
  } else if (status === 400) {
    explanation = ' (the request was rejected as invalid; check the bucket name and prefix)';
  } else if (status === 404) {
    explanation =
      operation === 'put'
        ? ' (Firebase does not distinguish a missing bucket from a rejected upload path, so this is reported as an unexpected response rather than as configuration)'
        : '';
  } else if (retryable) {
    explanation = ' (Firebase reported a transient failure; the same request may succeed)';
  } else {
    explanation = '';
  }

  const reported = detail.length > 0 ? ` — ${detail.join(' / ')}` : '';

  return new ImageStoreError({
    code: forbidden ? 'forbidden' : 'unexpected_response',
    storeKind: 'firebase',
    retryable,
    status,
    message: redactFirebaseSecrets(
      `Firebase Storage rejected ${operation} ${key} with status ${status}${explanation}${reported}`,
      [serviceAccount.privateKey, body]
    ),
  });
}

/**
 * Redact credential material out of any string this module is about to put in
 * an error message or a log line.
 *
 * Two things are scrubbed. The private key is scrubbed because a PEM parse
 * failure from `node:crypto` echoes the input, and that input is the key.
 * `body` is scrubbed because the error document is remote text this code does
 * not control, and a reflected token has no business in a log. The bearer token
 * itself is passed in explicitly by the transport-error path, which is the one
 * place it could appear.
 *
 * Redaction is by exact substring, so the surrounding message stays legible.
 */
export function redactFirebaseSecrets(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  return out;
}

export interface FirebaseSignerOptions {
  serviceAccount: FirebaseServiceAccount;
  /**
   * Subject for domain-wide delegation. Firebase Storage does not need one —
   * a service account with the Storage roles mints its own token — so this
   * exists only for a deployment that delegates through Workspace.
   */
  subject?: string;
  scope?: string;
  /** Injected clock, for tests. */
  now?: () => number;
}

/**
 * Turn a service account into a token mint, using the `google-auth-library`
 * already in this app's dependency list.
 *
 * The private key is checked for parseability HERE, at construction, so a
 * mangled key is a `not_configured` error the way a malformed S3 endpoint is —
 * not an opaque `ERR_OSSL_PEM_NO_START_LINE` thrown from inside an upload.
 * Everything else is left to the library.
 */
export function createFirebaseSigner(options: FirebaseSignerOptions): FirebaseTokenSigner {
  const privateKey = normalizeFirebasePrivateKey(options.serviceAccount.privateKey);
  try {
    createPrivateKey(privateKey);
  } catch (error) {
    throw new ImageStoreError({
      code: 'not_configured',
      storeKind: 'firebase',
      message:
        'Object storage is misconfigured: IMAGE_FIREBASE_PRIVATE_KEY is not a PEM-encoded ' +
        `RSA private key (${describeError(error)})`,
    });
  }

  const client = new JWT({
    email: options.serviceAccount.clientEmail,
    key: privateKey,
    scopes: options.scope ?? FIREBASE_STORAGE_SCOPE,
    ...(options.subject ? { subject: options.subject } : {}),
  });
  const clock = options.now ?? (() => Date.now());

  return async (): Promise<FirebaseAccessToken> => {
    let token: string | null | undefined;
    try {
      ({ token } = await client.getAccessToken());
    } catch (error) {
      throw tokenFailure(error, options.serviceAccount);
    }
    if (typeof token !== 'string' || token.length === 0) {
      throw new ImageStoreError({
        code: 'not_configured',
        storeKind: 'firebase',
        message:
          'Object storage is misconfigured: the Firebase token endpoint returned no access token',
      });
    }
    // `client.credentials.expiry_date` is what google-auth-library itself
    // computes from the token response, read back through the typed field
    // rather than through the untyped response body.
    const expiry = client.credentials?.expiry_date;
    return {
      token,
      expiresAt: typeof expiry === 'number' ? expiry : clock() + GOOGLE_ACCESS_TOKEN_LIFETIME_MS,
    };
  };
}

/**
 * A token mint that failed is one of two genuinely different things, and
 * `ImageStoreErrorCode` has a code for each:
 *  - the token endpoint refused us (401/403: the key is not a service account,
 *    the account is disabled, the API is not enabled on the project) — the
 *    credentials are the problem, and retrying changes nothing;
 *  - the token endpoint was unreachable (DNS, TLS, timeout) — the same request
 *    may well work in a minute.
 */
function tokenFailure(error: unknown, serviceAccount: FirebaseServiceAccount): ImageStoreError {
  // `google-auth-library` wraps its HTTP failures, so the status is either on
  // the error itself or one level down under `response`. Both spellings are
  // accepted because only the library knows which it used for a given version.
  const response = readRecord(readRecord(error)?.response);
  const status = readNumber(response, 'status') ?? readNumber(readRecord(error), 'code');
  const forbidden = status === 401 || status === 403;

  return new ImageStoreError({
    code: forbidden ? 'forbidden' : 'unreachable',
    storeKind: 'firebase',
    retryable: !forbidden,
    status: status ?? null,
    message: redactFirebaseSecrets(
      `Firebase Storage could not mint an access token for ${serviceAccount.clientEmail}: ` +
        describeError(error),
      [serviceAccount.privateKey]
    ),
  });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}

/**
 * Undo the escaping that service-account JSON imposes on the private key.
 *
 * The `private_key` field of a downloaded service-account JSON contains the
 * PEM's newlines as the two characters `\` `n`, because JSON cannot hold a
 * literal newline inside that string without escaping it. Every deployment
 * path for this variable — `gcloud ... > sa.json` into a secret store, a
 * Kubernetes secret, a GitHub Actions secret — ends up handing those two
 * characters to the process, and `createPrivateKey` rejects the result. So the
 * escapes are turned back into newlines, and a key that already has real
 * newlines (a YAML block scalar, a `cat` into a file) is left exactly as it
 * is.
 *
 * Exported because this is the single most likely place for this driver to be
 * wrong in a way that only a real deployment finds, and it is the reason
 * `createFirebaseSigner` rejects the key at construction rather than at first
 * request.
 */
export function normalizeFirebasePrivateKey(value: string): string {
  const normalized = value.includes('\\n') ? value.split('\\n').join('\n') : value;
  return normalized.trim();
}

/**
 * Declared without the ambient DOM lib's `fetch` type so this module's
 * compilation does not depend on which `lib` the consuming tsconfig happens to
 * select. The runtime object is the platform's `fetch`, and it is structurally
 * compatible.
 */
type FetchHost = {
  fetch?: (url: string, init: FirebaseFetchInit) => Promise<FirebaseFetchResponse>;
};

const defaultFetch: FirebaseFetch = (url, init) => {
  const candidate = (globalThis as FetchHost).fetch;
  if (!candidate) {
    return Promise.reject(new Error('global fetch is unavailable in this runtime'));
  }
  return candidate.call(globalThis, url, init);
};
