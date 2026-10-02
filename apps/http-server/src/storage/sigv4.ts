/**
 * AWS Signature Version 4, header-based ("SigV4") request signing.
 *
 * WHY THIS IS HAND-ROLLED RATHER THAN `@aws-sdk/signature-v4` +
 * `@aws-sdk/client-s3`. Three operations are needed — PUT object, GET object,
 * and a canonical-request implementation to test against — and SigV4 is a
 * published, fixed algorithm that `node:crypto` can express in about a hundred
 * lines with no dependency. The SDK alternative is a client object graph (a
 * command stack, middleware resolvers, credential providers, and ~30
 * transitive packages) that would be bundled into `dist/index.js` and locked
 * into `pnpm-lock.yaml` to reach a conclusion the repository can draw for
 * itself. This repo has already hand-rolled its rate limiter and its encryption
 * for the same reason, and `packages/utils/src/encryption` is the precedent for
 * trusting a small, fully-tested crypto primitive over a large untested one.
 *
 * The cost of hand-rolling is that "trust it" has to be *demonstrated* rather
 * than assumed, so `src/__tests__/storage/sigv4.test.ts` pins this module
 * against vectors from AWS's published `aws-sig-v4-test-suite`
 * (`get-vanilla`, `post-vanilla`, `get-vanilla-query-order-key-case`,
 * `get-unreserved`) plus the payload hash of a real request body. Those are the
 * same vectors every other SigV4 implementation is tested against, so a
 * divergence is a known quantity, not an intuition.
 *
 * WHAT IS DELIBERATELY NOT HERE. No presigned URLs. Query-string signing puts
 * `X-Amz-Signature` — and, with it, the effective capability to read the
 * object — into a URL, which then lives in browser history, proxy logs,
 * `Referer` headers, and any analytics script on the page. That is the
 * classic way credentials end up somewhere they should not be, and this module
 * never produces one. Presigning, if it is ever wanted, belongs to a different
 * design with an explicit expiry and an explicit revocation story.
 */

import { createHash, createHmac } from 'node:crypto';

export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';

/** SHA-256 of the empty string; the payload hash of a body-less request. */
export const SHA256_OF_EMPTY_PAYLOAD =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4Request {
  method: string;
  /**
   * The exact `Host` header value that will go on the wire, including the port
   * when it is not the scheme default. It is signed, but it is deliberately
   * absent from the returned `headers`: an HTTP client derives `Host` from the
   * URL and will not let a hand-set value be trusted, so signing a value the
   * client may replace would produce a signature the server rejects.
   */
  host: string;
  /** Object key. Each `/`-separated segment is encoded; `/` itself is not. */
  path: string;
  /** Raw, unencoded query parameters. The image store sends none. */
  query?: Readonly<Record<string, string>>;
  /** Headers to sign and send, excluding `host`. */
  headers?: Readonly<Record<string, string>>;
  /** Lowercase hex SHA-256 of the request body. */
  payloadHash: string;
}

export interface SigV4Input extends SigV4Request {
  credentials: SigV4Credentials;
  region: string;
  /** SigV4's "service" scope component: `s3` for every S3-compatible endpoint. */
  service: string;
  date: Date;
}

export interface SigV4Result {
  /** `x-amz-date` value, e.g. `20130524T000000Z`. */
  amzDate: string;
  /** The exact bytes that were hashed. Asserted against in tests. */
  canonicalRequest: string;
  stringToSign: string;
  credentialScope: string;
  signedHeaders: string;
  signature: string;
  authorization: string;
  /** Headers to put on the wire, including `authorization`. */
  headers: Record<string, string>;
}

export function sha256Hex(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * RFC 3986 percent-encoding: everything except `A-Z a-z 0-9 - . _ ~`.
 *
 * `encodeURIComponent` leaves `! ' ( ) *` unescaped and SigV4 wants them
 * escaped, so those five are patched up explicitly. Everything else it escapes
 * is already RFC 3986 compliant, including multi-byte UTF-8, which the
 * per-character alternative would get wrong for astral-plane code points.
 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  );
}

/** `2013-05-24T00:00:00.000Z` -> `20130524T000000Z`. */
export function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodePath(path: string): string {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return absolute.split('/').map(uriEncode).join('/');
}

function encodeQuery(query: Readonly<Record<string, string>> | undefined): string {
  if (!query) return '';
  return (
    Object.entries(query)
      .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
      // Sorted by name, then by value, both on the *encoded* form.
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
      .map(([name, value]) => `${name}=${value}`)
      .join('&')
  );
}

/**
 * Lowercase every name, trim every value, sort by name, and terminate each line
 * with a newline. Returns the header block and the `;`-joined name list that
 * both the canonical request and the `Authorization` header need.
 */
function canonicalizeHeaders(headers: Readonly<Record<string, string>>): {
  block: string;
  signed: string;
} {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase().trim(), value.trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    block: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

export function signRequest(input: SigV4Input): SigV4Result {
  const amzDate = formatAmzDate(input.date);
  const dateStamp = amzDate.slice(0, 8);

  const allHeaders: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    const lower = name.toLowerCase();
    // `input.host` wins so a caller cannot sign a Host the client will not send.
    allHeaders[lower] = lower === 'host' ? input.host : value;
  }
  allHeaders['x-amz-date'] = amzDate;

  const { block, signed } = canonicalizeHeaders(allHeaders);
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  const canonicalRequest = [
    input.method.toUpperCase(),
    encodePath(input.path),
    encodeQuery(input.query),
    block,
    signed,
    input.payloadHash,
  ].join('\n');

  const stringToSign = [
    SIGV4_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const signingKey = deriveSigningKey(
    input.credentials.secretAccessKey,
    dateStamp,
    input.region,
    input.service
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization =
    `${SIGV4_ALGORITHM} Credential=${input.credentials.accessKeyId}/${credentialScope}` +
    `, SignedHeaders=${signed}, Signature=${signature}`;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(allHeaders)) {
    if (name !== 'host') headers[name] = value;
  }
  headers.authorization = authorization;

  return {
    amzDate,
    canonicalRequest,
    stringToSign,
    credentialScope,
    signedHeaders: signed,
    signature,
    authorization,
    headers,
  };
}
