import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { db, initializeDb } from './index';

/**
 * The client lives on `globalThis`, not in module scope, and this is the test
 * that says why.
 *
 * A bundler may emit more than one instance of a module in a single process, and
 * Next 16 with Turbopack does exactly that for this package: a production
 * `next build` produced three server chunks each carrying its own copy. Because
 * `app/instrumentation.ts` initialised one copy while `lib/server/session.ts`
 * closed over another, that second Proxy threw and **every authenticated Server
 * Component route answered 500 in a real production build** — `/dashboard`,
 * `/dashboard/folders`, `/canvas/[fileId]`, `/file/[id]` — while all 1480 tests
 * passed, because the duplication only exists after bundling.
 *
 * So the regression is simulated rather than reproduced end to end: `vi.resetModules`
 * plus a dynamic import gives a genuinely fresh module instance, which is the
 * same condition a duplicated chunk creates. With a module-level singleton the
 * second instance throws; with `globalThis` it does not.
 *
 * No database is required. `initializeDb` builds a `pg.Pool`, which opens no
 * socket until a query, so the client is constructed and the `db` property
 * reachable without one.
 */

beforeAll(() => {
  // `buildPoolConfig` requires one. Nothing connects: a `pg.Pool` opens no
  // socket until a query, so this value is never dialled. It must be set before
  // the module is first imported, since the client is built on first
  // `initializeDb`.
  process.env.DATABASE_URL ??= 'postgresql://dripl:dripl@127.0.0.1:1/dripl?schema=public';
});

afterEach(() => {
  const holder = globalThis as unknown as { __driplPrismaClient?: unknown };
  delete holder.__driplPrismaClient;
});

describe('db client identity across module instances', () => {
  it('reports not-initialized before initializeDb is called', () => {
    expect(() => db.user).toThrow(/PrismaClient not initialized/);
  });

  it('serves the client to a second, freshly loaded instance of the module', async () => {
    await initializeDb();

    // A second module instance, as a duplicated chunk would be. It shares no
    // module scope with the first — only the process global.
    vi.resetModules();
    const second = (await import('./index')) as typeof import('./index');

    // The whole point: a fresh instance must already see the initialized client
    // rather than throwing, because `initializeDb` ran against a different copy.
    expect(() => second.db.user).not.toThrow();
    expect(typeof second.db.user.findMany).toBe('function');
  });

  it('does not build a second pool when two instances race to initialize', async () => {
    const first = initializeDb();
    vi.resetModules();
    const second = (await import('./index')) as typeof import('./index');
    const other = second.initializeDb();

    const [a, b] = await Promise.all([first, other]);
    expect(a).toBe(b);
  });

  it('returns the same instance on repeated initializeDb calls', async () => {
    const first = await initializeDb();
    const second = await initializeDb();
    expect(first).toBe(second);
  });
});
