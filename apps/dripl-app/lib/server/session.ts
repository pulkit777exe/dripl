/**
 * Server-side session identity for React Server Components.
 *
 * This is the third reader of the `dripl-session` cookie, not a second auth
 * path. The other two are `app/api/ai/generate/route.ts` and
 * `app/api/canvas/snapshots/_lib/session.ts`, and both already describe
 * themselves that way. The reason a third exists is mechanical: those two read
 * a `NextRequest`, because they *are* the request. A Server Component does not
 * receive one — it gets the request scope through `cookies()` — so the token
 * extraction they need has to be reachable from a different entry point.
 *
 * The rule the three share: read the cookie, fall back to `Authorization:
 * Bearer` for cross-origin callers, verify the HS256 JWT with `JWT_SECRET`
 * through `@dripl/utils/auth`, and treat a token's `userId` as the `User.id`
 * primary key. `verifyToken` is the single verification point, so a forged,
 * expired or *revoked* token fails identically here. It is also the only place
 * the token's version claim is compared against the account's stored
 * generation, which is why all three readers import `loadStoredTokenVersion`
 * from `@dripl/db` rather than each writing the query: a reader that forgot the
 * comparison would have to be a whole new reader, not a new line in this one.
 *
 * The token itself never leaves this module's return values. Nothing here logs
 * it, and callers receive a `userId` or `null` — never the credential — so a
 * page that renders the result cannot leak the session into HTML by accident.
 */
import { cookies } from 'next/headers';
import { extractBearerToken, verifyToken } from '@dripl/utils/auth';
import { loadStoredTokenVersion } from '@dripl/db';

export const SESSION_COOKIE = 'dripl-session';

/**
 * Longest accepted `userId`. A `User.id` is a uuid, so this only bounds what a
 * caller can push through a forged-but-signed token; it is not an ownership
 * signal. Carried over from the snapshot route so the two readers cannot
 * disagree about what a well-formed session is.
 */
export const MAX_USER_ID_LENGTH = 200;

/**
 * `verifyToken` calls `requiredEnv('JWT_SECRET')`, which throws when the
 * variable is absent. A Server Component has no response to turn that throw
 * into, so an unconfigured deployment is reported as "no session" here and
 * the route that asked decides whether that is a redirect or an error — the
 * same 503-vs-401 split the API routes make, expressed as a value instead of a
 * status code.
 */
export function isSessionVerificationConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET);
}

/**
 * The cookie is written with `encodeURIComponent` by `lib/api.ts` and by the
 * Google OAuth callback, so a value containing a literal `%` is a real token and
 * must not be dropped by a throwing `decodeURIComponent`.
 */
function decodeCookieToken(cookieToken: string): string {
  try {
    return decodeURIComponent(cookieToken);
  } catch {
    return cookieToken;
  }
}

/**
 * Every credential worth trying, most-trusted first, with duplicates removed.
 *
 * Order matters and is not arbitrary: the cookie is the credential the browser
 * sends on its own, the header is the one a scripted cross-origin caller adds.
 * Trying both means neither transport is a weaker path than the other, which is
 * what keeps a server-side fetch from silently diverging from the client one.
 */
export function candidateTokens(input: {
  cookieValue?: string | undefined;
  authorization?: string | null | undefined;
}): string[] {
  const tokens: string[] = [];
  const cookieToken = input.cookieValue;
  if (cookieToken) {
    const decoded = decodeCookieToken(cookieToken);
    if (decoded) tokens.push(decoded);
  }

  const bearerToken = extractBearerToken(input.authorization ?? undefined);
  if (bearerToken && !tokens.includes(bearerToken)) tokens.push(bearerToken);
  return tokens;
}

/**
 * The caller's `User.id`, or `null`. Never throws for an unusable credential: a
 * token that does not verify and an unconfigured deployment both resolve to "no
 * session" rather than a 500, which is what lets a caller build its own refusal
 * without duplicating try/catch.
 *
 * A *storage* failure does throw, and that asymmetry is deliberate. This reader
 * has to ask the database whether the token is still current, and a database that
 * cannot answer is not the same statement as "this visitor is signed out".
 * Reporting it as "no session" would redirect a whole site to `/login` during a
 * brief outage and hide the outage behind a login page; letting it propagate
 * sends it to the error boundary, which is the honest report. Nothing about the
 * account is rendered on either path.
 */
export async function userIdFromCandidates(tokens: readonly string[]): Promise<string | null> {
  if (!isSessionVerificationConfigured()) return null;
  for (const token of tokens) {
    const payload = await verifyToken(token, loadStoredTokenVersion);
    if (!payload || typeof payload.userId !== 'string') continue;
    const userId = payload.userId.trim();
    if (userId && userId.length <= MAX_USER_ID_LENGTH) return userId;
  }
  return null;
}

/**
 * The signed-in caller's `User.id` for the current request, or `null`.
 *
 * `cookies()` is awaited because Next 16 types the request scope as a promise.
 * Reading it also opts this route into dynamic rendering, which is the
 * intended effect: a page whose content depends on who is asking must never be
 * served from a shared prerender, and the `Cache-Control: private, no-store`
 * that follows from dynamic rendering is the platform enforcing that rather
 * than a comment promising it.
 */
export async function readSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  return userIdFromCandidates(candidateTokens({ cookieValue: jar.get(SESSION_COOKIE)?.value }));
}

/**
 * A verified session token, or `null`.
 *
 * A named alias rather than a bare `string | null` so that every consumer of a
 * session credential handles the null case explicitly. The failure this prevents
 * is a falsy check that is not a null check: an empty string would pass through
 * to `Authorization: Bearer ` and produce a confusing 401 from the upstream
 * rather than the local refusal.
 */
export type SessionBearer = string | null;

/**
 * The raw verified session token, for the one caller that has to hand it to an
 * upstream service: `lib/server/api.ts`, which sends it as
 * `Authorization: Bearer` rather than relying on ambient cookies it cannot see.
 *
 * Kept separate from `readSessionUserId` so that the far more common question
 * ("who is this?") has no way to accidentally obtain a usable credential. This
 * returns `null` unless the token both verifies and yields a bounded `userId`,
 * so a caller can never forward a token this module would not have accepted.
 */
export async function readSessionBearer(): Promise<SessionBearer> {
  if (!isSessionVerificationConfigured()) return null;
  const jar = await cookies();
  for (const token of candidateTokens({ cookieValue: jar.get(SESSION_COOKIE)?.value })) {
    if ((await userIdFromCandidates([token])) !== null) return token;
  }
  return null;
}
