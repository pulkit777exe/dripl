# Database migration notes

**Audit date:** 2026-09-25

> **Provenance:** The clean-install results below are recorded from the prior
> audit run. The documentation-inventory pass did not rerun PostgreSQL,
> migrations, or service tests; this note is not fresh runtime verification.
>
> **2026-10-21:** the legacy preflight and maintenance-window repair were
> verified locally against disposable PostgreSQL 16 databases, and the repair
> rehearsal is part of the opt-in CI integration suite. The clean-install
> figures above remain the 2026-09-25 record.

## Verified path

A disposable PostgreSQL 16 database successfully applied all seven migrations
from empty, reported an up-to-date migration ledger, and passed the database
smoke test plus the opt-in HTTP service tests. The four indexes declared in
`schema.prisma` that were missing from the historical chain are supplied by
`20260925000000_add_declared_indexes`.

This verifies a clean install, not an upgrade of every historical production
state.

## Legacy password migration caveat

The historical `20260118095344_sync_canvas_room_schema` migration adds
`User.password` as `TEXT NOT NULL` without a default. A database that already
has the initial migration and contains users can fail before a later migration
can make the column nullable. Do not silently rewrite an already-applied
migration or claim that `prisma migrate deploy` is a zero-downtime upgrade
path.

Before upgrading such a database, take a backup and use a reviewed operational
procedure appropriate to the deployment. The procedure must either:

1. apply an explicitly reviewed, checksum-compatible repair of the historical
   migration and record the corresponding Prisma migration resolution; or
2. manually apply the schema changes in a maintenance window and record the
   migration as applied only after verifying the resulting schema.

The exact choice depends on the database's migration ledger and backup/restore
process. It must be exercised on a disposable copy of the production-shaped
data before rollout.

### Preflight

The detector is `packages/db/src/legacyUpgrade.ts`; the operator entry point is:

```bash
DATABASE_URL=postgresql://... pnpm --filter @dripl/db db:preflight
# machine-readable:
DATABASE_URL=postgresql://... pnpm --filter @dripl/db db:preflight -- --json
```

It connects directly with `pg` (it does not read `.env`) and runs read-only
queries: whether `_prisma_migrations` and `User` exist, the finished and
non-rolled-back ledger entries, whether `User.password` exists, and the `User`
row count. It never writes, repairs, or resolves a migration.

| Exit | Meaning                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | No legacy-data hazard: fresh database, password migration already applied, or `User` is empty so the `ALTER TABLE` is safe.                                              |
| 1    | Blocked: the populated pre-password state, a `User` table with no Prisma ledger, or ledger/schema drift. Follow the reviewed procedure above on a backup; do not deploy. |
| 2    | The check itself could not run (missing `DATABASE_URL`, connection or query error).                                                                                      |

CI (`RUN_DB_INTEGRATION=true`) seeds a throwaway database with only the initial
migration and a populated `User` table, asserts the verdict is `blocked`, and
asserts that the real `prisma migrate deploy` still fails on it. A separate
rehearsal starts from that failed ledger state and proves the maintenance-window
repair below; the preflight itself remains read-only.

### Maintenance-window repair (rehearsed)

The CI integration suite rehearses option 2 from the incident state: the
historical deploy has already failed, the failed migration row exists, and 25
users plus 25 files are present. The procedure exercised is:

1. Take a backup and stop writes to the database.
2. Confirm the failed attempt left no partial schema. Prisma wraps each
   migration in a transaction on PostgreSQL, so it should have rolled back, but
   inspect before proceeding.
3. Apply the historical migration's schema changes with the password column
   nullable. Do **not** edit the migration file in this repository; take its SQL
   and change only the failing statement:

   ```sql
   -- from
   ALTER TABLE "User" ADD COLUMN     "password" TEXT NOT NULL;
   -- to
   ALTER TABLE "User" ADD COLUMN     "password" TEXT;
   ```

   The next migration (`20260415133904_added_dburl_indexes`) drops `NOT NULL`
   anyway, so this produces the schema the chain ends at. Run the file's other
   statements in the same transaction.

4. Record the historical migration as applied, which also resolves the failed
   ledger row:

   ```bash
   pnpm exec prisma migrate resolve --applied 20260118095344_sync_canvas_room_schema
   ```

5. Finish the chain and verify it is current:

   ```bash
   pnpm exec prisma migrate deploy
   pnpm exec prisma migrate status
   ```

6. Verify `information_schema.columns` reports `password` as nullable and that
   row counts in the preserved tables match the backup, then resume writes.

The test asserts the final schema, preservation of the seeded rows, a clean
migration status, and a `safe` preflight verdict. It does not substitute for a
rehearsal on production-shaped data: the synthetic seed is small, and the real
backup/restore and write-quiesce procedure still has to be exercised before
rollout. Do not use this recipe on a database whose ledger does not match the
state described above; run `db:preflight` first and reconcile any drift.
