import pg from 'pg';
import {
  classifyLegacyUpgrade,
  readLegacyUpgradeState,
  type LegacyUpgradeState,
} from '../src/legacyUpgrade';

/**
 * Read-only preflight for the historical non-null `User.password` migration.
 *
 * Exit codes are part of the operator contract:
 *   0 — the upgrade has no legacy-data hazard (fresh DB, column already added,
 *       or the table is empty so the `ALTER TABLE` is safe)
 *   1 — blocked: populated pre-password database, unmanaged schema, or drift
 *   2 — the preflight itself could not run (missing URL, connection/query error)
 *
 * Never writes. The repair procedures are reviewed and manual; see
 * `docs/database-migration-notes.md`.
 */

function targetLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(none)';
    return `${parsed.hostname}:${parsed.port || '5432'}/${database}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

function describeState(state: LegacyUpgradeState): string[] {
  const ledger = state.migrationsTableExists
    ? `present (${state.appliedMigrations.length} applied)`
    : 'missing';
  const schema = state.userTableExists
    ? `User table present (${state.userCount} user row(s)), password column ${
        state.passwordColumnExists ? 'present' : 'absent'
      }`
    : 'User table absent';
  return [`Ledger: ${ledger}`, `Schema: ${schema}`];
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is required. Point it at the database you are about to upgrade; the preflight does not read .env files.'
    );
    return 2;
  }

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const state = await readLegacyUpgradeState(client);
    const verdict = classifyLegacyUpgrade(state);

    if (process.argv.includes('--json')) {
      emit(JSON.stringify({ target: targetLabel(url), state, verdict }, null, 2));
    } else {
      emit('Legacy password-migration preflight');
      emit(`Target: ${targetLabel(url)}`);
      for (const line of describeState(state)) emit(line);
      emit(`Verdict: ${verdict.status.toUpperCase()} (${verdict.reason})`);
      emit(`Detail: ${verdict.detail}`);
      if (verdict.status === 'blocked') {
        emit(`Remediation: ${verdict.remediation}`);
      }
    }

    return verdict.status === 'safe' ? 0 : 1;
  } catch (error) {
    console.error(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

process.exitCode = await main();
