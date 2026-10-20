/**
 * Preflight for the historical `20260118095344_sync_canvas_room_schema`
 * migration.
 *
 * That migration adds `User.password TEXT NOT NULL` without a default. On a
 * database that already applied the initial migration and contains users, the
 * `ALTER TABLE` fails before any later migration can make the column nullable.
 * A clean-install migration test therefore says nothing about that upgrade;
 * this module inspects the live ledger and schema and refuses to let an
 * operator treat `prisma migrate deploy` as a safe path when the hazard is
 * present.
 *
 * It is deliberately read-only. The two reviewed repair procedures live in
 * `docs/database-migration-notes.md`; a preflight that guessed at one would be
 * the "silent rewrite" that document forbids.
 */

export const INITIAL_MIGRATION = '20251130123626_init';
export const LEGACY_PASSWORD_MIGRATION = '20260118095344_sync_canvas_room_schema';

export interface LegacyUpgradeState {
  migrationsTableExists: boolean;
  /** Only finished, non-rolled-back migrations. */
  appliedMigrations: string[];
  userTableExists: boolean;
  passwordColumnExists: boolean;
  userCount: number;
}

export type LegacyUpgradeVerdict =
  | {
      status: 'safe';
      reason:
        'fresh-database' | 'password-migration-applied' | 'no-users-before-password-migration';
      detail: string;
    }
  | {
      status: 'blocked';
      reason: 'populated-before-password-migration' | 'unmanaged-user-table' | 'ledger-drift';
      detail: string;
      remediation: string;
    };

const DRIFT_REMEDIATION =
  'The migration ledger and the live schema disagree. Inspect the history and ' +
  'the actual columns, restore from a Prisma-managed backup, or reconcile with ' +
  '`prisma migrate resolve` only after the schema matches what is recorded. Do ' +
  'not run `prisma migrate deploy` until they agree.';

const POPULATED_REMEDIATION =
  'Take a backup first. Then either apply a reviewed, checksum-compatible ' +
  'repair of `20260118095344_sync_canvas_room_schema` and record the matching ' +
  '`prisma migrate resolve`, or apply the schema changes in a maintenance ' +
  'window and mark the migration applied only after verifying the schema. ' +
  'Exercise the chosen procedure on a disposable copy of production-shaped ' +
  'data before rollout.';

/**
 * Pure verdict over an observed state. Every branch is reachable from a test;
 * the I/O lives in `readLegacyUpgradeState`.
 */
export function classifyLegacyUpgrade(state: LegacyUpgradeState): LegacyUpgradeVerdict {
  const passwordApplied = state.appliedMigrations.includes(LEGACY_PASSWORD_MIGRATION);
  const initialApplied = state.appliedMigrations.includes(INITIAL_MIGRATION);

  if (!state.migrationsTableExists) {
    if (state.userTableExists) {
      return {
        status: 'blocked',
        reason: 'unmanaged-user-table',
        detail:
          'The `User` table exists but `_prisma_migrations` does not. This ' +
          'database was not created by `prisma migrate deploy`.',
        remediation:
          'Baseline the existing schema or restore a Prisma-managed backup ' +
          'before deploying. A deploy now would try to create tables that ' +
          'already exist.',
      };
    }
    return {
      status: 'safe',
      reason: 'fresh-database',
      detail: 'No `_prisma_migrations` ledger and no `User` table; this is a fresh database.',
    };
  }

  if (passwordApplied) {
    if (!state.passwordColumnExists) {
      return {
        status: 'blocked',
        reason: 'ledger-drift',
        detail:
          'The ledger records the password migration as applied, but the ' +
          '`User.password` column is missing.',
        remediation: DRIFT_REMEDIATION,
      };
    }
    return {
      status: 'safe',
      reason: 'password-migration-applied',
      detail: 'The password migration is recorded as applied and the column exists.',
    };
  }

  if (state.passwordColumnExists) {
    return {
      status: 'blocked',
      reason: 'ledger-drift',
      detail:
        'The `User.password` column exists, but the migration that adds it is ' +
        'not recorded as applied.',
      remediation: DRIFT_REMEDIATION,
    };
  }

  if (!initialApplied && state.userTableExists) {
    return {
      status: 'blocked',
      reason: 'ledger-drift',
      detail: 'The `User` table exists, but the initial migration is not recorded ' + 'as applied.',
      remediation: DRIFT_REMEDIATION,
    };
  }

  if (state.userCount > 0) {
    return {
      status: 'blocked',
      reason: 'populated-before-password-migration',
      detail:
        `The initial schema is applied and ${state.userCount} user row(s) exist, ` +
        'but the password migration has not run. Its `ALTER TABLE ... ADD COLUMN ' +
        '"password" TEXT NOT NULL` cannot succeed on a non-empty table.',
      remediation: POPULATED_REMEDIATION,
    };
  }

  return {
    status: 'safe',
    reason: 'no-users-before-password-migration',
    detail:
      'The initial schema is applied but the `User` table is empty; the ' +
      "password migration's `ALTER TABLE` can add the column safely.",
  };
}

/**
 * The only SQL surface this module needs. `pg.Client` satisfies it
 * structurally, and tests provide a queue of rows instead of a database.
 */
export interface Queryable {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Read the state the verdict needs. Four small queries, all read-only, in a
 * fixed order so a failure identifies the stage that failed.
 */
export async function readLegacyUpgradeState(db: Queryable): Promise<LegacyUpgradeState> {
  const ledger = await db.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS exists`
  );
  const migrationsTableExists = ledger.rows[0]?.exists === true;

  let appliedMigrations: string[] = [];
  if (migrationsTableExists) {
    const applied = await db.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY migration_name`
    );
    appliedMigrations = applied.rows
      .map(row => row.migration_name)
      .filter((name): name is string => typeof name === 'string');
  }

  const userTable = await db.query(`SELECT to_regclass('public."User"') IS NOT NULL AS exists`);
  const userTableExists = userTable.rows[0]?.exists === true;

  let passwordColumnExists = false;
  let userCount = 0;
  if (userTableExists) {
    const column = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'password'
       ) AS exists`
    );
    passwordColumnExists = column.rows[0]?.exists === true;

    const count = await db.query(`SELECT count(*)::int AS count FROM "User"`);
    userCount = Number(count.rows[0]?.count ?? 0);
  }

  return {
    migrationsTableExists,
    appliedMigrations,
    userTableExists,
    passwordColumnExists,
    userCount,
  };
}
