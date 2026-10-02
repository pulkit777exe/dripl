# Dripl

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-20-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10.33.0-orange.svg)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-purple.svg)](https://prisma.io)

Real-time collaborative whiteboard with hand-drawn rendering, live cursors, and
shareable links. Turborepo monorepo: a Next.js frontend plus separate Express and
WebSocket servers over PostgreSQL 16. The evidence-weighted parity and security
assessment is [`docs/codebase-audit.md`](docs/codebase-audit.md); it records both
what is verified and what is not. Dripl is not an Excalidraw-compatible or
production-ready clone.

## Requirements

- Node.js 20 (`.nvmrc`; CI pins `node-version: 20`)
- pnpm 10.33.0 (`packageManager` in the root `package.json`)
- PostgreSQL 16 — `docker compose up -d postgres` provides one

## Quick Start

```bash
pnpm install
cp .env.example .env   # then set the required values below
pnpm db:generate       # pnpm dev does this too
pnpm dev
```

`pnpm dev` runs `db:generate`, clears `apps/dripl-app/.next`, then starts all three
services.

## Services

| Workspace     | Runtime              | Development port     |
| ------------- | -------------------- | -------------------- |
| `dripl-app`   | Next.js 16, React 19 | `3000`               |
| `http-server` | Express 5 (REST)     | `3002` (`HTTP_PORT`) |
| `ws-server`   | `ws` (WebSocket)     | `3001` (`WS_PORT`)   |

## Configuration

Copy `.env.example` to `.env`. Each server validates its environment with Zod at
boot (`apps/http-server/src/env.ts`, `apps/ws-server/src/env.ts`) and exits on
failure. `dripl-app` has no env schema: its handlers use `API_SERVER_URL`
server-to-server and `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` in the browser.

| Variable                                   | Required by                  | Notes                                                          |
| ------------------------------------------ | ---------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`                             | both servers                 | PostgreSQL connection string                                   |
| `JWT_SECRET`                               | both servers                 | Minimum 32 characters when `NODE_ENV=production`               |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `http-server`                | Google OAuth                                                   |
| `HTTP_SERVER_URL`                          | `ws-server`                  | Internal http-server URL; never `localhost` inside a container |
| `INTERNAL_SECRET`                          | both servers, in production  | Minimum 32 characters, and must differ from `JWT_SECRET`       |
| `FRONTEND_URL` or `NEXT_PUBLIC_APP_URL`    | `http-server`, in production | Origin allowlist for CORS and share links                      |

Optional: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_URL`,
`API_SERVER_URL`; `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` for
distributed rate limiting and fan-out, with bounded process-local limiters when
absent; `SMTP_USER` and `SMTP_PASS`, both required when mail is sent;
`GEMINI_API_KEY`; `IMAGE_STORAGE_DIR` (default `./uploads/images`); `SENTRY_DSN`;
`TRUST_PROXY`; `DEBUG_PRISMA`; `DB_ALLOW_INSECURE_TLS`; `DB_POOL_SIZE`; `LOG_LEVEL`.
`SMTP_HOST` and `SMTP_PORT`, declared in `render.yaml`, are read by no code.

## Commands

| Command                                       | Purpose                                            |
| --------------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                                    | Generate client, clear `.next`, start all services |
| `pnpm build`                                  | `turbo run build` across all workspaces            |
| `pnpm test` / `pnpm test:coverage`            | `turbo run test` across all workspaces             |
| `pnpm lint` / `pnpm check-types`              | Lint and type-check via Turborepo                  |
| `pnpm boundaries`                             | Enforce package boundaries                         |
| `pnpm format`                                 | Prettier over `**/*.{ts,tsx,md}`                   |
| `pnpm db:generate` / `db:migrate` / `db:push` | Prisma client, dev migrations, schema push         |
| `pnpm benchmark:canvas`, `check:google-oauth` | Headless canvas benchmark; validate Google OAuth   |

Per workspace: `pnpm --filter <name> dev|build|start|test|lint|check-types`;
`dripl-app` adds `test:e2e` (Playwright), both servers add `health` and build with
esbuild (`scripts/bundle-server.mjs`), starting from `dist/index.js`. `pnpm test`
needs no database; the PostgreSQL-backed suites are opt-in:

```bash
RUN_DB_INTEGRATION=true RUN_WS_DB_INTEGRATION=true \
  pnpm --filter http-server --filter ws-server --filter @dripl/db test
```

[`CONTRIBUTING.md`](./CONTRIBUTING.md) covers the test matrix, the boot smoke
against built servers, browser tests, and the pull request flow.

## Local Docker Stack

`docker-compose.yml` builds the three `docker/Dockerfile.*` images on the same ports
as `pnpm dev`, next to a `postgres:16-alpine` service. Compose interpolates the four
variables above with `${VAR:?}` and refuses to load without them.

```bash
export JWT_SECRET=... INTERNAL_SECRET=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
docker compose up -d postgres
pnpm --filter @dripl/db exec prisma migrate deploy
docker compose up --build
```

## Deployment

| Target             | Services                                                   | Configuration                                              |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Vercel             | `dripl-app`                                                | `apps/dripl-app/vercel.json`                               |
| Render             | Both servers as Node web services, `PORT=10000`, `/health` | `render.yaml`                                              |
| Google Cloud Run   | Both servers on 8080                                       | `docker/Dockerfile.cloudrun`, `scripts/deploy-cloudrun.sh` |
| Any container host | All three                                                  | `docker/Dockerfile.*` with `docker-compose.yml`            |

## Features

- **Canvas**: select, hand, rectangle, ellipse, diamond, arrow, line, freehand
  draw, text, image, frame, eraser, laser pointer; multi-select, resize, group,
  alignment; undo/redo bounded to 100 snapshots and a 10 MB budget; zoom and grid
  toggles; light and dark themes. Shortcuts: `apps/dripl-app/lib/canvas/keybindings.ts`.
- **Collaboration**: authenticated WebSocket rooms. The server sends a full
  `sync_room_state` snapshot on join, carrying `protocolEpoch: 2`, then JSON
  `scene-delta` messages for changes, plus cursor, presence, element-lock, viewport,
  and follow messages. Reconnect queues replay only after the room sync is
  acknowledged.
- **Sharing**: Google OAuth, owner-scoped view/edit file capabilities, read-only
  room capability pages, share links, teams, folders, snapshot history.
- **Export**: PNG, SVG, PDF, JSON, and `.excalidraw`
  (`apps/dripl-app/utils/export`). Optional Gemini-backed diagram generation via
  `/api/ai/generate`.

## Known Limitations

- Room state, internal ticket state, and fallback rate-limit counters are
  process-local, so neither server currently scales horizontally (`ADR-002` in
  `AGENTS.md`).
- Collaboration sync is versioned JSON deltas, not a CRDT. Yjs binary sync is
  disabled and convergence is not guaranteed.
- Images are stored on the local filesystem under `IMAGE_STORAGE_DIR`. There is
  no object storage, CDN, or per-image capability revocation.
- WebSocket messages are capped at 200 KB (`MAX_MESSAGE_BYTES`).
- Deployment evidence is partial. The production Docker stack has been built, booted
  healthy, and exercised by the Playwright smoke suite. The `production-e2e` CI job
  repeats those checks on a GitHub runner and completed green on 2026-10-02
  (run 36995255425, commit `2eb0aaa`). The live Render deployment is not observable
  from this repository.

## Documentation and License

[`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DESIGN.md`](./DESIGN.md),
[`PRODUCT.md`](./PRODUCT.md), [`CLAUDE.md`](./CLAUDE.md),
[`CHANGELOG.md`](./CHANGELOG.md),
[`docs/collaboration-crdt-e2ee-decision.md`](docs/collaboration-crdt-e2ee-decision.md).
MIT licensed; see [`LICENSE`](./LICENSE).
