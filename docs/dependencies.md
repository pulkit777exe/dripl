# Dependency Management

> This is a workflow guide, not a generated dependency inventory. Use the
> workspace manifests and `pnpm-lock.yaml` as the source of truth for versions
> and scripts; do not copy `latest` ranges into new packages.

## Overview

This project uses pnpm workspaces with Turborepo. Dependencies are managed at the package level, not the root.

## Install Where Used

Always install dependencies in the package that needs them:

```bash
# Good
pnpm add lodash --filter=@dripl/utils
pnpm add react --filter=dripl-app

# Avoid
pnpm add lodash -w  # Only for repo-level tools
```

## Root Dependencies

Root-level `devDependencies` are reserved for repo-wide tooling and scripts;
the exact list is maintained in the root `package.json`. Typical examples are
`turbo`, `prisma`, `prettier`, `tsx`, ESLint, TypeScript, and the workspace
test/type-check tools. Do not add app- or package-specific libraries at the
root.

## Internal Dependencies

Use `workspace:*` protocol:

```json
"dependencies": {
  "@dripl/common": "workspace:*"
}
```

## Build Dependencies

Dependencies needed only for building should be in `devDependencies`:

```json
"devDependencies": {
  "@dripl/typescript-config": "workspace:*",
  "typescript": "^5.9.3"
}
```

## Workspace Scripts

Root-level convenience scripts:

```bash
pnpm run build      # Build all packages
pnpm run dev       # Run all apps in dev mode
pnpm run lint      # Lint all packages
pnpm run test      # Run all tests
```

## Supply-Chain Snapshot

Evidence, not policy. Re-run with `pnpm audit --prod --json` and
`pnpm licenses list --prod --json`; do not hand-edit the numbers below.

Snapshot date: 2026-10-14. 827 production dependencies.

### Vulnerability audit

`pnpm audit --prod`: 8 advisories (4 high, 4 moderate, 0 critical).

| Advisory                                                                                   | Reachability                                                                                                                                | Why no upgrade                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `deepmerge-ts` stack exhaustion (GHSA-ggr8-5vv4-36mx, via `prisma > @prisma/config`)       | Transitive dev/build chain of `@prisma/client`; trigger needs recursive object graphs, which plain JSON sync payloads cannot express        | Upstream fix is a major (`v8.0.0`); moves with the `prisma` group in `renovate.json`, not ad hoc                                  |
| `mysql2` auth-plugin downgrade + zlib decompression bomb (2 advisories, via `prisma`)      | Transitive of `prisma` CLI; the repo connects to PostgreSQL only (`@prisma/adapter-pg`, `pg`), so the MySQL protocol handler is unreachable | Same as above — rides the `prisma` renovate group                                                                                 |
| `nodemailer` address-parser / DNS-cache issues (5 advisories, direct dep of `http-server`) | Reachable only through the SMTP mail path (`SMTP_USER` + `SMTP_PASS` both set); no mail is sent in default or test deployments              | Parser DoS hardening belongs upstream; upgrading `nodemailer` alone is deferred to its renovate grouping rather than a blind bump |

### License scan

`pnpm licenses list --prod`: 501 MIT, 57 Apache-2.0, 43 ISC, plus BSD/BlueOak/Unlicense.
No GPL/AGPL anywhere. Remaining non-permissive entries, all low-risk:

| License               | Package                                              | Why acceptable                                                                      |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MPL-2.0 (file-level)  | `lightningcss` (via `tailwindcss`)                   | Build-time CSS minifier, not shipped; file-level copyleft does not propagate        |
| MPL-2.0 OR Apache-2.0 | `dompurify`                                          | Dual-licensed; used under Apache-2.0                                                |
| LGPL-3.0-or-later     | `@img/sharp-libvips-*` (prebuilt binary via `sharp`) | Dynamically linked image codecs, standard practice; no static linking into app code |
| EPL-2.0               | `elkjs` (via `prisma > @prisma/studio-core`)         | Dev-only Studio dependency, not in the shipped servers                              |
| FSL-1.1-MIT           | `@sentry/cli`                                        | Build-time uploader, converts to MIT over time                                      |
| CC-BY-4.0             | `caniuse-lite`                                       | Data tables; attribution satisfied by the package's own notice                      |
| Python-2.0            | `argparse`                                           | Ancient permissive license, deep transitive                                         |

`roughjs` (canvas rendering core) is noted as slow-release upstream
(maintenance mode, single maintainer). It is pinned via `pnpm-lock.yaml` and
covered by determinism tests in `@dripl/element`; replacement would be a
rewrite of the rendering aesthetic, not a supply-chain fix.

### Automation coverage

`renovate.json` groups `prisma`, `typescript`, `react`, and `next` (no
automerge) and automerges minor/patch for the rest. CI (`ci.yml`) installs
with `--frozen-lockfile` and runs lint, boundaries, build, test, type-check,
and production-stack E2E. The weekly advisory scan lives in `audit.yml`
(schedule plus `workflow_dispatch`, `continue-on-error: true` so it never
blocks merges): one job runs `pnpm audit --prod`, and a second job runs
`pnpm sbom` (`scripts/sbom.mjs`, stdlib only) and uploads the CycloneDX-ish
`sbom.json` as a workflow artifact. Regenerate locally with `pnpm sbom`.
There is still no build provenance attestation; see the appendix below.

## Appendix: Build provenance

No SLSA provenance or build attestation is produced today. Release images are
built with `docker compose build` (locally or in CI) and pushed without
signed provenance, and neither `ci.yml` nor `audit.yml` attaches anything
verifiable to the artifacts they produce — the uploaded `sbom.json` is an
inventory of what is shipped, not a claim about how it was built.

Enabling GitHub artifact attestations would need no code changes, only
maintainer action: grant the workflow `id-token: write` permission, add an
attestation step for the SBOM/container artifact, and verify with
`gh attestation verify`. That step is deliberately not added here — it needs
repo-level permission approval to verify end to end, so it remains manual.
