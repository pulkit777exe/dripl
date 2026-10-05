import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '@dripl/utils/auth';

import {
  MAX_USER_ID_LENGTH,
  SESSION_COOKIE,
  candidateTokens,
  isSessionVerificationConfigured,
  readSessionBearer,
  readSessionUserId,
  userIdFromCandidates,
} from '@/lib/server/session';

/**
 * `lib/server/session.ts` -- the Server Components' session reader.
 *
 * The file is the third of three readers of the `dripl-session` cookie, and it is
 * the one with no HTTP surface of its own, so it is the one most likely to be
 * quietly diverged from. `tokenRevocation.test.ts` already drives
 * `userIdFromCandidates` through real signing and revocation; what is left is the
 * credential-*extraction* half, which every one of those calls depends on.
 *
 * The property under test is that neither transport is a weaker path than the
 * other, plus two specific hazards of this cookie:
 *
 *   ordering -- the cookie is the credential the browser sends on its own, the
 *               `Authorization` header is the one a scripted caller adds. If the
 *               header went first, a page whose cookie is stale but whose header
 *               is fresh would silently use the scripted identity instead of the
 *               signed-in one.
 *   decoding -- the cookie is written with `encodeURIComponent`, and a JWT is
 *               base64url, so a *literal* `%` in the stored value is a real
 *               token. A `decodeURIComponent` that throws would drop it.
 *   dedup -- the same token arriving on both transports must appear once, or the
 *               reader verifies the same credential twice for no reason.
 *
 * `candidateTokens` is exercised directly rather than through `readSessionUserId`
 * because it is pure and exported for exactly this purpose; testing it here does
 * not duplicate the revocation suite, which never varies the transport.
 */

/** The cookie jar `next/headers`' `cookies()` is stood in for with. */
const cookieJar = vi.hoisted(() => new Map<string, string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

/**
 * The stored revocation generation, per account.
 *
 * A Map rather than a mock assertion because `verifyToken` compares the token's
 * claim against this value to decide whether the token is still current, so the
 * tests exercise real signing *and* real verification against fake storage. A
 * stubbed `verifyToken` would let a reader that skipped revocation pass.
 * `vi.hoisted` because the mock factory is hoisted above ordinary bindings.
 */
const storedGenerations = vi.hoisted(() => new Map<string, number | null>());

vi.mock('@dripl/db', () => ({
  loadStoredTokenVersion: async (userId: string) => storedGenerations.get(userId) ?? null,
}));

/**
 * A JWT-ish token string.
 *
 * Real signing is unnecessary here and would couple these tests to `JWT_SECRET`:
 * `candidateTokens` never verifies anything, it only orders and de-duplicates
 * credentials. The label is arbitrary and deliberately percent-free, so this
 * value is a fixed point of `decodeURIComponent` -- a JWT is base64url and needs
 * no encoding, so a real cookie round-trips to the same string.
 */
const token = (label: string) => `header.${label}.signature`;

/** A cookie value whose `%` is not a valid escape, so `decodeURIComponent` throws. */
const MALFORMED_COOKIE = 'abc%ZZdef';

describe('candidateTokens', () => {
  beforeEach(() => {
    cookieJar.clear();
  });

  afterEach(() => {
    cookieJar.clear();
  });

  // Regression: the cookie is the most-trusted credential. Putting the header
  // first would let a scripted caller's identity win over the browser's own
  // cookie whenever both are present.
  it('prefers the cookie over the authorization header', () => {
    const result = candidateTokens({
      cookieValue: token('cookie'),
      authorization: `Bearer ${token('header')}`,
    });

    expect(result).toEqual([token('cookie'), token('header')]);
  });

  it('decodes a percent-encoded cookie value the way encodeURIComponent wrote it', () => {
    // `token('a')` contains `%3D`; encoded, that becomes `%253D`. Decoding once
    // must land on the original, not on a half-decoded `=`.
    const encoded = encodeURIComponent(token('a'));

    expect(candidateTokens({ cookieValue: encoded })).toEqual([token('a')]);
  });

  // Regression: `decodeURIComponent('%')` throws a `URIError`, and a throwing
  // decode is exactly what would silently sign this user out. The raw value is
  // the right fallback -- it is still a credential worth trying.
  it('falls back to the raw cookie value when decoding throws', () => {
    expect(candidateTokens({ cookieValue: MALFORMED_COOKIE })).toEqual([MALFORMED_COOKIE]);
  });

  it.each([
    ['an empty cookie value', ''],
    ['a cookie value of only a percent sign', '%'],
  ])('tolerates %s', (_label, cookieValue) => {
    expect(() => candidateTokens({ cookieValue })).not.toThrow();
  });

  // The empty-string case is not just "does not throw": a cookie that decodes to
  // nothing must not become a candidate, or the reader would send `Bearer `.
  it('does not offer an empty credential when decoding yields nothing', () => {
    expect(candidateTokens({ cookieValue: '' })).toEqual([]);
  });

  it.each([
    ['no inputs at all', {}],
    ['an undefined cookie value', { cookieValue: undefined }],
    ['a null authorization header', { authorization: null }],
    ['an undefined authorization header', { authorization: undefined }],
    ['an empty authorization header', { authorization: '' }],
  ])('yields no candidates for %s', (_label, input) => {
    expect(candidateTokens(input)).toEqual([]);
  });

  // RFC 7235: the scheme is case-insensitive and one-or-more spaces separate it
  // from the token. A non-Bearer scheme is not a session credential at all, and
  // admitting one would let an unrelated `Authorization` header authenticate.
  it.each([
    ['a lowercase scheme', 'bearer tok-h', ['tok-h']],
    ['an uppercase scheme', 'BEARER tok-h', ['tok-h']],
    ['extra spaces after the scheme', 'Bearer    tok-h', ['tok-h']],
    ['a trailing space', 'Bearer tok-h ', ['tok-h']],
    ['a Basic credential', 'Basic dXNlcjpwYXNz', []],
    ['a bare token with no scheme', 'tok-h', []],
    ['a scheme with no token', 'Bearer', []],
    ['a two-token header', 'Bearer tok-a tok-b', []],
  ])('handles %s', (_label, authorization, expected) => {
    expect(candidateTokens({ authorization })).toEqual(expected);
  });

  // Regression: the same credential arriving on both transports is one
  // credential. Duplicating it makes the reader verify the same token twice, and
  // -- because `readSessionBearer` stops at the first candidate that verifies --
  // a duplicate could make it return a token whose *second* position matters.
  it('de-duplicates a token supplied on both transports', () => {
    const shared = token('shared');

    expect(candidateTokens({ cookieValue: shared, authorization: `Bearer ${shared}` })).toEqual([
      shared,
    ]);
  });

  it('de-duplicates a token whose encoded cookie equals the raw header token', () => {
    const plain = token('a');

    // The cookie arrives encoded, the header raw: same credential after decode.
    expect(
      candidateTokens({ cookieValue: encodeURIComponent(plain), authorization: `Bearer ${plain}` })
    ).toEqual([plain]);
  });

  it('keeps genuinely different tokens from the two transports', () => {
    const result = candidateTokens({
      cookieValue: token('cookie'),
      authorization: `Bearer ${token('header')}`,
    });

    expect(new Set(result).size).toBe(result.length);
    expect(result).toHaveLength(2);
  });

  // The reader's own `userIdFromCandidates` skips a token that does not verify and
  // tries the next, so ordering is what decides *which* identity a page sees.
  // Pinned here with real signed tokens to show the pair survives the same code
  // path the Server Components use.
  it('orders a real signed cookie token ahead of a real signed header token', () => {
    process.env.JWT_SECRET = 'test-secret-for-candidate-ordering';
    try {
      const cookieToken = signToken('user-cookie', 0);
      const headerToken = signToken('user-header', 0);

      const result = candidateTokens({
        cookieValue: encodeURIComponent(cookieToken),
        authorization: `Bearer ${headerToken}`,
      });

      expect(result).toEqual([cookieToken, headerToken]);
    } finally {
      delete process.env.JWT_SECRET;
    }
  });
});

/**
 * The request-scope readers, driven through the cookie jar.
 *
 * `readSessionUserId` and `readSessionBearer` differ in one way that matters and is
 * worth naming: the first answers "who is this?" and the second hands back the raw
 * credential so a Server Component can forward it upstream. The bearer reader is
 * therefore deliberately narrower than it looks -- it returns a token *only* if
 * `userIdFromCandidates` would accept it, so a caller can never forward a
 * credential this module would not have honoured. Every test below asserts the
 * bearer case *alongside* the userId case rather than alone, because a test that
 * only checks "a token came back" passes for any implementation that returns the
 * cookie unverified.
 *
 * `JWT_SECRET` is present unless a test removes it, which is the configured case;
 * `requiredEnv` inside `verifyToken` throws without it, and the module converts
 * that into "no session" -- an asymmetry the last block pins.
 */
describe('readSessionUserId / readSessionBearer', () => {
  beforeEach(() => {
    cookieJar.clear();
    storedGenerations.clear();
    process.env.JWT_SECRET = 'test-secret-for-session-readers';
  });

  afterEach(() => {
    cookieJar.clear();
    storedGenerations.clear();
    delete process.env.JWT_SECRET;
  });

  /** Signs a token and registers the account so revocation check passes. */
  function signed(userId: string, tokenVersion = 0): string {
    storedGenerations.set(userId, tokenVersion);
    return signToken(userId, tokenVersion);
  }

  it('reports the configured state from JWT_SECRET', () => {
    expect(isSessionVerificationConfigured()).toBe(true);
    delete process.env.JWT_SECRET;
    expect(isSessionVerificationConfigured()).toBe(false);
  });

  it('reads the signed-in user id from the cookie', async () => {
    cookieJar.set(SESSION_COOKIE, signed('user-1'));

    expect(await readSessionUserId()).toBe('user-1');
  });

  it('reads through the encoded form the cookie is actually written in', async () => {
    cookieJar.set(SESSION_COOKIE, encodeURIComponent(signed('user-1')));

    expect(await readSessionUserId()).toBe('user-1');
  });

  it('hands back the raw token alongside a verified user id', async () => {
    const token = signed('user-1');
    cookieJar.set(SESSION_COOKIE, token);

    // Both halves asserted together: a bearer reader that skipped verification
    // would still satisfy a test looking only for a string.
    expect(await readSessionUserId()).toBe('user-1');
    expect(await readSessionBearer()).toBe(token);
  });

  it('returns the decoded token rather than the encoded cookie value', async () => {
    const token = signed('user-1');
    cookieJar.set(SESSION_COOKIE, encodeURIComponent(token));

    expect(await readSessionBearer()).toBe(token);
  });

  // Regression: the refusal cases must all read as "no session", not as a 500 and
  // not as a partially-trusted identity.
  it.each([
    ['no cookie at all', () => undefined],
    ['a token that is not a JWT', () => 'not-a-jwt'],
    ['a token signed with another secret', () => signTokenWithWrongSecret()],
    ['a revoked token', () => revoked()],
    ['a token for a deleted account', () => signToken('ghost', 0)],
  ])('reports no session for %s', async (_label, makeCookie) => {
    const token = makeCookie();
    if (token !== undefined) cookieJar.set(SESSION_COOKIE, token);

    expect(await readSessionUserId()).toBeNull();
    expect(await readSessionBearer()).toBeNull();
  });

  function signTokenWithWrongSecret(): string {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'a-different-secret';
    try {
      const forged = signToken('user-1', 0);
      storedGenerations.set('user-1', 0);
      return forged;
    } finally {
      process.env.JWT_SECRET = previous;
    }
  }

  /** Signed at version 0 while storage has since moved to 1 -- i.e. logged out. */
  function revoked(): string {
    storedGenerations.set('user-1', 1);
    return signToken('user-1', 0);
  }

  // Regression: the unconfigured deployment. `verifyToken` would throw
  // `requiredEnv('JWT_SECRET')`, and a Server Component has no response to turn
  // that into, so the reader reports "no session" and lets the caller decide
  // between a redirect and an error.
  it('reports no session rather than throwing when JWT_SECRET is absent', async () => {
    cookieJar.set(SESSION_COOKIE, signToken('user-1', 0));
    delete process.env.JWT_SECRET;

    expect(isSessionVerificationConfigured()).toBe(false);
    expect(await readSessionUserId()).toBeNull();
    // The bearer reader short-circuits before reading the jar, so no credential
    // escapes an unconfigured deployment.
    expect(await readSessionBearer()).toBeNull();
  });

  // Regression: the bounded `userId`. `MAX_USER_ID_LENGTH` bounds what a
  // caller can push through a forged-but-signed token, so an over-long claim must
  // be refused rather than used as a database key.
  it('refuses a user id longer than the documented maximum', async () => {
    const tooLong = 'x'.repeat(MAX_USER_ID_LENGTH + 1);
    cookieJar.set(SESSION_COOKIE, signed(tooLong));

    expect(await readSessionUserId()).toBeNull();
    expect(await readSessionBearer()).toBeNull();
  });

  it('accepts a user id exactly at the maximum length', async () => {
    const atLimit = 'x'.repeat(MAX_USER_ID_LENGTH);
    cookieJar.set(SESSION_COOKIE, signed(atLimit));

    expect(await readSessionUserId()).toBe(atLimit);
  });

  // Regression: the trim. A claim padded with whitespace is trimmed before use, so
  // `userIdFromCandidates` returns the id a caller would recognise.
  it('trims whitespace from the user id claim', async () => {
    cookieJar.set(SESSION_COOKIE, signed('  user-1  '));

    expect(await readSessionUserId()).toBe('user-1');
  });

  // `readSessionUserId` is documented to never throw for an unusable credential,
  // but a *storage* failure is deliberately not swallowed: a database that cannot
  // answer is not the same statement as "this visitor is signed out", and
  // reporting it as such would redirect the whole site to /login during an outage.
  it('propagates a storage failure rather than reporting no session', async () => {
    const db = await import('@dripl/db');
    vi.spyOn(db, 'loadStoredTokenVersion').mockRejectedValueOnce(
      new Error('database is unreachable')
    );
    cookieJar.set(SESSION_COOKIE, signed('user-1'));

    await expect(readSessionUserId()).rejects.toThrow('database is unreachable');
  });
});

describe('userIdFromCandidates', () => {
  beforeEach(() => {
    storedGenerations.clear();
    process.env.JWT_SECRET = 'test-secret-for-session-readers';
  });

  afterEach(() => {
    storedGenerations.clear();
    delete process.env.JWT_SECRET;
  });

  it('returns null for an empty candidate list', async () => {
    expect(await userIdFromCandidates([])).toBeNull();
  });

  // Regression: the loop's `continue`. The first candidate must not end the search
  // -- a page whose cookie is stale would otherwise report no session while a
  // valid second credential sat right behind it.
  it('tries the next candidate when the first does not verify', async () => {
    storedGenerations.set('user-2', 0);

    expect(await userIdFromCandidates(['not-a-jwt', signToken('user-2', 0)])).toBe('user-2');
  });

  it('returns the first candidate that verifies', async () => {
    storedGenerations.set('user-1', 0);
    storedGenerations.set('user-2', 0);

    expect(await userIdFromCandidates([signToken('user-1', 0), signToken('user-2', 0)])).toBe(
      'user-1'
    );
  });

  it('reports no session when JWT_SECRET is absent, without consulting storage', async () => {
    delete process.env.JWT_SECRET;

    expect(await userIdFromCandidates(['anything'])).toBeNull();
  });
});
