/**
 * Server-side calls to `http-server`, for Server Components and server actions.
 *
 * Two properties this module exists to guarantee:
 *
 * 1. **The session is forwarded explicitly.** `http-server` authenticates with
 *    `authMiddleware`, which reads the `dripl-session` cookie *or* an
 *    `Authorization: Bearer` header. A server-side fetch has no ambient cookie
 *    jar for a different origin, so the token is read here and set on the
 *    header explicitly. Nothing else about the request changes, and the token
 *    is never placed in a URL, a log, or a rendered value.
 *
 * 2. **Caching is a decision, not a default.** Every call site passes a policy.
 *    Anything keyed to a person is `no-store`: the Next data cache is shared
 *    across visitors, so a cached personalized body would be served to the next
 *    requester. Anything keyed to a capability in the URL is `no-store` too,
 *    because the response is that capability's payload and must not outlive the
 *    request. `revalidate` is only correct for a body that is identical for
 *    every caller, and no such body is fetched here today — so the type makes
 *    the future caller state the exception rather than pass it by accident.
 */
import type { SessionBearer } from './session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api';

/**
 * Why a call is or is not cacheable, stated by the caller.
 *
 * `no-store` is the only member. That is deliberate: a `revalidate` member would
 * be one keystroke away from being applied to a personalized body, and the
 * failure mode is serving one user's files to another. A body that genuinely is
 * identical for every caller is better served by a cacheable `fetch` written at
 * the call site with that reasoning attached, not by a flag here.
 */
export type ServerFetchCache = 'no-store';

export class ServerApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ServerApiError';
    this.status = status;
  }
}

/** `http-server` answers errors as `{ error, message, ... }`. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export type ServerFetchOptions = {
  /**
   * The verified session token from `readSessionBearer()`. `null` means "make
   * the anonymous call" — the share endpoint, which authenticates on its token.
   */
  token: SessionBearer;
  cache: ServerFetchCache;
  signal?: AbortSignal;
};

/**
 * One JSON GET against `http-server`, authenticated, uncached, and typed.
 *
 * Errors surface as `ServerApiError` carrying the upstream `status`, so a route
 * can answer 401 exactly as the API would instead of turning every refusal into
 * a generic 500. The status is copied deliberately and nothing else is: the
 * upstream body is not forwarded, because it is a service-shaped payload, not
 * something to hand to a page.
 */
export async function serverApiGet<T>(path: string, options: ServerFetchOptions): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    cache: options.cache,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ServerApiError(response.status, await errorMessage(response));
  }

  return (await response.json()) as T;
}

/**
 * Whether a rejection is an upstream refusal with one of these statuses.
 *
 * Callers use it to answer a refusal the way the API answered it rather than
 * collapsing every failure into one shape. A 401 or a 403 means "not you", and
 * a page with nothing to show should send the caller wherever the client used to
 * send them; a 500 means the API is broken, which must not be reported to a user
 * as though they had done something wrong.
 */
export function serverApiError(error: unknown, statuses: readonly number[]): boolean {
  return error instanceof ServerApiError && statuses.includes(error.status);
}
