import { describe, expect, it } from 'vitest';

import { buildPoolConfig, type DbEnvironment } from './index';

/**
 * The pool configuration is the code that decides whether this application
 * verifies TLS certificates when it talks to PostgreSQL. It was inline in
 * `createPrismaClient` and evaluated exactly once at module load, so no test
 * could reach it — the package reported **0 of 28 branches covered** while
 * containing the only code in the repo that can turn certificate verification
 * off.
 *
 * `buildPoolConfig` takes the environment as an argument precisely so these
 * branches are reachable. These tests run by default; the two pre-existing
 * suites in this package are both opt-in behind `RUN_DB_INTEGRATION` /
 * `RUN_DB_MIGRATION_TEST`, which is why nothing here did before.
 */

const REMOTE = 'postgresql://user:pw@db.example.com:5432/mydb?sslmode=require';

function env(overrides: Partial<DbEnvironment> = {}): DbEnvironment {
  return {
    DATABASE_URL: REMOTE,
    NODE_ENV: 'production',
    DB_ALLOW_INSECURE_TLS: undefined,
    DB_POOL_SIZE: undefined,
    ...overrides,
  };
}

describe('buildPoolConfig: DATABASE_URL', () => {
  it('throws when DATABASE_URL is absent', () => {
    expect(() => buildPoolConfig(env({ DATABASE_URL: undefined }))).toThrow(
      /DATABASE_URL is not set/
    );
  });

  it('throws on an empty DATABASE_URL rather than building a broken pool', () => {
    expect(() => buildPoolConfig(env({ DATABASE_URL: '' }))).toThrow(/DATABASE_URL is not set/);
  });

  it('parses host, port, credentials and database out of the URL', () => {
    const config = buildPoolConfig(env());
    expect(config.host).toBe('db.example.com');
    expect(config.port).toBe(5432);
    expect(config.user).toBe('user');
    expect(config.password).toBe('pw');
    expect(config.database).toBe('mydb');
  });

  it('defaults to 5432 when the URL carries no port', () => {
    expect(buildPoolConfig(env({ DATABASE_URL: 'postgresql://u:p@host/db' })).port).toBe(5432);
  });

  it('honours an explicit non-default port', () => {
    const config = buildPoolConfig(env({ DATABASE_URL: 'postgresql://u:p@host:6543/db' }));
    expect(config.port).toBe(6543);
  });

  /**
   * Regression guard for a real downgrade that was fixed once already:
   * reconstructing the connection from host/user/password alone drops query
   * parameters, and managed PostgreSQL URLs carry `sslmode` in exactly that
   * place. The full string must therefore survive into the pool config.
   */
  it('preserves the full connection string including sslmode', () => {
    expect(buildPoolConfig(env()).connectionString).toBe(REMOTE);
    expect(buildPoolConfig(env()).connectionString).toContain('sslmode=require');
  });
});

describe('buildPoolConfig: TLS is never disabled in production', () => {
  // The invariant, stated three ways. `ssl: undefined` means "leave pg's default
  // alone", which is certificate verification ON.
  it('leaves verification on for a remote host by default', () => {
    expect(buildPoolConfig(env()).ssl).toBeUndefined();
  });

  it('ignores DB_ALLOW_INSECURE_TLS in production', () => {
    const config = buildPoolConfig(env({ DB_ALLOW_INSECURE_TLS: 'true' }));
    expect(config.ssl).toBeUndefined();
  });

  it('ignores localhost detection in production', () => {
    const config = buildPoolConfig(
      env({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', DB_ALLOW_INSECURE_TLS: 'true' })
    );
    expect(config.ssl).toBeUndefined();
  });
});

describe('buildPoolConfig: development-only escapes', () => {
  it('disables SSL for localhost outside production', () => {
    const config = buildPoolConfig(
      env({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' })
    );
    expect(config.ssl).toBe(false);
  });

  it('disables SSL for a missing NODE_ENV, which is not production', () => {
    // `undefined !== 'production'` is true, so an unset NODE_ENV takes the
    // development path. Pinned because it is the surprising direction.
    const config = buildPoolConfig(
      env({ NODE_ENV: undefined, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' })
    );
    expect(config.ssl).toBe(false);
  });

  it('allows explicitly insecure remote TLS outside production when asked', () => {
    const config = buildPoolConfig(env({ NODE_ENV: 'development', DB_ALLOW_INSECURE_TLS: 'true' }));
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('does not allow insecure remote TLS on the exact string "true" alone', () => {
    expect(
      buildPoolConfig(env({ NODE_ENV: 'development', DB_ALLOW_INSECURE_TLS: 'TRUE' })).ssl
    ).toBeUndefined();
    expect(
      buildPoolConfig(env({ NODE_ENV: 'development', DB_ALLOW_INSECURE_TLS: '1' })).ssl
    ).toBeUndefined();
  });

  it('keeps verification on for a remote host in development without the flag', () => {
    expect(buildPoolConfig(env({ NODE_ENV: 'development' })).ssl).toBeUndefined();
  });

  it('prefers the localhost escape over the insecure-remote one', () => {
    const config = buildPoolConfig(
      env({
        NODE_ENV: 'development',
        DB_ALLOW_INSECURE_TLS: 'true',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      })
    );
    expect(config.ssl).toBe(false);
  });

  it('treats any hostname containing "localhost" as local', () => {
    // Substring, not a suffix or a parse — so this is pinned rather than left
    // to chance, because it decides whether TLS is skipped.
    const config = buildPoolConfig(
      env({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost.evil.test/db' })
    );
    expect(config.ssl).toBe(false);
  });
});

describe('buildPoolConfig: pool size', () => {
  it('defaults to 20', () => {
    expect(buildPoolConfig(env()).max).toBe(20);
  });

  it('honours an explicit size', () => {
    expect(buildPoolConfig(env({ DB_POOL_SIZE: '50' })).max).toBe(50);
  });

  it('falls back to 20 for a zero, because `0 || 20` is 20', () => {
    expect(buildPoolConfig(env({ DB_POOL_SIZE: '0' })).max).toBe(20);
  });

  it('falls back to 20 for unparseable input, because NaN is falsy', () => {
    expect(buildPoolConfig(env({ DB_POOL_SIZE: 'abc' })).max).toBe(20);
  });

  it('clamps a negative size up to 1 rather than passing it to pg', () => {
    expect(buildPoolConfig(env({ DB_POOL_SIZE: '-5' })).max).toBe(1);
  });

  it('sets the timeout pair', () => {
    const config = buildPoolConfig(env());
    expect(config.connectionTimeoutMillis).toBe(5000);
    expect(config.idleTimeoutMillis).toBe(30000);
  });
});
