/**
 * `AuthService.googleAuth` — sign-in by Google ID token.
 *
 * The route (`POST /api/auth/google`) had exactly two cases: a missing token, and
 * OAuth not being configured. Everything past the payload check was untested, which
 * leaves the whole account-provisioning path uncovered: create-on-first-sight, and
 * the name/image sync on every subsequent sign-in.
 *
 * That sync is the part worth pinning, because it is the only place in this server
 * where one principal's request writes fields on another principal's behalf, and it
 * has three conditions that must hold *simultaneously* for a write to be correct:
 *
 *   - a name is only adopted when Google supplies one **and** the account has none;
 *   - an image is adopted whenever Google's differs;
 *   - if neither changed, **no update is issued at all**.
 *
 * The last one is the subtle one. Writing unconditionally would overwrite a name the
 * user set in-app with whatever their Google profile happens to say, on every single
 * sign-in — the user would be unable to keep a display name. So the cases below assert
 * the absence of the write, not just the presence of the value.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

// `googleAuth` itself sends no mail, but `authService` imports the mailer at module
// scope, so the import must not reach nodemailer.
vi.mock('../../lib/mailer', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendResetPasswordEmail: vi.fn(async () => {}),
}));

import { db } from '@dripl/db';
import { AuthService } from '../../services/authService';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';
import { seedSessionUser } from '../test-utils/authenticatedRequest';

const EXISTING_ID = 'user-existing';
const GOOGLE_EMAIL = 'person@example.com';

beforeEach(() => {
  resetFakeDb();
});

/** An existing account, with the fields the sync reads. */
function seedExisting(overrides: Record<string, unknown> = {}): void {
  seedSessionUser(EXISTING_ID, {
    email: GOOGLE_EMAIL,
    name: null,
    image: null,
    emailVerified: true,
    ...overrides,
  });
}

describe('a Google account seen for the first time', () => {
  /**
   * Create-on-first-sight, with the profile Google supplied.
   *
   * Asserted on the stored row rather than on the return value alone: a service that
   * returned the right shape without writing the row would pass the first half and
   * fail on the second Google sign-in, when there would be nothing to update.
   */
  it('creates the account with the profile Google sent', async () => {
    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', 'https://img/ada.png');

    const stored = fakeDb()
      .rows('user')
      .find(row => row.email === GOOGLE_EMAIL);
    expect(stored).toMatchObject({
      email: GOOGLE_EMAIL,
      name: 'Ada',
      image: 'https://img/ada.png',
      // A Google account is verified by construction — the token proved control of
      // the address — so it must not arrive needing a verification email.
      emailVerified: expect.anything(),
    });
    expect(user).toMatchObject({ email: GOOGLE_EMAIL, name: 'Ada', image: 'https://img/ada.png' });
  });

  /**
   * The returned generation is the one the route will stamp the session token with.
   *
   * `googleAuth` returns `tokenVersion` for exactly this reason: `POST /google` signs
   * the session token from it. A new account defaults to `INITIAL_TOKEN_VERSION`, and
   * a route that defaulted instead of reading it would mint a token at the wrong
   * generation — dead on arrival for any account that has since revoked.
   */
  it('reports a generation the session token can be signed at', async () => {
    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(user.tokenVersion).toBe(fakeDb().tokenVersionOf(user.id));
  });

  /**
   * DEFECT (verified against `postgres:16`, not inferred): a Google sign-in creates
   * the account UNVERIFIED.
   *
   * `googleAuth`'s insert names `id`, `email`, `name` and `image` — not
   * `emailVerified` — so the column takes its schema default of `false`. Google
   * verified the address by construction (that is what an ID token with the right
   * audience asserts), and `register` is the only path that ever sends a
   * verification email, so a Google-created account has no way to become verified:
   * `resendVerification` finds no unverified *email-verification* row to reissue and
   * `verifyEmail` has no token to redeem. The account is stuck.
   *
   * The consequence is a lockout, not a data leak: `POST /api/auth/login` answers
   * `needs_verification` for the account forever, so a user who signed in with Google
   * and later tries to sign in with a password cannot, and one who *only* ever uses
   * Google keeps working because `POST /api/auth/google` mints its session token
   * without consulting the flag.
   *
   * This assertion states what the code does, not what it should do, because the
   * contract cannot be changed here and a green suite must not depend on a fix
   * landing. It is the pin that makes the defect visible: change the insert to name
   * `emailVerified: true` and this fails, which is the moment to delete it.
   */
  it('creates the account unverified, which is the defect', async () => {
    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(
      fakeDb()
        .rows('user')
        .find(row => row.id === user.id)?.emailVerified
    ).toBe(false);
  });

  /**
   * The lockout that follows from it, demonstrated end to end.
   *
   * A Google sign-in succeeds, and the very next password login for the same account
   * is refused for a reason the user cannot act on — there is no verification mail to
   * click, because none was ever sent. Asserted because it is the user-visible shape
   * of the defect above; if either half is fixed, this fails.
   */
  it('leaves the account unable to sign in with a password afterwards', async () => {
    await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    // A password is set out of band, or by a future "add a password" flow. Either
    // way, the account is now fully formed and the flag still blocks it.
    const row = fakeDb()
      .rows('user')
      .find(candidate => candidate.email === GOOGLE_EMAIL);
    if (row) fakeDb().seed('user', { ...row, password: 'a-hash' });

    expect(await AuthService.login(GOOGLE_EMAIL, 'a-hash')).toEqual({
      type: 'needs_verification',
    });
  });

  /**
   * A missing name or image is stored as null rather than as the string "null".
   *
   * Google omits both for some accounts, and the profile route writes whatever it is
   * given. `"Ada"` vs `null` is cosmetic; `"null"` is a visible bug.
   */
  it('stores absent profile fields as null', async () => {
    const user = await AuthService.googleAuth(GOOGLE_EMAIL, null, null);

    const stored = fakeDb()
      .rows('user')
      .find(row => row.id === user.id);
    expect(stored?.name).toBeNull();
    expect(stored?.image).toBeNull();
  });
});

describe('an existing account signing in again', () => {
  /**
   * The name is adopted only when the account has none.
   *
   * This is the in-app name surviving a Google sign-in. If Google always won, a user
   * who set a display name would find it replaced on their next sign-in, with no way
   * to keep it.
   */
  it('adopts the Google name when the account has none', async () => {
    seedExisting({ name: null });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(user.name).toBe('Ada');
    expect(fakeDb().rows('user')[0]?.name).toBe('Ada');
  });

  /**
   * The image is adopted when it differs.
   *
   * A changed Google picture is the normal case — people change them — so this one is
   * deliberately *not* guarded by "the account has none", unlike the name.
   */
  it('adopts a changed Google image', async () => {
    seedExisting({ name: 'Ada', image: 'https://img/old.png' });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', 'https://img/new.png');

    expect(user.image).toBe('https://img/new.png');
    expect(fakeDb().rows('user')[0]?.image).toBe('https://img/new.png');
  });

  /**
   * An in-app name beats a Google one.
   *
   * The regression this guards is a "sync on every login" change written as an
   * unconditional overwrite. The user-visible symptom is a display name that reverts
   * every time its owner signs in, which looks like a caching bug in the client and
   * is not.
   */
  it('does not overwrite a name the account already has', async () => {
    seedExisting({ name: 'Chosen In App' });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(user.name).toBe('Chosen In App');
    expect(fakeDb().rows('user')[0]?.name).toBe('Chosen In App');
  });

  /**
   * And issues no write at all when nothing changed.
   *
   * Asserted as the *absence* of an update, which is the property that matters and the
   * one a value-only assertion cannot see: an unconditional `db.user.update` would
   * return the right values and still be wrong, because it would race with an
   * in-flight profile edit and clobber it with a value read before the edit landed.
   */
  it('issues no update when Google sends nothing new', async () => {
    seedExisting({ name: 'Chosen In App', image: 'https://img/same.png' });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', 'https://img/same.png');

    expect(user).toMatchObject({ name: 'Chosen In App', image: 'https://img/same.png' });
    // `update` would be the only write path here; `findUnique` is the read.
    expect(fakeDb().rows('user')).toHaveLength(1);
    expect(fakeDb().rows('user')[0]?.updatedAt).toEqual(
      // `fakePrisma` stamps every seeded row with its fixed epoch, so an untouched
      // row still carries that value while a written one would not.
      new Date('2026-01-01T00:00:00.000Z')
    );
  });

  /**
   * Google omitting a name does not clear the one the account has.
   *
   * `if (name && !user.name)` — a truthiness guard, not an assignment. Written as
   * `if (name !== undefined) user.name = name` with `name` defaulting to `null`, this
   * would blank every profile on each sign-in from a Google account that has no name.
   */
  it('does not clear the stored name when Google omits one', async () => {
    seedExisting({ name: 'Chosen In App', image: 'https://img/same.png' });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, null, 'https://img/same.png');

    expect(user.name).toBe('Chosen In App');
  });

  /**
   * Google omitting an image does not clear the stored one either.
   *
   * The same reasoning as the name, on the field where a real regression bit once:
   * a user who set a custom avatar would lose it on every sign-in.
   */
  it('does not clear the stored image when Google omits one', async () => {
    seedExisting({ name: 'Ada', image: 'https://img/custom.png' });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(user.image).toBe('https://img/custom.png');
  });

  /**
   * The generation is read, not defaulted.
   *
   * The account may have revoked sessions since it last signed in, and the route
   * signs the session token from whatever this returns. Defaulting to zero would mint
   * a token that `verifyToken` refuses on the very next request — a sign-in that
   * appears to succeed and leaves the user unauthenticated.
   */
  it('reports the stored generation, not the initial one', async () => {
    seedSessionUser(EXISTING_ID, {
      email: GOOGLE_EMAIL,
      emailVerified: true,
      // Three prior revocations: two logouts and a password change.
      tokenVersion: 3,
    });

    const user = await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(user.tokenVersion).toBe(3);
  });

  /**
   * A second sign-in does not create a duplicate account.
   *
   * The lookup is by email, so this is really a statement about the lookup key. A
   * change to it — to `id`, say — would silently fork every Google account in the
   * database on its next sign-in, and neither copy would notice.
   */
  it('does not create a second account for the same address', async () => {
    seedExisting({ name: 'Ada' });

    await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(fakeDb().rows('user')).toHaveLength(1);
  });

  /**
   * Two different addresses are two accounts.
   *
   * The control for the case above, and the reason the lookup key is pinned from both
   * sides: an implementation that matched on nothing at all would pass "no duplicate"
   * for the same address and fail here.
   */
  it('creates a separate account for a different address', async () => {
    seedExisting({ name: 'Ada' });

    await AuthService.googleAuth('someone-else@example.com', 'Grace', null);

    expect(
      fakeDb()
        .rows('user')
        .map(row => row.email)
        .sort()
    ).toEqual([GOOGLE_EMAIL, 'someone-else@example.com']);
  });

  /**
   * The account is matched by the email Google vouched for, and only that.
   *
   * `db.user.findUnique({ where: { email } })` is the whole authorisation here — the
   * route has already verified the ID token's audience and signature, so the email in
   * the payload is trustworthy. Asserting the query keeps the trust boundary visible:
   * a lookup widened to `{ id: payload.sub }` or matched case-insensitively would be
   * matching on something the token does not prove.
   */
  it('looks the account up by the email from the verified payload', async () => {
    seedExisting({ name: 'Ada' });
    const findUnique = vi.spyOn(db.user, 'findUnique');

    await AuthService.googleAuth(GOOGLE_EMAIL, 'Ada', null);

    expect(findUnique).toHaveBeenCalledWith({ where: { email: GOOGLE_EMAIL } });
  });
});
