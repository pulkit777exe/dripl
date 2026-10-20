import { describe, expect, it } from 'vitest';
import {
  INITIAL_MIGRATION,
  LEGACY_PASSWORD_MIGRATION,
  classifyLegacyUpgrade,
  readLegacyUpgradeState,
  type LegacyUpgradeState,
  type Queryable,
} from './legacyUpgrade';

const safeState: LegacyUpgradeState = {
  migrationsTableExists: true,
  appliedMigrations: [INITIAL_MIGRATION],
  userTableExists: true,
  passwordColumnExists: false,
  userCount: 0,
};

describe('classifyLegacyUpgrade', () => {
  it('passes a fresh database with no ledger and no User table', () => {
    const verdict = classifyLegacyUpgrade({
      migrationsTableExists: false,
      appliedMigrations: [],
      userTableExists: false,
      passwordColumnExists: false,
      userCount: 0,
    });
    expect(verdict).toMatchObject({ status: 'safe', reason: 'fresh-database' });
  });

  it('blocks an existing User table with no Prisma ledger', () => {
    const verdict = classifyLegacyUpgrade({
      migrationsTableExists: false,
      appliedMigrations: [],
      userTableExists: true,
      passwordColumnExists: false,
      userCount: 0,
    });
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'unmanaged-user-table' });
  });

  it('passes when the password migration is recorded and the column exists', () => {
    const verdict = classifyLegacyUpgrade({
      ...safeState,
      appliedMigrations: [INITIAL_MIGRATION, LEGACY_PASSWORD_MIGRATION],
      passwordColumnExists: true,
      userCount: 42,
    });
    expect(verdict).toMatchObject({
      status: 'safe',
      reason: 'password-migration-applied',
    });
  });

  it('blocks when the ledger records the password migration but the column is missing', () => {
    const verdict = classifyLegacyUpgrade({
      ...safeState,
      appliedMigrations: [INITIAL_MIGRATION, LEGACY_PASSWORD_MIGRATION],
      passwordColumnExists: false,
    });
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'ledger-drift' });
  });

  it('blocks when the password column exists but the migration is not recorded', () => {
    const verdict = classifyLegacyUpgrade({ ...safeState, passwordColumnExists: true });
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'ledger-drift' });
  });

  it('blocks a User table with no recorded initial migration', () => {
    const verdict = classifyLegacyUpgrade({ ...safeState, appliedMigrations: [] });
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'ledger-drift' });
  });

  it('blocks a populated pre-password database and names the row count', () => {
    const verdict = classifyLegacyUpgrade({ ...safeState, userCount: 7 });
    expect(verdict).toMatchObject({
      status: 'blocked',
      reason: 'populated-before-password-migration',
    });
    if (verdict.status !== 'blocked') throw new Error('expected blocked');
    expect(verdict.detail).toContain('7 user row(s)');
    expect(verdict.remediation).toContain('backup');
  });

  it('passes an empty pre-password database because the ALTER TABLE is safe', () => {
    const verdict = classifyLegacyUpgrade({ ...safeState, userCount: 0 });
    expect(verdict).toMatchObject({
      status: 'safe',
      reason: 'no-users-before-password-migration',
    });
  });
});

describe('readLegacyUpgradeState', () => {
  function queued(rows: Array<Array<Record<string, unknown>>>): {
    db: Queryable;
    calls: string[];
  } {
    const calls: string[] = [];
    let index = 0;
    return {
      calls,
      db: {
        async query(text) {
          calls.push(text);
          return { rows: rows[index++] ?? [] };
        },
      },
    };
  }

  it('reads the ledger, schema and row count in a fixed order', async () => {
    const { db, calls } = queued([
      [{ exists: true }],
      [{ migration_name: INITIAL_MIGRATION }],
      [{ exists: true }],
      [{ exists: false }],
      [{ count: 7 }],
    ]);

    const state = await readLegacyUpgradeState(db);

    expect(state).toEqual({
      migrationsTableExists: true,
      appliedMigrations: [INITIAL_MIGRATION],
      userTableExists: true,
      passwordColumnExists: false,
      userCount: 7,
    });
    expect(calls[0]).toContain('_prisma_migrations');
    expect(calls[1]).toContain('migration_name');
    expect(calls[2]).toContain('to_regclass');
    expect(calls[3]).toContain('information_schema.columns');
    expect(calls[4]).toContain('count(*)');
  });

  it('stops after the two existence probes on a fresh database', async () => {
    const { db, calls } = queued([[{ exists: false }], [{ exists: false }]]);

    const state = await readLegacyUpgradeState(db);

    expect(state).toEqual({
      migrationsTableExists: false,
      appliedMigrations: [],
      userTableExists: false,
      passwordColumnExists: false,
      userCount: 0,
    });
    expect(calls).toHaveLength(2);
  });

  it('drops non-string migration names instead of trusting the ledger shape', async () => {
    const { db } = queued([
      [{ exists: true }],
      [{ migration_name: INITIAL_MIGRATION }, { migration_name: 42 }, {}],
      [{ exists: false }],
    ]);

    const state = await readLegacyUpgradeState(db);

    expect(state.appliedMigrations).toEqual([INITIAL_MIGRATION]);
  });
});
