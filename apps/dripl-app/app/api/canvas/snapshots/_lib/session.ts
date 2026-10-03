import { NextResponse, type NextRequest } from 'next/server';
import { logError, logWarn } from '@dripl/common';
import { verifyToken } from '@dripl/utils/auth';
import {
  MAX_USER_ID_LENGTH,
  SESSION_COOKIE,
  candidateTokens,
  isSessionVerificationConfigured,
} from '@/lib/server/session';

/**
 * Caller identity for the snapshot collection routes.
 *
 * This is not a second auth path. It is the mechanism `/api/ai/generate`
 * already uses in this app: read the `dripl-session` cookie that the Google
 * OAuth callback and `lib/api.ts` set, fall back to an `Authorization: Bearer`
 * header for cross-origin callers, and verify the HS256 JWT with
 * `JWT_SECRET` through `@dripl/utils/auth`. The token's `userId` is the
 * `User.id` primary key, which is the same value `http-server`'s
 * `FileService.getFile(userId, fileId)` compares against, so ownership means
 * the same thing here as it does everywhere else in the product.
 *
 * The route that reads Postgres directly (`/api/canvas/snapshots`) verifies
 * the JWT itself instead of proxying to `http-server`, because proxying would
 * mean shipping the scene bytes through a second service for an authorisation
 * decision that is one indexed primary-key lookup.
 *
 * Every denial is built here rather than at the call sites so the two routes
 * cannot drift into answering different bodies for the same class of refusal.
 *
 * Token extraction and the `userId` bound live in `lib/server/session`, shared
 * with the Server Components that read the same cookie through `cookies()`.
 * A third local copy of that decoding is the drift this note exists to prevent,
 * and `canvasSnapshots.authz.test.ts` drives both routes through this module,
 * so the sharing is covered rather than assumed.
 */

/** Denials are per-caller data. Never let a proxy or the browser keep one. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * `verifyToken` calls `requiredEnv('JWT_SECRET')`, which throws when the
 * variable is absent. Without this the route would surface that throw as a 500
 * for every request; instead an unconfigured deployment is reported as the
 * 503 it is, matching `/api/ai/generate`.
 */
export function isAuthConfigured(): boolean {
  return isSessionVerificationConfigured();
}

function sessionTokens(request: NextRequest): string[] {
  return candidateTokens({
    cookieValue: request.cookies?.get(SESSION_COOKIE)?.value,
    authorization: request.headers.get('authorization') ?? undefined,
  });
}

/**
 * Either the caller's `User.id`, or the response to send instead. Returning
 * the denial keeps the "identical answer for every refusal" property a
 * property of one function rather than of two route handlers.
 */
export type SnapshotCaller =
  { authorized: true; userId: string } | { authorized: false; response: NextResponse };

/**
 * Identify the caller, or produce the refusal. Never throws and never queries
 * storage, so a caller with no usable credential cannot reach the database
 * through this function at all — that is what makes the 401 independent of
 * whether the requested canvas exists.
 */
export function getSnapshotCaller(request: NextRequest): SnapshotCaller {
  if (!isAuthConfigured()) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Authentication is not configured.' },
        { status: 503, headers: NO_STORE }
      ),
    };
  }

  for (const token of sessionTokens(request)) {
    const payload = verifyToken(token);
    if (!payload || typeof payload.userId !== 'string') continue;
    const userId = payload.userId.trim();
    if (userId && userId.length <= MAX_USER_ID_LENGTH) {
      return { authorized: true, userId };
    }
  }

  return {
    authorized: false,
    response: NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401, headers: NO_STORE }
    ),
  };
}

/**
 * The one answer for "you may not have this canvas". Shared by both routes and
 * by both refusal reasons (a canvas owned by somebody else, and a canvas that
 * does not exist) so the two are byte-identical on the wire.
 *
 * `logWarn` records who asked for what, because a denial is the one event here
 * worth an audit trail; the canvas slug is already length-bounded by the route.
 */
export function denySnapshotAccess(canvasId: string, userId: string, event: string): NextResponse {
  logWarn(JSON.stringify({ level: 'warn', event, userId, canvasId }));
  return NextResponse.json(
    { error: 'Snapshot access denied.' },
    { status: 403, headers: NO_STORE }
  );
}

/**
 * A storage failure during the ownership lookup is a 500, never a 403. Folding
 * it into the denial would tell a caller that "cannot check" means "not yours",
 * and it would be a lie about a database that is merely unreachable.
 */
export function snapshotAccessCheckFailed(event: string, userId: string): NextResponse {
  logError(JSON.stringify({ level: 'error', event, userId }));
  return NextResponse.json(
    { error: 'Unable to verify snapshot access.' },
    { status: 500, headers: NO_STORE }
  );
}
