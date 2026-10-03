import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  extractBearerToken,
  INITIAL_TOKEN_VERSION,
  signToken,
  verifyToken,
  type StoredTokenVersion,
} from './auth';

/**
 * A stored version, fixed. These tests are about signature, claim and expiry
 * handling, so the revocation answer is pinned rather than modelled -- unless a
 * test is specifically about revocation, which supplies its own.
 */
const stored =
  (version: number): StoredTokenVersion =>
  async () =>
    version;

describe('auth token verification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifies a token signed by the configured secret', async () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = signToken('user-1', INITIAL_TOKEN_VERSION);

    expect(await verifyToken(token, stored(0))).toEqual({
      userId: 'user-1',
      tokenVersion: 0,
    });
  });

  it('rejects a token with an unsigned or tampered payload', async () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = signToken('user-1', INITIAL_TOKEN_VERSION);
    const [header, payload, signature] = token.split('.');
    const forged = `${header}.${(payload ?? '').slice(0, -1)}x.${signature}`;

    expect(await verifyToken(forged, stored(0))).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = signToken('user-1', INITIAL_TOKEN_VERSION);
    vi.stubEnv('JWT_SECRET', 'b'.repeat(32));

    expect(await verifyToken(token, stored(0))).toBeNull();
  });

  it('rejects a token with no subject', async () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = jwt.sign({ ver: 0 }, 'a'.repeat(32), {
      expiresIn: '7d',
      algorithm: 'HS256',
    });

    expect(await verifyToken(token, stored(0))).toBeNull();
  });
});

/**
 * THE POINT OF THE CHANGE.
 *
 * A seven-day HS256 token used to be valid for seven days no matter what the
 * account did, because "did the account revoke anything" was not a question any
 * caller could answer: there was nowhere to record the answer. Every case below
 * is the same three-step shape -- mint a token, move the stored generation, watch
 * the token stop working -- because that is exactly what logout and a password
 * change do.
 */
describe('token revocation by generation', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a token whose version matches what is stored', async () => {
    const token = signToken('user-1', 3);

    expect(await verifyToken(token, stored(3))).toEqual({ userId: 'user-1', tokenVersion: 3 });
  });

  it('rejects a token minted before the stored version moved', async () => {
    const token = signToken('user-1', 0);

    expect(await verifyToken(token, stored(1))).toBeNull();
  });

  it('rejects a token that is several generations stale', async () => {
    const token = signToken('user-1', 1);

    expect(await verifyToken(token, stored(9))).toBeNull();
  });

  /**
   * Equality, not `>=`. The stored generation only increases, so a token
   * claiming a version *ahead* of storage cannot come from a legitimate mint --
   * it is a forgery, a stale read, or a token signed against a database this
   * process cannot see. Answering `null` for all three keeps the failure
   * indistinguishable to the caller and fails closed.
   */
  it('rejects a token claiming a version ahead of what is stored', async () => {
    const token = signToken('user-1', 5);

    expect(await verifyToken(token, stored(2))).toBeNull();
  });

  /**
   * A signed token for an account that no longer exists. Before this column it
   * authenticated for its remaining lifetime, and `POST /api/auth/ws-ticket`
   * would mint a live collaboration ticket for a subject nothing could resolve.
   */
  it('rejects a token whose account has no stored version', async () => {
    const token = signToken('deleted-user', 0);

    expect(await verifyToken(token, async () => null)).toBeNull();
  });

  it('rejects an expired token before consulting storage at all', async () => {
    const token = jwt.sign({ userId: 'user-1', ver: 0 }, 'a'.repeat(32), {
      expiresIn: -1,
      algorithm: 'HS256',
    });
    let consulted = false;
    const source: StoredTokenVersion = async () => {
      consulted = true;
      return 0;
    };

    expect(await verifyToken(token, source)).toBeNull();
    // Nothing to consult: a dead token is dead however the account looks.
    expect(consulted).toBe(false);
  });

  it('asks storage for the token subject, and for nothing else', async () => {
    const asked: string[] = [];
    const token = signToken('user-1', 0);

    await verifyToken(token, async userId => {
      asked.push(userId);
      return 0;
    });

    expect(asked).toEqual(['user-1']);
  });

  /**
   * Deliberately NOT swallowed into a `null`. If the revocation check cannot be
   * performed, the caller has to decide what that means -- an http-server
   * middleware answers 401, a Server Component surfaces an error -- and quietly
   * turning a storage outage into an authentication failure would hide one behind
   * the other.
   */
  it('propagates a storage failure rather than reporting it as an invalid token', async () => {
    const token = signToken('user-1', 0);
    const source: StoredTokenVersion = async () => {
      throw new Error('connection terminated');
    };

    await expect(verifyToken(token, source)).rejects.toThrow('connection terminated');
  });
});

/**
 * The deploy-time question.
 *
 * Every token in circulation when this column shipped carries no `ver` claim.
 * Rejecting them signs every user out the moment the new code deploys; accepting
 * them as "the initial generation" means each is valid until it would have expired
 * anyway, and dies at that account's first logout or password change. The second
 * property is the one that closes the hole, so it is asserted directly: the
 * unversioned token is not a permanent exemption.
 */
describe('tokens issued before the version column existed', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const unversionedToken = (userId: string): string =>
    jwt.sign({ userId }, 'a'.repeat(32), { expiresIn: '7d', algorithm: 'HS256' });

  it('accepts one while the account is still at the initial generation', async () => {
    expect(await verifyToken(unversionedToken('user-1'), stored(INITIAL_TOKEN_VERSION))).toEqual({
      userId: 'user-1',
      tokenVersion: 0,
    });
  });

  it('rejects one once the account has revoked anything', async () => {
    expect(await verifyToken(unversionedToken('user-1'), stored(1))).toBeNull();
  });

  /**
   * A replayed stale token costs one indexed primary-key read, and no more.
   *
   * Pinned because it is the only per-request cost this change adds, and
   * because the alternative -- caching the generation to avoid the read -- is
   * precisely what would turn revocation back into "eventually". Asserting that
   * the read happens exactly once, for exactly the token subject, is how a future
   * optimisation is prevented from quietly reintroducing a staleness window.
   */
  it('costs exactly one read of the token subject, even for a stale token', async () => {
    const reads: string[] = [];
    const source: StoredTokenVersion = async userId => {
      reads.push(userId);
      return 0;
    };
    const stale = signToken('user-1', 7);

    expect(await verifyToken(stale, source)).toBeNull();
    expect(await verifyToken(stale, source)).toBeNull();
    expect(reads).toEqual(['user-1', 'user-1']);
  });
});

describe('the version claim is read defensively', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Only this package can write a correctly typed claim, so a wrong *type* means
   * something is wrong elsewhere. Reading it as the initial generation rather
   * than throwing means such a token is then compared against storage like any
   * other value and refused if the account has moved on -- it never gets a reading
   * of its own that lets it past.
   */
  for (const [label, claim] of [
    ['a string', '3'],
    ['null', null],
    ['a negative number', -1],
    ['a float', 1.5],
    ['an object', { version: 3 }],
  ] as const) {
    it(`treats ${label} as the initial generation`, async () => {
      const token = jwt.sign({ userId: 'user-1', ver: claim }, 'a'.repeat(32), {
        expiresIn: '7d',
        algorithm: 'HS256',
      });

      expect(await verifyToken(token, stored(0))).toEqual({ userId: 'user-1', tokenVersion: 0 });
      expect(await verifyToken(token, stored(1))).toBeNull();
    });
  }

  it('refuses to mint a token at a negative or non-integer version', () => {
    expect(() => signToken('user-1', -1)).toThrow(RangeError);
    expect(() => signToken('user-1', 1.5)).toThrow(RangeError);
  });
});

describe('extractBearerToken', () => {
  it('extracts the token from a canonical Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts the scheme in any case per RFC 7235', () => {
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('BEARER abc')).toBe('abc');
    expect(extractBearerToken('BeArEr abc')).toBe('abc');
  });

  it('tolerates multi-space separators (1*SP) and token68 padding', () => {
    expect(extractBearerToken('Bearer  abc=')).toBe('abc=');
  });

  it('rejects non-Bearer schemes, bare tokens, and empty values', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken('bare-token-without-scheme')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});
