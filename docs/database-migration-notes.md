# Database migration notes

**Audit date:** 2026-09-25

> **Provenance:** The clean-install results below are recorded from the prior
> audit run. The documentation-inventory pass did not rerun PostgreSQL,
> migrations, or service tests; this note is not fresh runtime verification.

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
