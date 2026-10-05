import { join } from 'node:path';
import { createFilesystemImageStore } from './filesystemImageStore';
import {
  createFirebaseImageStore,
  DEFAULT_FIREBASE_ENDPOINT,
  DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS,
  FIREBASE_STORAGE_PREFIXES,
  normalizeFirebasePrivateKey,
  type FirebaseFetch,
  type FirebaseImageStoreOptions,
  type FirebaseServiceAccount,
  type FirebaseTokenSigner,
} from './firebaseImageStore';
import { ImageStoreError, type ImageStore, type ImageStoreKind } from './imageStore';
import {
  createS3ImageStore,
  DEFAULT_S3_REQUEST_TIMEOUT_MS,
  type S3CredentialProvider,
  type S3Credentials,
  type S3Fetch,
} from './s3ImageStore';
import { logger } from '../logger';

/**
 * Configuration resolution for the image store.
 *
 * The one rule that matters: exactly one of `IMAGE_S3_BUCKET` and
 * `IMAGE_FIREBASE_BUCKET` selects the object store, and having neither leaves
 * the filesystem path a deployment has always taken. So `IMAGE_STORAGE_DIR`
 * keeps its meaning and its default, and a deployment that has never heard of
 * object storage configures nothing.
 *
 * Both being set is REFUSED rather than resolved by a precedence rule. A
 * deployment migrating from S3 to Firebase sets the new bucket first and
 * removes the old one second; a silent precedence rule would spend that window
 * writing new images to the bucket the operator is trying to leave, and the
 * only symptom would be a `GET` that 404s an object a `PUT` reported success
 * for. Refusing names both variables and costs one restart.
 *
 * `src/storage/` rather than more files in `src/lib/`: `lib/` in this app is a
 * flat bag of single-purpose helpers (`response.ts`, `serviceResult.ts`,
 * `mailer.ts`, `rateLimiter.ts`) that routes import directly. This is a
 * subsystem — an interface, three drivers, two signing primitives, and a
 * factory that owns the env contract — and the Firebase driver must not be
 * importable alongside `sendError` without reading three other files first. Its
 * own directory is what keeps that boundary legible.
 */

/** Credentials live in a nested object so they cannot be flattened by accident. */
export interface FilesystemImageStoreConfig {
  kind: 'filesystem';
  directory: string;
}

export interface S3ImageStoreConfig {
  kind: 's3';
  bucket: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  credentials: S3Credentials;
  requestTimeoutMs: number;
}

export interface FirebaseImageStoreConfig {
  kind: 'firebase';
  bucket: string;
  endpoint: string;
  /** Object-name prefix the image key is appended to. Never empty. */
  prefix: string;
  /**
   * Nested for the same reason `S3ImageStoreConfig.credentials` is: the
   * `privateKey` inside it is the one string in this file that must never
   * reach a log, and a flat `privateKey` field would be one careless spread
   * away from doing so.
   */
  serviceAccount: FirebaseServiceAccount;
  requestTimeoutMs: number;
}

export type ImageStoreConfig =
  FilesystemImageStoreConfig | S3ImageStoreConfig | FirebaseImageStoreConfig;

export const DEFAULT_IMAGE_STORAGE_DIR = join(process.cwd(), 'uploads', 'images');
export const DEFAULT_S3_REGION = 'us-east-1';

export function resolveImageStoreConfig(env: NodeJS.ProcessEnv = process.env): ImageStoreConfig {
  const s3Bucket = trim(env.IMAGE_S3_BUCKET);
  const firebaseBucket = trim(env.IMAGE_FIREBASE_BUCKET);

  if (s3Bucket && firebaseBucket) {
    throw notConfigured(
      's3',
      'IMAGE_S3_BUCKET / IMAGE_FIREBASE_BUCKET',
      'are both set; clear one so exactly one object store is active'
    );
  }
  if (firebaseBucket) return resolveFirebaseConfig(env, firebaseBucket);
  if (s3Bucket) return resolveS3Config(env, s3Bucket);

  return {
    kind: 'filesystem',
    directory: trim(env.IMAGE_STORAGE_DIR) || DEFAULT_IMAGE_STORAGE_DIR,
  };
}

function resolveS3Config(env: NodeJS.ProcessEnv, bucket: string): S3ImageStoreConfig {
  assertBucketName(bucket, 'IMAGE_S3_BUCKET');
  return {
    kind: 's3',
    bucket,
    region: trim(env.IMAGE_S3_REGION) || DEFAULT_S3_REGION,
    endpoint: resolveEndpoint(
      trim(env.IMAGE_S3_ENDPOINT),
      'IMAGE_S3_ENDPOINT',
      `s3.${trim(env.IMAGE_S3_REGION) || DEFAULT_S3_REGION}.amazonaws.com`
    ),
    forcePathStyle: parseBoolean(env.IMAGE_S3_PATH_STYLE, 'IMAGE_S3_PATH_STYLE', true),
    credentials: resolveS3Credentials(env),
    requestTimeoutMs: resolveTimeoutMs(env, 'IMAGE_S3_TIMEOUT_MS', DEFAULT_S3_REQUEST_TIMEOUT_MS),
  };
}

function resolveFirebaseConfig(env: NodeJS.ProcessEnv, bucket: string): FirebaseImageStoreConfig {
  assertBucketName(bucket, 'IMAGE_FIREBASE_BUCKET');

  const clientEmail = trim(env.IMAGE_FIREBASE_CLIENT_EMAIL);
  if (!clientEmail) {
    throw notConfigured(
      'firebase',
      'IMAGE_FIREBASE_CLIENT_EMAIL',
      'is required when IMAGE_FIREBASE_BUCKET is set'
    );
  }
  const privateKey = normalizeFirebasePrivateKey(env.IMAGE_FIREBASE_PRIVATE_KEY ?? '');
  if (!privateKey) {
    throw notConfigured(
      'firebase',
      'IMAGE_FIREBASE_PRIVATE_KEY',
      'is required when IMAGE_FIREBASE_BUCKET is set'
    );
  }

  return {
    kind: 'firebase',
    bucket,
    endpoint: resolveBareOrigin(
      trim(env.IMAGE_FIREBASE_ENDPOINT) || DEFAULT_FIREBASE_ENDPOINT,
      'IMAGE_FIREBASE_ENDPOINT'
    ),
    prefix: resolveFirebasePrefix(env.IMAGE_FIREBASE_PREFIX),
    serviceAccount: { clientEmail, privateKey },
    requestTimeoutMs: resolveTimeoutMs(
      env,
      'IMAGE_FIREBASE_TIMEOUT_MS',
      DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS
    ),
  };
}

function trim(value: string | undefined): string {
  return (value ?? '').trim();
}

function parseBoolean(value: string | undefined, variable: string, fallback: boolean): boolean {
  const normalized = trim(value).toLowerCase();
  if (normalized === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw notConfigured('s3', variable, 'must be one of true/false/1/0/yes/no/on/off');
}

/**
 * Bucket names are DNS labels.
 *
 * The property this actually protects is that the bucket can only ever be a
 * path segment or a hostname *prefix* — never a path escape, never a query,
 * never userinfo. Rejecting everything outside `a-z0-9.-` closes all three: a
 * `/` would walk out of the bucket's prefix, a `?` or `#` would append to the
 * URL, and an `@` would turn the virtual-hosted hostname into userinfo.
 *
 * It deliberately does NOT reject a hostname-shaped name like
 * `a.b.example`. That cannot redirect a request, because the request host is
 * derived from the endpoint alone and the bucket is only ever appended
 * to it as a suffix or a path segment; neither `s3ImageStore.objectUrl` nor
 * `firebaseImageStore`'s URL builder ever reads the bucket as a host.
 * `s3ImageStore.test.ts` asserts that directly for S3.
 *
 * Firebase/GCS's own extra naming rules — no `goog`-prefixed name, no
 * `googleapis.com` suffix — are NOT enforced here. They are provider policy
 * rather than a safety property, Firebase answers a bad name with a 400 that
 * this driver already reports as `unexpected_response`, and reimplementing a
 * subset of Google's naming spec in this repo would be a rule that drifts.
 */
function assertBucketName(bucket: string, variable: string): void {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw notConfigured(
      currentKindFor(variable),
      variable,
      'must be 3-63 characters of lowercase letters, digits, dots and hyphens'
    );
  }
}

/**
 * Which driver a variable belongs to, read off its name.
 *
 * The rule is a prefix test and the prefix is fixed: every object-storage
 * variable this module reads is either `IMAGE_S3_*` or `IMAGE_FIREBASE_*`,
 * and `resolveS3Config`/`resolveFirebaseConfig` are the only two callers of
 * every helper that reports a configuration failure. Threading a `kind`
 * argument through five helpers instead would be five chances to pass the
 * wrong one, and getting it wrong is exactly the failure worth preventing: a
 * Firebase misconfiguration logged as `s3` sends an operator to the wrong half
 * of `.env.example` while they are holding the problem.
 */
function currentKindFor(variable: string): ImageStoreKind {
  return variable.startsWith('IMAGE_FIREBASE_') ? 'firebase' : 's3';
}

function resolveEndpoint(raw: string, variable: string, fallbackOrigin: string): string {
  return resolveBareOrigin(raw || fallbackOrigin, variable);
}

/**
 * Reduce an endpoint to a bare origin, refusing anything that could carry the
 * bearer token somewhere other than the host it names.
 *
 * Credentials travel in a header, and each driver will only send them to the
 * host derived from this value. Refusing userinfo, path and query here keeps
 * that promise true for every endpoint spelling an operator might try — and
 * the Firebase emulator, which is `http://127.0.0.1:9199`, is still accepted
 * because `http` is.
 */
function resolveBareOrigin(raw: string, variable: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw notConfigured(currentKindFor(variable), variable, 'is not a valid host or URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw notConfigured(currentKindFor(variable), variable, 'must use http or https');
  }
  if (url.username || url.password) {
    throw notConfigured(currentKindFor(variable), variable, 'must not contain credentials');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw notConfigured(
      currentKindFor(variable),
      variable,
      'must be a bare origin with no path or query'
    );
  }
  return url.origin;
}

/**
 * The object-name prefix every image key is written under.
 *
 * It is not a URL path — the driver percent-encodes the whole object name, so
 * no prefix can produce a path escape, and that is why this check is about
 * *namespace* safety rather than traversal: `images/../admin` would be
 * faithfully encoded and then faithfully written, putting images outside the
 * prefix an operator believed they had confined them to. So a `..` segment, an
 * empty segment and a leading or trailing `/` are all refused, and nothing
 * outside the unreserved set is allowed at all. Empty means "unset", which
 * falls back to the default rather than writing objects at the bucket root.
 */
function resolveFirebasePrefix(raw: string | undefined): string {
  const prefix = trim(raw);
  if (!prefix) return FIREBASE_STORAGE_PREFIXES.images;
  if (prefix.length > 255) {
    throw notConfigured('firebase', 'IMAGE_FIREBASE_PREFIX', 'must be at most 255 characters');
  }
  const wellFormed = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/.test(prefix);
  if (!wellFormed || prefix.includes('..') || prefix.includes('//')) {
    throw notConfigured(
      'firebase',
      'IMAGE_FIREBASE_PREFIX',
      'must be a relative object path such as "images" or "tenants/acme", with no ".." segment, no empty segment, and no leading or trailing slash'
    );
  }
  return prefix;
}

function resolveS3Credentials(env: NodeJS.ProcessEnv): S3Credentials {
  const accessKeyId = trim(env.IMAGE_S3_ACCESS_KEY_ID);
  const secretAccessKey = trim(env.IMAGE_S3_SECRET_ACCESS_KEY);
  const sessionToken = trim(env.IMAGE_S3_SESSION_TOKEN);

  // Report which variable is missing, never its value.
  if (!accessKeyId)
    throw notConfigured('s3', 'IMAGE_S3_ACCESS_KEY_ID', 'is required when IMAGE_S3_BUCKET is set');
  if (!secretAccessKey) {
    throw notConfigured(
      's3',
      'IMAGE_S3_SECRET_ACCESS_KEY',
      'is required when IMAGE_S3_BUCKET is set'
    );
  }
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey };
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv, variable: string, fallback: number): number {
  const raw = trim(env[variable]);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw notConfigured(
      currentKindFor(variable),
      variable,
      'must be a positive number of milliseconds'
    );
  }
  return parsed;
}

/**
 * A configuration failure, carrying the variable it is about and never the
 * value it holds. The `kind` is explicit rather than inferred so that a
 * Firebase message cannot be tagged `s3`, which would send an operator to the
 * wrong half of `.env.example`.
 */
function notConfigured(kind: ImageStoreKind, variable: string, problem: string): ImageStoreError {
  return new ImageStoreError({
    code: 'not_configured',
    storeKind: kind,
    message: `Object storage is misconfigured: ${variable} ${problem}`,
  });
}

/**
 * The loggable view of the active configuration.
 *
 * This is a DISCRIMINATED UNION, and that is the control rather than a
 * stylistic choice. Credentials stay nested in `S3ImageStoreConfig.credentials`
 * and `FirebaseImageStoreConfig.serviceAccount` precisely so that "log the
 * config" cannot be a one-line change into "log the secret key"; and because
 * each arm of this union lists every field it may contain, adding a
 * `privateKey` to the Firebase arm is an excess-property compile error rather
 * than a leak that reaches production and is caught by review.
 *
 * `clientEmail` IS included, deliberately. It is an identifier, not a secret —
 * it is printed on the service account's page in IAM and appears in every
 * Storage audit log — and it is the one field that answers the question a
 * storage outage always raises, which is *whose* credentials are we using. The
 * private key, which is the actual secret, has no field here at all.
 */
export type ImageStoreDescription =
  | { kind: 'filesystem'; directory: string }
  | {
      kind: 's3';
      bucket: string;
      region: string;
      endpoint: string;
      forcePathStyle: boolean;
    }
  | {
      kind: 'firebase';
      bucket: string;
      endpoint: string;
      prefix: string;
      clientEmail: string;
    };

export function describeImageStoreConfig(config: ImageStoreConfig): ImageStoreDescription {
  switch (config.kind) {
    case 'filesystem':
      return { kind: 'filesystem', directory: config.directory };
    case 's3':
      return {
        kind: 's3',
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      };
    case 'firebase':
      return {
        kind: 'firebase',
        bucket: config.bucket,
        endpoint: config.endpoint,
        prefix: config.prefix,
        clientEmail: config.serviceAccount.clientEmail,
      };
  }
}

/**
 * Test seams for the remote drivers. Each is optional and each is ignored by
 * the driver it does not belong to, so `createImageStore` never has to narrow
 * one transport type into another at runtime — which is also why the two
 * fetches are separately named rather than one `fetch` of a union type that
 * nothing could discriminate.
 */
export interface ImageStoreDependencies {
  /** S3 driver only. */
  fetch?: S3Fetch;
  /** Firebase driver only. */
  firebaseFetch?: FirebaseFetch;
  /**
   * Firebase driver only. Omit to mint tokens with `google-auth-library`; a
   * test passes a stub so nothing reaches `oauth2.googleapis.com`.
   */
  firebaseSigner?: FirebaseTokenSigner;
  /** Shared clock, for both remote drivers. */
  now?: () => Date;
}

/**
 * Build a store from a resolved config. Construction performs no I/O and no
 * network: a store object is a closure over its configuration, so this is cheap
 * enough to call per request, and an operator who fixes a bad environment
 * variable does not have to restart the process to pick it up.
 *
 * Misconfiguration throws here rather than at import time. The image route is
 * one of a dozen routes on the app, and a wrong bucket variable should cost
 * `GET /api/images/:id` a 500 and a precise log line — not take `GET /health`
 * and every unrelated route down with it at boot.
 */
export function createImageStore(
  config: ImageStoreConfig,
  dependencies: ImageStoreDependencies = {}
): ImageStore {
  if (config.kind === 'filesystem') {
    return createFilesystemImageStore(config.directory);
  }

  if (config.kind === 'firebase') {
    assertBucketName(config.bucket, 'IMAGE_FIREBASE_BUCKET');
    const options: FirebaseImageStoreOptions = {
      bucket: config.bucket,
      endpoint: config.endpoint,
      prefix: config.prefix,
      serviceAccount: config.serviceAccount,
      requestTimeoutMs: config.requestTimeoutMs,
      ...(dependencies.firebaseFetch ? { fetch: dependencies.firebaseFetch } : {}),
      ...(dependencies.firebaseSigner ? { signer: dependencies.firebaseSigner } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
    };
    return createFirebaseImageStore(options);
  }

  assertBucketName(config.bucket, 'IMAGE_S3_BUCKET');
  const credentials: S3CredentialProvider = () => config.credentials;
  return createS3ImageStore({
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials,
    requestTimeoutMs: config.requestTimeoutMs,
    ...dependencies,
  });
}

let lastLoggedDescription: string | null = null;

/**
 * The store the image route uses. Logs the active driver once per
 * configuration change, so the answer to "is this deployment on the bucket or
 * on local disk?" is one grep, and a configuration change is visible in the
 * log rather than only in the environment.
 */
export function getImageStore(): ImageStore {
  const config = resolveImageStoreConfig();
  const description = describeImageStoreConfig(config);
  const signature = JSON.stringify(description);
  if (signature !== lastLoggedDescription) {
    lastLoggedDescription = signature;
    logger.info({ event: 'image_store_configured', ...description });
  }
  try {
    return createImageStore(config);
  } catch (error) {
    // Construction failure is configuration, not traffic: a warn, not an error,
    // and every request that touches an image will still fail loudly on its own.
    logger.warn(
      { event: 'image_store_unavailable', ...description, reason: describeError(error) },
      'Image storage is not usable; image routes will fail until it is fixed'
    );
    throw error;
  }
}

/** Test seam: forget the "already logged this configuration" memo. */
export function resetImageStoreLogStateForTests(): void {
  lastLoggedDescription = null;
}

export { createFilesystemImageStore } from './filesystemImageStore';
export {
  assertImageKey,
  ImageStoreError,
  InvalidImageKeyError,
  isImageKey,
  type ImageStore,
  type ImageStoreErrorCode,
} from './imageStore';
export { createS3ImageStore, redact, DEFAULT_S3_REQUEST_TIMEOUT_MS } from './s3ImageStore';
export {
  createFirebaseImageStore,
  createFirebaseSigner,
  normalizeFirebasePrivateKey,
  redactFirebaseSecrets,
  DEFAULT_FIREBASE_ENDPOINT,
  DEFAULT_FIREBASE_REQUEST_TIMEOUT_MS,
  FIREBASE_STORAGE_PREFIXES,
  FIREBASE_STORAGE_SCOPE,
  type FirebaseAccessToken,
  type FirebaseFetch,
  type FirebaseFetchInit,
  type FirebaseFetchResponse,
  type FirebaseImageStoreOptions,
  type FirebaseServiceAccount,
  type FirebaseSignerOptions,
  type FirebaseTokenSigner,
} from './firebaseImageStore';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
