import type { PrismaClient } from './generated/client';
import * as PrismaClientModule from './generated/client';
export type { Prisma } from './generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as PgModule from 'pg';
import { URL } from 'url';

/**
 * The slice of `process.env` that decides how the pool connects.
 *
 * Passed in rather than read from the environment so every branch below is
 * reachable from a test. Previously all of this was inline in
 * `createPrismaClient`, where it was evaluated exactly once at module load —
 * which is why the package reported 0/28 branches covered while containing the
 * logic that decides whether TLS verification is on.
 */
export interface DbEnvironment {
  DATABASE_URL: string | undefined;
  NODE_ENV: string | undefined;
  DB_ALLOW_INSECURE_TLS: string | undefined;
  DB_POOL_SIZE: string | undefined;
}

/** What `pg.Pool` is constructed with. */
export interface PoolConfig {
  connectionString: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: false | { rejectUnauthorized: false } | undefined;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  max: number;
}

/**
 * Derive the pool configuration from the environment. Pure: no I/O, no globals.
 *
 * The security-relevant part is `ssl`. Certificate verification is on unless
 * one of two explicit, development-only escapes applies, and **neither can fire
 * when `NODE_ENV === 'production'`** — that is the invariant worth a test, and
 * it was previously unreachable from one.
 */
export function buildPoolConfig(env: DbEnvironment): PoolConfig {
  const dbUrl = env.DATABASE_URL ?? '';

  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Make sure dotenv is loaded before using the db module.'
    );
  }

  const isLocalhost = dbUrl.includes('localhost');
  const shouldDisableSsl = isLocalhost && env.NODE_ENV !== 'production';
  const allowInsecureRemoteTls =
    env.NODE_ENV !== 'production' && env.DB_ALLOW_INSECURE_TLS === 'true';

  const url = new URL(dbUrl);
  return {
    // Preserve query parameters such as sslmode from managed PostgreSQL URLs;
    // reconstructing only host/user/password silently downgraded TLS.
    connectionString: dbUrl,
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    // Keep certificate verification enabled by default. Insecure remote TLS
    // is an explicit development-only escape hatch, never a production
    // default.
    ssl: shouldDisableSsl
      ? false
      : allowInsecureRemoteTls
        ? { rejectUnauthorized: false }
        : undefined,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: Math.max(1, parseInt(env.DB_POOL_SIZE || '20', 10) || 20),
  };
}

async function createPrismaClient(): Promise<PrismaClient> {
  const poolConfig = buildPoolConfig({
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    DB_ALLOW_INSECURE_TLS: process.env.DB_ALLOW_INSECURE_TLS,
    DB_POOL_SIZE: process.env.DB_POOL_SIZE,
  });

  const pool = new PgModule.Pool(poolConfig);

  pool.on('error', err => {
    // Idle pool errors fire outside any request context, so there is no
    // request-scoped logger to hand them to.
    console.error('[db] Pool error:', err);
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClientModule.PrismaClient({
    adapter,
    log: process.env.DEBUG_PRISMA ? ['query', 'error', 'warn'] : ['error'],
  });
}

/**
 * The live client, held on `globalThis` rather than in module scope.
 *
 * A module-level `let` is per **module instance**, and a bundler is free to
 * produce more than one instance of a module in a single process. Next 16 with
 * Turbopack does exactly that for this package: a production `next build` emits
 * three server chunks that each contain their own copy of this module —
 * `serverExternalPackages: ['@dripl/db']` is set in `next.config.mjs` and the
 * package is bundled anyway. `app/instrumentation.ts` calls `initializeDb()`,
 * which initialised one copy, while `lib/server/session.ts` closed over another
 * whose instance stayed `null` — so its Proxy threw and every authenticated
 * Server Component route answered 500 in a real production build while passing
 * every test, because the duplication only exists after bundling.
 *
 * `globalThis` is shared by every copy in the process, so whichever one
 * initialises first is the one all of them see. This is the same reason Prisma's
 * own Next.js guidance puts the client on `globalThis`: it also stops dev
 * hot-reload from leaking a connection pool per recompile.
 */
const globalForDb = globalThis as unknown as {
  __driplPrismaClient?: PrismaClient | null;
};

function currentClient(): PrismaClient | null {
  return globalForDb.__driplPrismaClient ?? null;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === 'then') {
      return undefined;
    }
    const instance = currentClient();
    if (!instance) {
      throw new Error(
        'PrismaClient not initialized. This may be due to accessing db before dotenv is loaded or a connection issue. Make sure to load environment variables before using db operations.'
      );
    }
    return (instance as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export async function initializeDb(): Promise<PrismaClient> {
  // Checked on the global, and re-checked after the await: two copies racing to
  // initialize would otherwise each build a pool and leak one.
  if (!currentClient()) {
    globalForDb.__driplPrismaClient = await createPrismaClient();
  }
  return currentClient() as PrismaClient;
}

/*
 * ---------------------------------------------------------------------------
 * Session-token revocation
 * ---------------------------------------------------------------------------
 *
 * WHY A GENERATION COUNTER AND NOT A DENY LIST
 *
 * A deny list answers "is this exact token revoked?", so it needs one row per
 * revoked token, an index to look it up by, and a sweep to expire the rows that
 * outlive their tokens -- and the sweep's failure mode is a list that silently
 * stops shrinking. A generation counter answers the only question that actually
 * gets asked, "was this token minted before the account's last revocation?",
 * which is one indexed primary-key read and one `increment`. It holds no
 * per-token state at any size, so there is nothing to prune and nothing that can
 * fall behind. Its one cost is that revocation is all-or-nothing per account,
 * which for a session cookie is the honest reading of "log me out" anyway.
 *
 * WHY IT LIVES HERE
 *
 * `verifyToken` in `@dripl/utils/auth` takes the stored version as a *required*
 * argument rather than importing it, because `pkg:core` may not depend on
 * `pkg:data` (the `boundaries` block in the root `turbo.json`). The cost of that
 * indirection is that a caller could pass a stand-in, so these are the only
 * implementations of that argument in the tree, and every token-accepting entry
 * point imports one of them rather than writing its own query. A caller that
 * forgets the check cannot compile; a caller that tries to fake it has to add a
 * new database query rather than forget an argument, which is a visible diff.
 */

/**
 * Structurally the `StoredTokenVersion` type from `@dripl/utils/auth`, restated
 * rather than imported: `pkg:data` may not depend on `pkg:core` (the `boundaries`
 * block in the root `turbo.json`), which is the same rule that forces
 * `verifyToken` to receive this as an argument. Duplicating one function type is
 * the cheaper half of that rule.
 */
export type TokenVersionReader = (userId: string) => Promise<number | null>;

/**
 * The narrow slice of Prisma Client these two functions need.
 *
 * Declared structurally rather than as `PrismaClient` so that an in-memory
 * stand-in can be passed in -- which it must be, because every http-server suite
 * replaces this module wholesale (see `test-utils/fakeDbModule.ts`). The two
 * methods are the entire contract, so naming them is the whole specification of
 * what revocation depends on: one `User` read by primary key, one `User` write.
 */
export interface TokenVersionStore {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { tokenVersion: true };
    }): Promise<{ tokenVersion: number } | null>;
    update(args: {
      where: { id: string };
      data: { tokenVersion: { increment: number } };
      select: { tokenVersion: true };
    }): Promise<{ tokenVersion: number }>;
  };
}

/**
 * The one place `PrismaClient` is narrowed to `TokenVersionStore`.
 *
 * A cast, and a deliberate one: Prisma's generated delegates are generic methods
 * (`<T extends UserFindUniqueArgs>(args: SelectSubset<T, ...>) => ...`), which no
 * hand-written structural interface can be assignable to without also giving up
 * the two concrete argument and result shapes this file relies on. So the
 * narrowing happens here, once, where it can be read and justified -- rather than
 * scattered through every call, or worked around by typing the queries loosely
 * enough that a typo in `select` would type-check.
 */
function asTokenVersionStore(client: PrismaClient): TokenVersionStore {
  return client as unknown as TokenVersionStore;
}

/**
 * The generation currently stored for `userId`, or `null` if there is no such
 * account.
 *
 * A signed token for an account that does not exist must not authenticate. Before
 * revocation existed, one did: it kept working for its remaining lifetime, and
 * `POST /api/auth/ws-ticket` would mint a live collaboration ticket for a subject
 * nothing else could resolve. `null` is a refusal, never a default.
 *
 * One column off the primary key, and deliberately not cached: a cache would turn
 * revocation back into "eventually, once the entry expires", which is the property
 * this exists to remove.
 *
 * Built from `tokenVersionReader(db)` rather than written against `db` directly so
 * that the one implementation is testable. http-server's suites replace this whole
 * module with an in-memory stand-in (see `test-utils/fakeDbModule.ts`), and a
 * function that closed over the module-local `db` could not be handed to that
 * stand-in -- which would leave every suite running its own copy of the revocation
 * arithmetic instead of the real thing.
 */
export function tokenVersionReader(client: TokenVersionStore): TokenVersionReader {
  return async userId => {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    return user?.tokenVersion ?? null;
  };
}

/**
 * Revoke every session token an account has ever been issued, by moving the
 * generation past the one currently stored. Returns the new generation.
 *
 * Prisma renders `increment` as `SET "tokenVersion" = "tokenVersion" + 1` -- a
 * read-modify-write the database performs with the row locked -- so two
 * concurrent logouts produce two distinct generations rather than one. Both
 * outcomes invalidate every previously issued token, so the difference is
 * immaterial; what matters is that the increment is never lost, which a
 * read-then-write in application code would not guarantee.
 *
 * Factory-shaped for the same reason as `tokenVersionReader`, and with the same
 * consequence: the suites exercise this function over fake storage rather than a
 * reimplementation of it.
 */
export function tokenRevoker(client: TokenVersionStore): (userId: string) => Promise<number> {
  return async userId => {
    const user = await client.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return user.tokenVersion;
  };
}

export const loadStoredTokenVersion: TokenVersionReader = tokenVersionReader(
  asTokenVersionStore(db)
);
export const revokeIssuedTokens = tokenRevoker(asTokenVersionStore(db));
