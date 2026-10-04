/**
 * THE ACCOUNT-LOCKOUT AND PRUNE ARITHMETIC IN `authService`.
 *
 * `login` carries a per-email attempt counter that locks an account for 15 minutes
 * after 5 failures. Two things about it are security-relevant and neither is
 * asserted anywhere:
 *
 *   1. **The lockout must not be a DoS.** Anyone who knows an email address can lock
 *      that account by failing the password five times. That is a deliberate trade —
 *      brute-force resistance bought with a lockout lever — and it is only
 *      acceptable because of what happens around it:
 *
 *      - the lockout does **not** extend on further attempts, so hammering a locked
 *        account cannot keep it locked indefinitely;
 *      - the lockout does **not** leak: a locked account is refused *before* the
 *        password is checked, and is refused for the right password too, so the
 *        response is not a password oracle;
 *      - the counter is **reset on success**, so a user who fumbles their password
 *        twice and then types it correctly is not one typo from a 15-minute lockout.
 *
 *   2. **The counter map is process-local and unbounded unless pruned.**
 *      `loginAttempts` is keyed by an email address the caller supplies, so without
 *      `pruneLoginAttempts` a script that varies the address grows the map once per
 *      request for the life of the process.
 *
 * WHY EVERY CASE USES ITS OWN ADDRESS
 *
 * `loginAttempts` is a module-level `Map` with no reset hook. Loading the service
 * fresh per case (`vi.resetModules()`) does not work: it hands the service a
 * *different* `@dripl/db` mock instance from the one the test holds, so the `where`
 * clauses under test stop being the ones the assertions read. So the map is shared,
 * and isolation comes from the key: each case uses a distinct address, which is also
 * the shape a real attacker would have to use.
 *
 * The lockout window is 15 minutes, far too long to wait out, so these cases use fake
 * timers — the clock is the subject, and advancing it is the only way the boundary is
 * observable at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The in-memory fake over the *production* revocation functions, so the login
// route's `authMiddleware` and `AuthService` agree about what a generation is.
vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

// `authService` sends mail from `register`/`forgotPassword`/`resendVerification`,
// none of which this suite calls, but the import must not reach nodemailer.
vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import bcrypt from 'bcryptjs';
import { db } from '@dripl/db';
import { AuthService } from '../../services/authService';

/** A real bcrypt hash at cost 4 — low, so the suite stays fast. */
const HASH = bcrypt.hashSync('correct-horse-battery', 4);
const PASSWORD = 'correct-horse-battery';
const WRONG = 'not-the-password';

const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * A distinct address per case.
 *
 * Not cosmetic: the counter is module state keyed by address, so a shared address
 * would make the suite order-dependent — and an order-dependent lockout suite reads
 * as a lockout bug, which is the worst possible failure mode for this file.
 */
let caseCounter = 0;
const freshAddress = (): string => `user-${(caseCounter += 1)}@example.com`;

/**
 * Make every address resolve to a verified account with a known password.
 *
 * `vi.spyOn` rather than `vi.mocked(...).mockResolvedValue`: the in-memory fake's
 * model methods are plain async functions, not `vi.fn()`s, so there is no mock to
 * configure — only a property to replace. `afterEach`'s `restoreAllMocks` puts the
 * real one back, which is what keeps a later case from inheriting this.
 */
/**
 * A flat account row, as `findUnique` returns one for a scalar `select`.
 *
 * The relations Prisma's `User` type carries (`teams`, `files`, `folders`, ...) do
 * not exist on such a select, and the service under test never reads them, so the
 * row is cast once here rather than each stub repeating the cast -- or the shared
 * fake being widened for fields nothing asserts on.
 */
function accountRow(
  overrides: Record<string, unknown> = {}
): Awaited<ReturnType<typeof db.user.findUnique>> {
  return {
    id: 'some-account',
    email: 'some-account@example.com',
    name: null,
    image: null,
    emailVerified: true,
    password: HASH,
    tokenVersion: 0,
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof db.user.findUnique>>;
}

function everyAddressIsAnAccount(): void {
  vi.spyOn(db.user, 'findUnique').mockImplementation(
    // The in-memory fake declares a scalar return type while `mockImplementation` is
    // checked against Prisma's `User`, which carries relations. Bridged once here so
    // every stub below can just call `accountRow()`.
    (async () => accountRow()) as unknown as typeof db.user.findUnique
  );
}

let compare: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  compare = vi.spyOn(bcrypt, 'compare');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the attempt counter at its exact boundary', () => {
  /**
   * `MAX_LOGIN_ATTEMPTS` is 5, and the counter locks at `attempts >= 5`. The exact
   * shape matters and is easy to assert wrongly: the 5th failure *arms* the lock and
   * still answers `invalid_password` (it is the failure that did it), and the 6th is
   * the first refusal.
   *
   * So this pins all six answers. Asserting only "the 6th is refused" would pass for a
   * limiter that refused one request later than intended; asserting only "the 5th is
   * refused" would pass for one that refuses one request earlier.
   */
  it('arms the lock on the fifth failure and refuses from the sixth', async () => {
    const address = freshAddress();
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    const answers = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      answers.push((await AuthService.login(address, WRONG)).type);
    }

    expect(answers).toEqual([
      'invalid_password',
      'invalid_password',
      'invalid_password',
      'invalid_password',
      'invalid_password',
      'account_locked',
    ]);
  });

  /**
   * The lockout holds for the right password too.
   *
   * If a locked account still checked the password, a correct password would answer
   * `success` and a wrong one `account_locked` — turning the lockout into a password
   * oracle for anyone who can reach the endpoint. Asserted explicitly because that is
   * the failure mode, not the happy path.
   */
  it('refuses the correct password while the account is locked', async () => {
    const address = freshAddress();
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await AuthService.login(address, WRONG);
    }

    expect(await AuthService.login(address, PASSWORD)).toEqual({ type: 'account_locked' });
    // Not merely refused: the password was never compared, which is what makes the
    // refusal non-disclosing. Five failures, and nothing since.
    expect(compare).toHaveBeenCalledTimes(5);
  });

  /**
   * Further failures do not extend the lock.
   *
   * The locking attempt resets the counter to zero rather than incrementing it, and
   * the early return for a locked account means the deadline is never refreshed. If
   * it were, five requests a second against a locked address would hold an account
   * locked for as long as the attacker cared to keep going — unusable without an
   * out-of-band intervention, which is the DoS the design is trying to bound.
   */
  it('does not extend the lock when a locked account keeps failing', async () => {
    const address = freshAddress();
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await AuthService.login(address, WRONG);
    }
    expect(await AuthService.login(address, WRONG)).toEqual({ type: 'account_locked' });

    // Hammer it throughout the window. Every one of these is refused, and none of
    // them may push the deadline out.
    for (let round = 0; round < 20; round += 1) {
      vi.advanceTimersByTime(30_000);
      expect(await AuthService.login(address, WRONG), `round ${round}`).toEqual({
        type: 'account_locked',
      });
    }

    // 10 minutes of hammering. One more 5 minutes and the *original* deadline has
    // passed — which an extending lockout would have prevented.
    vi.advanceTimersByTime(5 * 60 * 1000);
    compare.mockResolvedValue(true);
    expect(await AuthService.login(address, PASSWORD)).toMatchObject({ type: 'success' });
  });

  /**
   * A success clears the counter.
   *
   * Without `loginAttempts.delete(address)` on success, four typos followed by a
   * correct password would leave the account one attempt from a lockout — so a user
   * who mistypes their way to the right answer is punished for succeeding. Driven to
   * the edge and then back down: without the delete, the second run would refuse.
   */
  it('clears the counter on a successful login', async () => {
    const address = freshAddress();
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await AuthService.login(address, WRONG);
    }
    compare.mockResolvedValue(true);
    expect(await AuthService.login(address, PASSWORD)).toMatchObject({ type: 'success' });

    compare.mockResolvedValue(false);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await AuthService.login(address, WRONG);
    }
    // Still only a wrong password: the four pre-success failures did not carry over.
    expect(await AuthService.login(address, WRONG)).toEqual({ type: 'invalid_password' });
  });

  /**
   * One account's lockout does not touch another's.
   *
   * The counter is keyed by address, so it must be. A shared counter would let five
   * attempts against one address consume the budget that every other address shares.
   */
  it('scopes the lockout to one email address', async () => {
    const locked = freshAddress();
    const bystander = freshAddress();
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await AuthService.login(locked, WRONG);
    }
    expect(await AuthService.login(locked, WRONG)).toEqual({ type: 'account_locked' });

    compare.mockResolvedValue(true);
    expect(await AuthService.login(bystander, PASSWORD)).toMatchObject({ type: 'success' });
  });

  /**
   * The lockout expires on its own.
   *
   * A 15-minute lock that only an out-of-band write could clear would be both a
   * support burden and a DoS amplifier. One millisecond short of the window is still
   * locked; one past it is not.
   */
  it('expires on its own after the lockout window', async () => {
    const address = freshAddress();
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await AuthService.login(address, WRONG);
    }

    vi.advanceTimersByTime(LOCKOUT_MS - 1);
    expect(await AuthService.login(address, WRONG)).toEqual({ type: 'account_locked' });

    vi.advanceTimersByTime(2);
    compare.mockResolvedValue(true);
    expect(await AuthService.login(address, PASSWORD)).toMatchObject({ type: 'success' });
  });
});

describe('an address that cannot log in is never counted as an attempt', () => {
  /**
   * An unknown address is not counted.
   *
   * `login` returns `not_found` before it touches `bcrypt` and before it records
   * anything. That matters for the map: if unknown addresses were counted, an attacker
   * could reach the 10,000-entry prune threshold — and the eviction path with it —
   * without knowing a single valid password, purely by varying the address.
   *
   * Then the control: a real account is still fully lockable afterwards, which a
   * shared counter would have broken.
   */
  it('does not count an address with no account', async () => {
    const unknown = freshAddress();
    vi.spyOn(db.user, 'findUnique').mockResolvedValue(null);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(await AuthService.login(unknown, WRONG)).toEqual({ type: 'not_found' });
    }
    // No comparison happened at all, so nothing could have been recorded.
    expect(compare).not.toHaveBeenCalled();

    // And the counter is untouched: a real account still takes a full five.
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);
    const real = freshAddress();
    const answers = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      answers.push((await AuthService.login(real, WRONG)).type);
    }
    expect(answers.at(-1)).toBe('account_locked');
  });

  /**
   * An unverified account is also not counted.
   *
   * `needs_verification` returns before `bcrypt.compare`, for the same reason: a
   * fresh account that has not clicked its email yet should not be one typo away from
   * a 15-minute lockout on its very first login attempt.
   */
  it('does not count an unverified account', async () => {
    const address = freshAddress();
    vi.spyOn(db.user, 'findUnique').mockResolvedValue(
      accountRow({ id: 'user-unverified', email: address, emailVerified: false })
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(await AuthService.login(address, PASSWORD)).toEqual({ type: 'needs_verification' });
    }

    expect(compare).not.toHaveBeenCalled();
  });
});

describe('pruneLoginAttempts bounds the counter map', () => {
  /**
   * The eviction path.
   *
   * `loginAttempts` is a module-level `Map` keyed by an address the caller supplies,
   * so it is attacker-growable: a script that varies the address grows it once per
   * request for the life of the process. `pruneLoginAttempts` deletes settled records
   * and then evicts oldest-first at 10,000 entries.
   *
   * Driven past the threshold with failing logins against 10,050 distinct addresses,
   * then asserted on *behaviour*: the very first address has been evicted, so its next
   * failure starts from zero attempts. If its pre-sweep attempt had survived, four
   * failures would already be enough to reach the threshold again — which is exactly
   * the difference the final assertion turns on, and it survives a change of eviction
   * policy as long as the bound holds.
   *
   * `bcrypt.compare` is stubbed to fail: the subject is the map, and 10,050 real
   * hashes would dominate the suite's runtime for no extra coverage — the comparison
   * itself is exercised by the cases above.
   */
  it('evicts the oldest addresses instead of growing without bound', async () => {
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    const oldest = freshAddress();
    await AuthService.login(oldest, WRONG);
    for (let index = 0; index < 10_050; index += 1) {
      await AuthService.login(`bulk-${index}@example.com`, WRONG);
    }

    // The oldest address. Its pre-sweep attempt would still be recorded, so the
    // fifth failure below would be the *sixth* thing its counter has seen.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(
        (await AuthService.login(oldest, WRONG)).type,
        `failure ${attempt} after the sweep`
      ).toBe('invalid_password');
    }
    // Only now, on the sixth, is it locked.
    expect((await AuthService.login(oldest, WRONG)).type).toBe('account_locked');
  });

  /**
   * The bound evicts; it does not clear.
   *
   * A wholesale `clear()` would pass the case above for the wrong reason, and would
   * also hand every caller a fresh budget on every insert once the map was full —
   * turning the limiter into a no-op exactly when it is needed. Asserted by keeping a
   * *recently* exhausted address exhausted: it cannot be the eviction victim, so its
   * own counter must still be there.
   */
  it('keeps recently exhausted addresses exhausted rather than clearing the map', async () => {
    everyAddressIsAnAccount();
    compare.mockResolvedValue(false);

    for (let index = 0; index < 10_050; index += 1) {
      await AuthService.login(`bulk-${index}@example.com`, WRONG);
    }
    const newest = freshAddress();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await AuthService.login(newest, WRONG);
    }

    // Insert more, forcing further eviction past the bound.
    for (let index = 0; index < 20; index += 1) {
      await AuthService.login(`later-${index}@example.com`, WRONG);
    }

    // Still locked: the map was evicted from, not emptied.
    expect((await AuthService.login(newest, WRONG)).type).toBe('account_locked');
  });
});
