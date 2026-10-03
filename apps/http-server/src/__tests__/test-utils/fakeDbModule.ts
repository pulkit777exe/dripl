/**
 * The `@dripl/db` module a suite installs in place of the real one.
 *
 * WHY THIS EXISTS RATHER THAN A HAND-WRITTEN FACTORY PER FILE
 *
 * Every http-server suite that touches the database mocks `@dripl/db` wholesale,
 * and `vi.mock` *replaces* a module rather than merging into it. So anything new
 * exported from `@dripl/db` is simply absent under those mocks until each one is
 * updated -- which is exactly what happened when session-token revocation added
 * `loadStoredTokenVersion` and `revokeIssuedTokens`: the auth suites went red
 * with `loadStoredTokenVersion is not a function`, for a reason that had nothing
 * to do with the code under test.
 *
 * Centralising the factory means a new export of `@dripl/db` is added in one place
 * and every suite picks it up. It also keeps the *real* revocation logic running
 * over the fake storage, rather than each suite hand-rolling a version lookup --
 * a suite that answered the revocation question itself would be testing its own
 * arithmetic instead of the production check.
 *
 * USAGE
 *
 *   vi.mock('@dripl/db', async () => {
 *     const { fakeDbModule } = await import('../test-utils/fakeDbModule');
 *     return fakeDbModule();
 *   });
 *
 * A suite that needs to stub a specific model keeps doing so through
 * `vi.spyOn(db.<model>, ...)`, which composes with this rather than replacing it.
 *
 * A suite that needs a *hand-built* model rather than the in-memory fake passes
 * `overrides`, which is merged over the module. That still gets the real
 * revocation functions, which is the part a hand-built `db` object cannot supply:
 * they are separate exports of this module, and a literal `{ db: { ... } }` factory
 * leaves them `undefined` -- so `authMiddleware` throws on `undefined is not a
 * function` and every request answers 401. That failure is invisible in the
 * assertion it causes (a 401 where a 404 or 413 was expected), which is why this
 * helper exists rather than a convention.
 *
 * WHY `vi.importActual` AND NOT A STATIC IMPORT
 *
 * This module is only ever reached from inside a `vi.mock('@dripl/db')` factory,
 * so a plain `import { tokenVersionReader } from '@dripl/db'` would resolve to the
 * mock being constructed -- the module mid-replacement, where the export does not
 * exist yet. `vi.importActual` is the documented way to reach the real module from
 * inside a mock factory, and it is what makes "the production revocation function,
 * bound to fake storage" true rather than merely intended.
 */
import { vi } from 'vitest';
import type { TokenVersionStore } from '@dripl/db';
import { fakeDb } from './fakePrisma';

/**
 * The module shape `@dripl/db` presents, backed by the in-memory fake.
 *
 * `loadStoredTokenVersion` and `revokeIssuedTokens` are built by the *production*
 * factories, bound to the fake client -- not reimplemented here. That binding is
 * the point: a suite cannot accidentally disagree with the server about what
 * "current generation" means, and a suite that revokes and re-presents a token
 * exercises the same comparison the server does rather than a copy of it.
 */
export async function fakeDbModule(
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<typeof import('@dripl/db')>('@dripl/db');
  const store = fakeDb().db as unknown as TokenVersionStore;
  return {
    db: fakeDb().db,
    initializeDb: async () => fakeDb().db,
    loadStoredTokenVersion: actual.tokenVersionReader(store),
    revokeIssuedTokens: actual.tokenRevoker(store),
    ...overrides,
  };
}

/**
 * The revocation half of `fakeDbModule` on its own, for a suite that builds its own
 * `db` object from `vi.fn()` stubs and cannot use the in-memory fake.
 *
 * Takes the whole client, not the `user` model: `tokenVersionReader` is handed a
 * `TokenVersionStore` and reaches `.user.findUnique` itself, so passing the bare
 * model produces `undefined.findUnique` at the first authenticated request --
 * another 401 with no obvious cause. Either way the comparison under test is the
 * server's own, not a suite's re-implementation of it.
 */
export async function fakeRevocation(
  store: TokenVersionStore
): Promise<{ loadStoredTokenVersion: unknown; revokeIssuedTokens: unknown }> {
  const actual = await vi.importActual<typeof import('@dripl/db')>('@dripl/db');
  return {
    loadStoredTokenVersion: actual.tokenVersionReader(store),
    revokeIssuedTokens: actual.tokenRevoker(store),
  };
}
