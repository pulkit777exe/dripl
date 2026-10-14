# Security Policy

Dripl is an early-beta open-source project (MIT). Only the `main` branch is
supported; there are no LTS releases and no bug bounty.

## Reporting a Vulnerability

**Do not open a public issue** for a suspected vulnerability — public issues
are visible before a fix exists.

Report through
[private vulnerability reporting](https://github.com/pulkit777exe/dripl/security/advisories/new)
for the `pulkit777exe/dripl` repository
(GitHub → Security tab → Report a vulnerability).
If that form is unavailable, open a minimal issue that describes the impact
without exploit details and ask for a private channel.

Please include:

- Affected component (`apps/*`, `packages/*`) and commit or version
- Steps to reproduce or a minimal proof of concept
- Impact assessment (what an attacker gains, and prerequisites)
- Never include real credentials, tokens, or production data

## Response

Reports are triaged on a best-effort basis by the maintainers; there is no
SLA. Valid reports are fixed on `main` and disclosed after a fix is
available. Credit is given on request.

## Scope Notes

- `http-server` and `ws-server` validate `JWT_SECRET` / `INTERNAL_SECRET` at
  boot and refuse weak or equal values in production (`*/src/env.ts`).
- Known transport limits (200 KB WebSocket cap, versioned JSON deltas, no
  CRDT convergence) are documented in `README.md` and
  `docs/collaboration-crdt-e2ee-decision.md` — they are design constraints,
  not vulnerabilities.
- Supply-chain posture (audit results, license scan) is recorded in
  [`docs/dependencies.md`](docs/dependencies.md).
