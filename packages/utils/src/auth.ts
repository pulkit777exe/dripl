import jwt from 'jsonwebtoken';
import { requiredEnv } from './env';

const getJwtSecret = (): string => requiredEnv('JWT_SECRET');

/**
 * The generation a freshly minted token carries, and the value `User.tokenVersion`
 * holds for an account that has never had a session revoked. One constant rather
 * than two so the migration default and the claim cannot drift apart.
 */
export const INITIAL_TOKEN_VERSION = 0;

/**
 * The `ver` claim's wire name. Short because it is in every token, long-lived
 * enough not to collide with a registered JWT claim.
 */
export const TOKEN_VERSION_CLAIM = 'ver';

export interface JwtPayload {
  userId: string;
  /**
   * The account generation this token was minted at. Always a number: a token
   * issued before revocation existed carries no claim at all, and that token is
   * treated as `INITIAL_TOKEN_VERSION` rather than rejected, because the column
   * it is checked against also defaulted to that value. Rejecting it would sign
   * every user out on deploy; accepting it as 0 means it lives exactly as long
   * as it would have anyway (its own 7-day expiry) and dies at the account's
   * first logout or password change.
   */
  tokenVersion: number;
}

/**
 * Reads the generation currently stored for `userId`, or `null` when no such
 * account exists.
 *
 * MANDATORY argument to `verifyToken`, and the reason revocation cannot be
 * skipped: `verifyToken` refuses to return a payload without one, so there is no
 * signature that verifies a token without also checking it. Callers cannot
 * opt out, and cannot pass a stand-in by accident, because the only
 * implementation in the tree is `loadStoredTokenVersion` from `@dripl/db` --
 * a `pkg:data` package that `pkg:core` code cannot reach, which is what keeps
 * the check from being quietly deleted at the lowest layer.
 *
 * Returning `null` means "no such user", and `verifyToken` treats it as a
 * refusal. That is deliberate: a token for a deleted account used to keep
 * working for its remaining lifetime, and `POST /api/auth/ws-ticket` would mint
 * a live collaboration ticket for it.
 */
export type StoredTokenVersion = (userId: string) => Promise<number | null>;

/**
 * Verify a session token: signature, expiry, subject, and revocation.
 *
 * Asynchronous because revocation needs the stored generation, and the whole
 * point of putting the check here is that no caller can skip it.
 *
 * Rejects when the token's version is not exactly the stored one. Equality, not
 * `>=`: the stored generation only ever increases, so "ahead of storage" is not
 * a benign race to be tolerated but an unreadable row or a forged claim, and
 * both should end in the same answer as an expired token -- `null`.
 *
 * A resolver that throws is *not* swallowed into a refusal: the caller decides
 * what an unreachable database means (an http-server middleware answers 401,
 * which is the safe reading), and silently converting it to `null` here would
 * hide a storage outage behind an authentication failure.
 */
export async function verifyToken(
  token: string,
  loadStoredTokenVersion: StoredTokenVersion
): Promise<JwtPayload | null> {
  const decoded = decodeToken(token);
  if (!decoded) return null;

  const stored = await loadStoredTokenVersion(decoded.userId);
  if (stored === null) return null;
  if (decoded.tokenVersion !== stored) return null;

  return decoded;
}

/**
 * Signature, expiry and claims only, as a private step of `verifyToken`.
 *
 * Module-private rather than exported: an exported signature-only reader is a
 * second way to accept a session token, and every additional way to accept one
 * is a place revocation can be forgotten. Nothing in the tree needs it -- logout,
 * the one route that has to name an account before it can revoke it, uses the
 * fully checked reader, because a token that is already revoked needs no further
 * revocation.
 */
function decodeToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload & { userId?: unknown; [TOKEN_VERSION_CLAIM]?: unknown };
    if (typeof decoded.userId !== 'string' || decoded.userId.length === 0) return null;
    return { userId: decoded.userId, tokenVersion: readTokenVersion(decoded[TOKEN_VERSION_CLAIM]) };
  } catch {
    return null;
  }
}

/**
 * The claim is an integer the server wrote, so anything else -- absent (a token
 * predating revocation), `null`, a float, a string, an object -- reads as the
 * initial generation rather than as an error. A token claiming the wrong *type*
 * is then compared against storage like any other value and fails; it never
 * gets a privileged reading of its own.
 */
function readTokenVersion(claim: unknown): number {
  if (claim === undefined) return INITIAL_TOKEN_VERSION;
  if (typeof claim !== 'number' || !Number.isSafeInteger(claim) || claim < 0) {
    return INITIAL_TOKEN_VERSION;
  }
  return claim;
}

/**
 * Mint a session token at `tokenVersion`, which must be the account's currently
 * stored generation -- read it, do not guess it. A token minted below the stored
 * value is dead on arrival, so the parameter is required rather than defaulted:
 * a caller that forgets has to think about where the number comes from, and
 * every `signToken` call in the tree becomes a visible answer to "where does
 * this version come from".
 */
export function signToken(userId: string, tokenVersion: number): string {
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
    throw new RangeError(
      `signToken: tokenVersion must be a non-negative integer, got ${tokenVersion}`
    );
  }
  return jwt.sign({ userId, [TOKEN_VERSION_CLAIM]: tokenVersion }, getJwtSecret(), {
    expiresIn: '7d',
    algorithm: 'HS256',
  });
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  // RFC 7235: the auth-scheme is case-insensitive ("bearer <tok>" is valid),
  // one or more spaces separate scheme from token, and token68 contains no
  // whitespace. Rejects non-Bearer schemes outright.
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authHeader);
  return match?.[1] ?? null;
}
