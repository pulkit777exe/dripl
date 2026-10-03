import { vi } from 'vitest';
import type { TokenVersionStore } from '@dripl/db';

/**
 * Session-token revocation for dripl-app's route suites.
 *
 * Every session reader in this app (`lib/server/session.ts`,
 * `app/api/canvas/snapshots/_lib/session.ts`, `app/api/ai/generate/route.ts`)
 * resolves a token's stored generation through `@dripl/db` before it will
 * identify a caller. A suite that mocks `@dripl/db` with a hand-built client
 * therefore has to supply the revocation half too, or the route throws on
 * `undefined.findUnique` and answers 401 -- which is indistinguishable, in the
 * assertion, from a suite that is simply broken.
 *
 * These are the *production* functions bound to the suite's own storage. A suite
 * that revokes and re-presents a token is therefore running the same comparison
 * the server runs, rather than its own copy of the arithmetic.
 */

/**
 * The `@dripl/db` exports a session-aware route needs, backed by `store`.
 *
 * `store` needs exactly the two methods revocation reads and writes, so a suite can
 * build one from its own fixtures. Spread into a suite's existing mock factory:
 *
 *   vi.mock('@dripl/db', async () => ({
 *     db: harness.client,
 *     initializeDb: async () => harness.client,
 *     ...(await revocationExports({ user: myUserTable })),
 *   }));
 *
 * where `myUserTable` answers `findUnique` and `update` over whatever rows the
 * suite already keeps.
 */
export async function revocationExports(
  store: TokenVersionStore
): Promise<{ loadStoredTokenVersion: unknown; revokeIssuedTokens: unknown }> {
  const actual = await vi.importActual<typeof import('@dripl/db')>('@dripl/db');
  return {
    loadStoredTokenVersion: actual.tokenVersionReader(store),
    revokeIssuedTokens: actual.tokenRevoker(store),
  };
}
