import { join } from 'node:path';
import { createFilesystemImageStore } from './filesystemImageStore';
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
 * The one rule that matters: `IMAGE_S3_BUCKET` is the switch. Everything else
 * about object storage is optional, so a deployment that has never heard of S3
 * takes the filesystem path it has always taken, and the existing
 * `IMAGE_STORAGE_DIR` variable keeps its meaning and its default.
 *
 * `src/storage/` rather than more files in `src/lib/`: `lib/` in this app is a
 * flat bag of single-purpose helpers (`response.ts`, `serviceResult.ts`,
 * `mailer.ts`, `rateLimiter.ts`) that routes import directly. This is a
 * subsystem — an interface, two drivers, a signing primitive, and a factory
 * that owns the env contract — and the S3 driver must not be importable
 * alongside `sendError` without reading three other files first. Its own
 * directory is what keeps that boundary legible.
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

export type ImageStoreConfig = FilesystemImageStoreConfig | S3ImageStoreConfig;

export const DEFAULT_IMAGE_STORAGE_DIR = join(process.cwd(), 'uploads', 'images');
export const DEFAULT_S3_REGION = 'us-east-1';

export function resolveImageStoreConfig(env: NodeJS.ProcessEnv = process.env): ImageStoreConfig {
  const bucket = trim(env.IMAGE_S3_BUCKET);
  if (!bucket) {
    return {
      kind: 'filesystem',
      directory: trim(env.IMAGE_STORAGE_DIR) || DEFAULT_IMAGE_STORAGE_DIR,
    };
  }

  assertBucketName(bucket);

  return {
    kind: 's3',
    bucket,
    region: trim(env.IMAGE_S3_REGION) || DEFAULT_S3_REGION,
    endpoint: resolveEndpoint(
      trim(env.IMAGE_S3_ENDPOINT),
      trim(env.IMAGE_S3_REGION) || DEFAULT_S3_REGION
    ),
    forcePathStyle: parseBoolean(env.IMAGE_S3_PATH_STYLE, true),
    credentials: resolveCredentials(env),
    requestTimeoutMs: resolveTimeoutMs(env),
  };
}

function trim(value: string | undefined): string {
  return (value ?? '').trim();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = trim(value).toLowerCase();
  if (normalized === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw notConfigured('IMAGE_S3_PATH_STYLE', 'must be one of true/false/1/0/yes/no/on/off');
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
 * derived from `IMAGE_S3_ENDPOINT` alone and the bucket is only ever appended
 * to it as a suffix or a path segment; `s3ImageStore.objectUrl` never reads the
 * bucket as a host. `s3ImageStore.test.ts` asserts that directly.
 */
function assertBucketName(bucket: string): void {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw notConfigured(
      'IMAGE_S3_BUCKET',
      'must be 3-63 characters of lowercase letters, digits, dots and hyphens'
    );
  }
}

function resolveEndpoint(endpoint: string, region: string): string {
  const raw = endpoint || `s3.${region}.amazonaws.com`;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw notConfigured('IMAGE_S3_ENDPOINT', 'is not a valid host or URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw notConfigured('IMAGE_S3_ENDPOINT', 'must use http or https');
  }
  // Credentials travel in a header, and this driver will only send them to the
  // host derived from this value. Refusing userinfo, path and query here keeps
  // that promise true for every endpoint spelling an operator might try.
  if (url.username || url.password) {
    throw notConfigured('IMAGE_S3_ENDPOINT', 'must not contain credentials');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw notConfigured('IMAGE_S3_ENDPOINT', 'must be a bare origin with no path or query');
  }
  return url.origin;
}

function resolveCredentials(env: NodeJS.ProcessEnv): S3Credentials {
  const accessKeyId = trim(env.IMAGE_S3_ACCESS_KEY_ID);
  const secretAccessKey = trim(env.IMAGE_S3_SECRET_ACCESS_KEY);
  const sessionToken = trim(env.IMAGE_S3_SESSION_TOKEN);

  // Report which variable is missing, never its value.
  if (!accessKeyId)
    throw notConfigured('IMAGE_S3_ACCESS_KEY_ID', 'is required when IMAGE_S3_BUCKET is set');
  if (!secretAccessKey) {
    throw notConfigured('IMAGE_S3_SECRET_ACCESS_KEY', 'is required when IMAGE_S3_BUCKET is set');
  }
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey };
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = trim(env.IMAGE_S3_TIMEOUT_MS);
  if (!raw) return DEFAULT_S3_REQUEST_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw notConfigured('IMAGE_S3_TIMEOUT_MS', 'must be a positive number of milliseconds');
  }
  return parsed;
}

function notConfigured(variable: string, problem: string): ImageStoreError {
  return new ImageStoreError({
    code: 'not_configured',
    storeKind: 's3',
    message: `Object storage is misconfigured: ${variable} ${problem}`,
  });
}

export interface ImageStoreDescription {
  kind: ImageStoreKind;
  bucket?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  directory?: string;
}

/**
 * A loggable view of the active configuration.
 *
 * This is the ONLY shape of the config that reaches a log line, and it has no
 * `credentials` field to reach. Credentials stay nested in
 * `S3ImageStoreConfig.credentials` precisely so that "log the config" cannot be
 * a one-line change into "log the secret key"; the type system is the control,
 * and `describeImageStoreConfig` is where it is exercised.
 */
export function describeImageStoreConfig(config: ImageStoreConfig): ImageStoreDescription {
  return config.kind === 'filesystem'
    ? { kind: 'filesystem', directory: config.directory }
    : {
        kind: 's3',
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      };
}

export interface ImageStoreDependencies {
  fetch?: S3Fetch;
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

  assertBucketName(config.bucket);
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
