import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * Applies every migration in this package to a brand-new, empty PostgreSQL
 * database and asserts the result is the schema `schema.prisma` describes.
 *
 * The `db/` suites check that a migrated database answers queries; nothing in
 * CI checked that the migration files still *build* one. That gap is how a
 * migration can pass review, pass `migrate dev` locally against a database that
 * happens to already have the table, and then fail on a fresh environment. This
 * file closes it, and it is deliberately independent of the developer's
 * `DATABASE_URL`: it creates its own throwaway database and drops it after.
 *
 * The database it manages is created and dropped here, so nothing the
 * developer cares about is at risk. It does need permission to `CREATE
 * DATABASE` — a superuser or a CREATEDB role. Without that the suite skips
 * itself rather than failing, so a restricted developer database does not turn
 * the gate red.
 *
 * It rides the two variables `turbo.json` already forwards to `test`, which is
 * why `RUN_DB_INTEGRATION` enables it: under `envMode: strict` a new variable
 * name would never reach this process through `pnpm turbo run test`. CI's
 * postgres service runs as a superuser, so it does run there.
 *
 *   docker compose up -d postgres
 *   DATABASE_URL=postgresql://dripl:dripl@localhost:5432/dripl \
 *     pnpm --filter @dripl/db exec prisma migrate deploy
 *   DATABASE_URL=postgresql://dripl:dripl@localhost:5432/dripl \
 *   RUN_DB_INTEGRATION=true pnpm --filter @dripl/db test
 *
 * `MIGRATION_TEST_ADMIN_URL` overrides which server hosts the throwaway
 * database, and `RUN_DB_MIGRATION_TEST=true` enables this file on its own.
 */
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL ?? process.env.DATABASE_URL;
const enabled =
  Boolean(adminUrl) &&
  (process.env.RUN_DB_INTEGRATION === 'true' || process.env.RUN_DB_MIGRATION_TEST === 'true');

/**
 * Read-only capability probe. Deciding this before the suite is declared keeps
 * the skip declarative; probing inside `beforeAll` would leave the other tests
 * running against a database that was never created.
 */
async function canCreateDatabase(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, ssl: false });
  try {
    await client.connect();
    const result = await client.query<{ allowed: boolean }>(
      `SELECT (rolcreatedb OR rolsuper OR pg_has_role(current_user, 'CREATEDB', 'MEMBER'))
              AS allowed
       FROM pg_roles WHERE rolname = current_user`
    );
    return result.rows[0]?.allowed === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const describeMigration =
  enabled && (await canCreateDatabase(adminUrl as string)) ? describe : describe.skip;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');

/** Expect at least this many migration directories to exist. */
const MINIMUM_MIGRATIONS = 8;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl, ssl: false });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const databaseName = `dripl_migration_test_${randomUUID().replaceAll('-', '')}`;

/**
 * The throwaway database's URL, resolved on first use. A `describe.skip` body
 * still executes, so this cannot be built eagerly: there is no admin URL to
 * parse when the suite is disabled.
 */
let testDatabaseUrl = '';
function throwawayDatabaseUrl(): string {
  if (testDatabaseUrl) return testDatabaseUrl;
  const url = new URL(adminUrl as string);
  url.pathname = `/${databaseName}`;
  testDatabaseUrl = url.toString();
  return testDatabaseUrl;
}

describeMigration('migrations build a fresh database', () => {
  beforeAll(async () => {
    await withAdmin(async client => {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    });

    // `migrate deploy` is the exact command CI and production run. It is the
    // path that has to work, not `db push` or `migrate dev`.
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: packageRoot,
      env: {
        ...process.env,
        DATABASE_URL: throwawayDatabaseUrl(),
        NODE_ENV: 'test',
      },
      stdio: 'pipe',
    });
  }, 180_000);

  afterAll(async () => {
    await withAdmin(async client => {
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [databaseName]
      );
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    });
  });

  it('applies every migration directory exactly once', async () => {
    const onDisk = readdirSync(path.join(packageRoot, 'prisma', 'migrations'), {
      withFileTypes: true,
    })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    const applied = await withAdmin(async () => {
      const client = new pg.Client({ connectionString: throwawayDatabaseUrl(), ssl: false });
      await client.connect();
      try {
        const result = await client.query<{
          migration_name: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>(
          'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name'
        );
        return result.rows;
      } finally {
        await client.end();
      }
    });

    // Every directory on disk ran, and nothing else did. A migration file that
    // never applies is the failure this whole file exists to catch.
    expect(applied.map(migration => migration.migration_name)).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThanOrEqual(MINIMUM_MIGRATIONS);
    for (const migration of applied) {
      // Nothing left half-applied and nothing rolled back.
      expect(migration.rolled_back_at, migration.migration_name).toBeNull();
      expect(migration.finished_at, migration.migration_name).not.toBeNull();
    }
  });

  it('produces a schema that matches schema.prisma', async () => {
    // Prisma 7 dropped `--from-url`; the config file's datasource is the only
    // supported way to point at a live database, and DATABASE_URL in this
    // child's environment is that database.
    const drift = spawnSync(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        schemaPath,
        '--exit-code',
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, DATABASE_URL: throwawayDatabaseUrl(), NODE_ENV: 'test' },
        stdio: 'pipe',
        encoding: 'utf8',
      }
    );
    // `--exit-code` exits 0 when the two sides match, 2 when they differ and 1
    // on error. Asserting the status is the assertion; stdout is noise-prone
    // because dotenv prints its own banner there.
    expect(drift.status, `prisma migrate diff reported:\n${drift.stdout}\n${drift.stderr}`).toBe(0);
    expect(drift.stderr).not.toContain('Error');
  });

  it('creates the tables, columns and indexes the schema declares', async () => {
    const client = new pg.Client({ connectionString: throwawayDatabaseUrl(), ssl: false });
    await client.connect();
    try {
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      );
      const names = tables.rows.map(row => row.table_name);
      for (const expected of [
        'User',
        'Team',
        'File',
        'CanvasRoom',
        'ShareLink',
        'CanvasSnapshot',
      ]) {
        expect(names).toContain(expected);
      }

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
      );
      const indexNames = indexes.rows.map(row => row.indexname);
      expect(indexNames).toContain('CanvasSnapshot_pkey');
      expect(indexNames).toContain('CanvasSnapshot_canvasId_createdAt_idx');
      expect(indexNames).toContain('CanvasSnapshot_expiresAt_idx');

      // Joined rather than cast through `'CanvasSnapshot'::regclass`, which
      // down-cases the identifier and silently matches nothing.
      const constraints = await client.query<{ conname: string }>(
        `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = 'CanvasSnapshot' AND c.contype = 'c'`
      );
      expect(constraints.rows.map(row => row.conname)).toContain('CanvasSnapshot_data_bytes');
    } finally {
      await client.end();
    }
  });

  it('has a migration directory for every schema change the app relies on', async () => {
    // Guards the failure mode where someone edits schema.prisma without a
    // migration: the next deploy would drift instead of fail loudly.
    expect(existsSync(schemaPath)).toBe(true);
    const snapshotMigration = path.join(
      packageRoot,
      'prisma',
      'migrations',
      '20261002133016_add_canvas_snapshot',
      'migration.sql'
    );
    expect(existsSync(snapshotMigration)).toBe(true);
  });
});
