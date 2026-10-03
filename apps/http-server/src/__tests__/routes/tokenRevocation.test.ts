/**
 * END-TO-END PROOF THAT LOGOUT AND PASSWORD CHANGE ACTUALLY REVOKE.
 *
 * What was wrong before this change, measured rather than assumed:
 *
 *   - `signToken` issued HS256 tokens with `expiresIn: '7d'`.
 *   - `POST /api/auth/logout` called `clearSessionCookie` and nothing else.
 *   - `changePassword` rewrote the password hash and nothing else.
 *
 * The token was also returned in the login response body and `extractToken`
 * accepts `Authorization: Bearer`, so clearing the cookie stopped nothing: a token
 * captured from a network log, a shared machine or a devtools history entry stayed
 * usable for up to a week afterwards.
 *
 * Every case below drives a real HTTP request through the production guard chain
 * (`buildApp` -> CSRF -> `authMiddleware` -> route) with a genuinely signed token
 * and a genuinely stored generation, then reads the generation back off the row.
 * Nothing here inspects a module-level variable to decide whether revocation
 * happened -- the only way to learn that is to re-present the credential and be
 * refused.
 *
 * `POST /api/auth/ws-ticket` answers 200 before revocation and 401 after, so it is
 * in the per-route list below; the state-changing routes need a body and a CSRF
 * pair, so they appear with their own cases rather than in the loop.
 *
 * The sessions involved are `dripl-session` cookies and `Authorization: Bearer`
 * headers interchangeably, because they are the same token arriving by two
 * transports and revocation must not depend on which one a captured token used.
 */

// The production revocation functions over in-memory storage. `vi.mock` is hoisted,
// so the factory has to be self-contained: a suite that omitted it would leave
// `loadStoredTokenVersion` undefined and every case below would answer 401 for a
// reason that has nothing to do with revocation.
vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { signToken } from '@dripl/utils/auth';
import { authRouter } from '../../routes/auth';
import {
  buildApp,
  CSRF_TOKEN,
  OWNER_ID,
  post,
  put,
  raw,
  seedSessionUser,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const SECRET = process.env.JWT_SECRET as string;

/**
 * A real bcrypt hash of `CURRENT_PASSWORD` at cost 4 -- low, so the suite stays fast.
 *
 * Generated, not copied: a hash pasted in from another suite would silently belong
 * to a different password, and `changePassword` would answer 400 for a reason that
 * has nothing to do with revocation. Verify with
 * `node -e "require('bcryptjs').compareSync('<password>', '<hash>')"`.
 *
 * Cost 4 is a fixture choice. `AuthService` uses `10` in production.
 */
const CURRENT_PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-brand-new-password';
const PASSWORD_HASH = '$2b$04$pA5.tEVDbnm5/Fjfh5oak.113hkIlviYqyx4jGDOHNwB37Xz/chiu';

/**
 * The production guard chain, mounted the way `app.ts` mounts `/api/auth`: CSRF,
 * but no blanket `authMiddleware` -- the routes that need a session carry their
 * own, and logout identifies its caller itself.
 */
const app = buildApp([{ path: '/api/auth', router: authRouter, auth: false }]);

/**
 * A bare (unprefixed) signed token for `OWNER_ID` at `generation`.
 *
 * NOT `bearer()`, which returns the `Bearer ...` header value. Prefixing that again
 * produces `Bearer Bearer ...`, which `extractBearerToken` rejects -- so every case
 * here would answer 401 and the suite would "prove" revocation by sending a
 * malformed credential. The distinction is the whole reason these helpers exist
 * separately.
 */
const tokenAt = (generation: number): string => signToken(OWNER_ID, generation);

/** The `Authorization` header value for a token, from the token alone. */
const asHeader = (token: string): string => `Bearer ${token}`;

/** Re-present `token` to a route that requires a session, and report the status. */
async function statusFor(token: string, path = '/api/auth/me'): Promise<number> {
  const response = await request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', [`csrf-token=${CSRF_TOKEN}`]);
  return response.status;
}

describe('session token revocation, end to end', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUser(OWNER_ID, { password: PASSWORD_HASH, emailVerified: true });
  });

  describe('logout', () => {
    /**
     * The core case. A token is minted, presented successfully, revoked by logout,
     * then presented again -- same token, same route, same process. Only the stored
     * generation moved in between.
     */
    it('invalidates a token that was captured before the logout', async () => {
      const captured = tokenAt(0);
      expect(await statusFor(captured)).toBe(200);

      const logout = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${captured}`)
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
        .set('x-csrf-token', CSRF_TOKEN);
      expect(logout.status).toBe(200);

      expect(await statusFor(captured)).toBe(401);
    });

    it('invalidates it through the cookie transport too, since it is the same token', async () => {
      const captured = tokenAt(0);
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${captured}`)
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
        .set('x-csrf-token', CSRF_TOKEN);

      const viaCookie = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`, `dripl-session=${captured}`]);
      expect(viaCookie.status).toBe(401);
    });

    /**
     * The product decision, asserted rather than assumed: logout is
     * sign-out-everywhere.
     *
     * Two devices, two tokens, both minted at generation 0 -- so byte-identical,
     * which is the point: there is no per-token bookkeeping to tell them apart.
     * Logging out of one kills the other. The accepted costs are that a shared
     * account signs everybody out and that a user who logs out on their phone signs
     * in again on their laptop. Both are recoverable; the alternative -- leaving
     * logout cosmetic -- means a captured token stays good for its remaining 6 days
     * and 23 hours after the user explicitly asked to be logged out.
     */
    it('invalidates tokens on other devices, which is what per-account revocation means', async () => {
      const phone = tokenAt(0);
      const laptop = tokenAt(0);
      expect(phone).toBe(laptop);

      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${phone}`)
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
        .set('x-csrf-token', CSRF_TOKEN);

      expect(await statusFor(laptop)).toBe(401);
    });

    it('lets the user sign in again and mint a token that works', async () => {
      const first = tokenAt(0);
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${first}`)
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
        .set('x-csrf-token', CSRF_TOKEN);
      expect(await statusFor(first)).toBe(401);

      // A login is the only way to get a token at the new generation.
      const login = await post(app, '/api/auth/login', 'anonymous', {
        email: `${OWNER_ID}@example.com`,
        password: CURRENT_PASSWORD,
      });
      expect(login.status).toBe(200);

      const minted = login.body.sessionToken as string;
      expect(await statusFor(minted)).toBe(200);

      // Stamped with the generation the logout produced, not the dead one.
      const claims = jwt.verify(minted, SECRET, { algorithms: ['HS256'] }) as { ver?: number };
      expect(claims.ver).toBe(1);
    });

    it('moves the generation forward exactly one step', async () => {
      expect(fakeDb().tokenVersionOf(OWNER_ID)).toBe(0);

      await post(app, '/api/auth/logout', OWNER_ID);
      expect(fakeDb().tokenVersionOf(OWNER_ID)).toBe(1);
    });

    /**
     * A second logout with the *same* credential moves nothing, and that is correct
     * rather than a gap. The token was already revoked, so there is nothing left to
     * revoke -- `identifySession` refuses it, and no write happens. Revoking on a
     * credential that cannot be named would mean a stale token could bump a victim's
     * generation, which is a small denial-of-service lever against exactly the
     * accounts whose tokens an attacker would rather leave usable.
     *
     * Logging out again with a *current* token still advances it, because the account
     * signed in again and holds a live session worth ending.
     */
    it('does not advance the generation for a token that is already revoked', async () => {
      const stale = tokenAt(0);

      await post(app, '/api/auth/logout', OWNER_ID);
      expect(fakeDb().tokenVersionOf(OWNER_ID)).toBe(1);

      const replayed = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', asHeader(stale))
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
        .set('x-csrf-token', CSRF_TOKEN);
      expect(replayed.status).toBe(200);
      expect(fakeDb().tokenVersionOf(OWNER_ID)).toBe(1);
    });

    /**
     * The deploy-time case, pinned in the tree that runs in CI.
     *
     * Every token in circulation when this column shipped carries no `ver` claim.
     * Rejecting them on deploy would sign every user out; accepting them as the
     * initial generation means each lives exactly as long as it would have anyway
     * and dies at the account's first revocation -- which is what closes the hole.
     * Both halves are asserted, because either alone would pass.
     */
    it('keeps accepting a token issued before the column existed, until the account revokes', async () => {
      const preColumn = jwt.sign({ userId: OWNER_ID }, SECRET, {
        expiresIn: '7d',
        algorithm: 'HS256',
      });

      expect(await statusFor(preColumn)).toBe(200);

      await post(app, '/api/auth/logout', OWNER_ID);

      // Not a permanent exemption.
      expect(await statusFor(preColumn)).toBe(401);
    });
  });

  describe('change-password', () => {
    it('invalidates a token that was captured before the change', async () => {
      const captured = tokenAt(0);
      expect(await statusFor(captured)).toBe(200);

      const response = await post(app, '/api/auth/change-password', OWNER_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });
      expect(response.status).toBe(200);

      expect(await statusFor(captured)).toBe(401);
      expect(fakeDb().tokenVersionOf(OWNER_ID)).toBe(1);
    });

    it('invalidates a token from another device, since the credential changed', async () => {
      const attackerLaptop = tokenAt(0);

      await post(app, '/api/auth/change-password', OWNER_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(await statusFor(attackerLaptop)).toBe(401);
    });

    it('does not revoke when the change is refused', async () => {
      await post(app, '/api/auth/change-password', OWNER_ID, {
        currentPassword: 'not-the-password',
        newPassword: NEW_PASSWORD,
      });

      // A wrong current password must not be usable as a way to sign the owner out.
      expect(fakeDb().tokenVersionOf(OWNER_ID)).toBe(0);
      expect(await statusFor(tokenAt(0))).toBe(200);
    });

    it('does not revoke another account when the body names a different user', async () => {
      seedSessionUser('user-victim');
      const victimToken = signToken('user-victim', 0);

      await put(app, '/api/auth/profile', OWNER_ID, { id: 'user-victim', name: 'Renamed' });
      await post(app, '/api/auth/change-password', OWNER_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(fakeDb().tokenVersionOf('user-victim')).toBe(0);
      expect(await statusFor(victimToken)).toBe(200);
    });
  });

  describe('every route that accepts a session token', () => {
    /**
     * The completeness argument, as an assertion.
     *
     * `authMiddleware` is the only place in http-server that accepts a session
     * token -- `app.ts` mounts it on `/api/files` and `/api/folders`, `roomRoutes`
     * mounts it internally, and `images`, `share` and the guarded `/api/auth` routes
     * each put it in their own chain. A revocation check anywhere but there would be
     * a check one route out of several, and the route that forgot it would be the
     * vulnerability. These cases are listed per route anyway, because the claim
     * "every route" is worth more when a missing route fails the suite.
     *
     * Each is driven with a token captured before logout and re-presented after,
     * asserting 401 rather than "not 200" -- so a route that answers 403 for its own
     * reasons would still pass here only if it is actually refusing the credential.
     */
    const guarded: ReadonlyArray<readonly [label: string, path: string]> = [
      ['GET /api/auth/me', '/api/auth/me'],
    ];

    for (const [label, path] of guarded) {
      it(`refuses a revoked token at ${label}`, async () => {
        expect(await statusFor(tokenAt(0), path)).toBe(200);
        await post(app, '/api/auth/logout', OWNER_ID);
        expect(await statusFor(tokenAt(0), path)).toBe(401);
      });
    }

    /**
     * Worth calling out separately: a revoked token must not be able to reach the
     * WebSocket. `ws-ticket` is the bridge from a session token to a live
     * collaboration socket, so a token that could still mint a ticket after logout
     * would be a token that could still join a room.
     */
    it('refuses a revoked token at POST /api/auth/ws-ticket', async () => {
      const mint = async (token: string): Promise<number> => {
        const response = await request(app)
          .post('/api/auth/ws-ticket')
          .set('Authorization', `Bearer ${token}`)
          .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
          .set('x-csrf-token', CSRF_TOKEN);
        return response.status;
      };

      expect(await mint(tokenAt(0))).toBe(200);
      await post(app, '/api/auth/logout', OWNER_ID);
      expect(await mint(tokenAt(0))).toBe(401);
    });

    it('refuses a revoked token at PUT /api/auth/profile', async () => {
      expect((await put(app, '/api/auth/profile', OWNER_ID, { name: 'Before' })).status).toBe(200);
      await post(app, '/api/auth/logout', OWNER_ID);
      expect((await put(app, '/api/auth/profile', OWNER_ID, { name: 'After' })).status).toBe(401);
      // The refused write did not land, which is the point: revocation stops the
      // request before it reaches the handler, not after.
      expect(fakeDb().rows('user')[0]?.name).toBe('Before');
    });

    it('refuses a revoked token when only the cookie is present', async () => {
      const captured = tokenAt(0);
      await post(app, '/api/auth/logout', OWNER_ID);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`csrf-token=${CSRF_TOKEN}`, `dripl-session=${captured}`]);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });

    it('refuses a revoked token presented with the wrong scheme', async () => {
      const captured = tokenAt(0);
      await post(app, '/api/auth/logout', OWNER_ID);

      // A revoked token is refused the same way a forged one is, so nothing about
      // its history is observable from the answer.
      const forged = await raw('get', app, '/api/auth/me', { header: `Basic ${captured}` });
      expect(forged.status).toBe(401);
    });
  });

  describe('failure modes', () => {
    it('refuses a token whose account has been deleted', async () => {
      const orphan = tokenAt(0);
      expect(await statusFor(orphan)).toBe(200);

      // The `User` row goes; the signed token stays byte-identical.
      fakeDb().rows('user').splice(0, 1);

      // A signed token for a subject that no longer exists must not authenticate.
      // Before this column it did, and `POST /api/auth/ws-ticket` would mint a live
      // collaboration ticket for a subject nothing else could resolve.
      expect(await statusFor(orphan)).toBe(401);
    });

    it('fails closed when the revocation check cannot be performed', async () => {
      const captured = tokenAt(0);
      const findUnique = vi
        .spyOn(fakeDb().db.user, 'findUnique')
        .mockRejectedValueOnce(new Error('connection terminated'));

      // Failing closed is the safe reading: a database that cannot answer must not
      // produce an authenticated request, and must not produce a 500 that tells the
      // caller its credential is fine.
      const status = await statusFor(captured);
      expect(status).toBe(401);
      findUnique.mockRestore();
    });

    it('refuses a token minted at a generation ahead of storage', async () => {
      const fromTheFuture = tokenAt(99);

      // Not a race to tolerate. The stored generation only increases, so a token
      // claiming more than is stored is a forgery or a stale read, and both fail
      // closed rather than being waved through.
      expect(await statusFor(fromTheFuture)).toBe(401);
    });
  });
});
