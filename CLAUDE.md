# Dripl — Monorepo Guide for AI Assistants

This is the **root-level guide** for the Dripl monorepo. Read this first before touching any code.

---

## What Is Dripl?

Dripl is a real-time collaborative canvas application: an infinite hand-drawn whiteboard with live cursors and shareable links. It consists of three deployable apps and six shared library packages, plus two tooling packages, all managed in a Turborepo monorepo.

---

## Package Manager

> **Use `pnpm` for all package management operations.**

```bash
pnpm install                         # Install all workspace deps
pnpm add <pkg> --filter=<workspace>  # Add dep to a specific package
pnpm run <script>                    # Run a root script
```

The workspace is declared in `pnpm-workspace.yaml`. Lock file: `pnpm-lock.yaml`. A legacy `bun.lock` may exist but is not actively used.

---

## Repository Layout

```
dripl/
├── CLAUDE.md                    # Root monorepo guide (read first)
├── AGENTS.md                    # Agent configuration & domain terminology
├── TODOS.md                     # Historical engineering roadmap; current overlay near top
├── Problems.md                  # Historical security report; current reconciliation at top
├── DESIGN.md                    # Visual design system
├── PRODUCT.md                   # Product definition
├── CHANGELOG.md                 # Version history
├── CONTRIBUTING.md              # Contributor guidelines
├── apps/
│   ├── dripl-app/        # Next.js 16 frontend (port 3000)
│   ├── http-server/      # Express 5 REST API (port 3002)
│   └── ws-server/        # WebSocket collaboration server (port 3001)
├── packages/
│   ├── common/           # @dripl/common  — shared types, Zod schemas
│   ├── db/               # @dripl/db      — Prisma ORM client + migrations
│   ├── element/          # @dripl/element — element factory & rendering
│   ├── math/             # @dripl/math    — geometry & intersection utils
│   ├── utils/            # @dripl/utils   — encryption, storage, throttle
│   └── test-utils/       # @dripl/test-utils — shared test factories
├── tooling/
│   ├── eslint-config/    # @dripl/eslint-config  — shared ESLint rules
│   └── typescript-config/# @dripl/typescript-config — shared tsconfigs
├── turbo.json            # Turborepo task pipeline
└── pnpm-workspace.yaml   # Workspace glob patterns
```

### Dependency Graph (simplified)

```
dripl-app ──► @dripl/common
           ──► @dripl/db
           ──► @dripl/element ──► @dripl/common, @dripl/math, @dripl/utils
           ──► @dripl/math    ──► @dripl/common
           ──► @dripl/utils   ──► @dripl/common

http-server ──► @dripl/common, @dripl/db, @dripl/utils
ws-server   ──► @dripl/common, @dripl/db, @dripl/utils

@dripl/test-utils ──► @dripl/common (dev: @dripl/eslint-config, @dripl/typescript-config)
```

**No circular dependencies.** Apps never depend on other apps.

---

## Turborepo Task Pipeline

| Task          | Runs in      | DependsOn             | Cached?            |
| ------------- | ------------ | --------------------- | ------------------ |
| `build`       | All packages | `^build` (deps first) | ✅ Yes             |
| `dev`         | All apps     | `^build`              | ❌ No (persistent) |
| `lint`        | All packages | `transit`             | ✅ Yes             |
| `test`        | All packages | `^build`, `build`     | ✅ Yes             |
| `check-types` | All packages | `transit`             | ✅ Yes             |
| `transit`     | All packages | `^transit`            | ✅ Yes             |

The `transit` task is a dependency-ordering shim that allows `lint` and `check-types` to run in parallel while respecting package build order.

### Turbo Boundary Tags

Packages are tagged to enforce architectural boundaries:

| Tag          | Applied To                           | Cannot depend on |
| ------------ | ------------------------------------ | ---------------- |
| `app:web`    | `dripl-app`                          | other apps       |
| `app:server` | `http-server`, `ws-server`           | other apps       |
| `pkg:core`   | `common`, `element`, `math`, `utils` | apps             |
| `pkg:data`   | `db`                                 | apps, `pkg:core` |

Run `pnpm boundaries` / `turbo boundaries` to verify.

---

## Root Scripts

```bash
pnpm dev          # Generate Prisma client, clear .next cache, then start all dev servers
pnpm build        # Build all packages in dependency order
pnpm lint         # Lint all packages in parallel
pnpm check-types  # Type-check all packages in parallel
pnpm test         # Run all test suites
pnpm format       # Prettier over all .ts/.tsx/.md files
pnpm db:generate  # prisma generate (root schema)
pnpm db:migrate   # prisma migrate dev (root schema)
pnpm db:push      # prisma db push (root schema)
pnpm boundaries   # Validate package boundary tags
```

---

## Package Compilation Strategy

All packages in `packages/` use the **compiled** strategy:

- **Source**: `src/`
- **Output**: `dist/` (produced by `tsc -b --force`)
- **Exports**: `dist/index.js` + `dist/index.d.ts`

The `dist/` output is listed in `turbo.json` `outputs: ["dist/**"]` so Turborepo can cache and restore builds.

> **Never import from `src/` across package boundaries.** Always import from the package name (e.g., `import { Foo } from '@dripl/common'`).

---

## TypeScript Configuration

Shared configs live in `tooling/typescript-config/`. Each package extends one of:

| Config file          | Used by                                        |
| -------------------- | ---------------------------------------------- |
| `base.json`          | Node/server packages                           |
| `nextjs.json`        | `dripl-app`                                    |
| `react-library.json` | Reserved for a future standalone React package |
| `tsconfig.json`      | Generic fallback                               |

The root `tsconfig.json` is a solution-style project reference file. Keep package-specific compiler options in each package's `tsconfig.json`; the root file also owns only the shared incremental build metadata.

---

## ESLint

Shared rules live in `tooling/eslint-config/` (`@dripl/eslint-config`). Each app/package has its own `eslint.config.mjs` that extends this.

---

## Environment Variables

A single root `.env` file is used at development time. All apps load it via:

```bash
dotenv -e ../../.env -- <command>    # http-server, ws-server
```

`dripl-app` reads it natively through Next.js.

| Variable                   | Used By                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`             | `@dripl/db`, `http-server`, `ws-server`                                              |
| `JWT_SECRET`               | `http-server` (signs session JWTs), `ws-server` (must differ from `INTERNAL_SECRET`) |
| `GEMINI_API_KEY`           | `dripl-app`                                                                          |
| `GOOGLE_CLIENT_ID`         | `http-server`                                                                        |
| `GOOGLE_CLIENT_SECRET`     | `http-server`                                                                        |
| `HTTP_SERVER_URL`          | `ws-server` (internal HTTP calls), `dripl-app` (Google OAuth callback)               |
| `UPSTASH_REDIS_REST_URL`   | `ws-server` (pub/sub for multi-instance fan-out)                                     |
| `UPSTASH_REDIS_REST_TOKEN` | `ws-server` (pub/sub auth)                                                           |
| `NEXT_PUBLIC_*`            | `dripl-app` (client-side)                                                            |
| `FRONTEND_URL`             | `http-server`, `ws-server` (CORS origins)                                            |
| `INTERNAL_SECRET`          | `http-server`, `ws-server` (server-to-server auth)                                   |
| `HTTP_PORT`                | `http-server` (default 3002)                                                         |
| `WS_PORT`                  | `ws-server` (default 3001)                                                           |
| `SMTP_USER` / `SMTP_PASS`  | `http-server`                                                                        |

See `.env.example` and the app-specific guides for the current environment variables.

---

## Adding a New Shared Package

1. Create `packages/<name>/`
2. Add `package.json` with `"name": "@dripl/<name>"`, proper `exports`, and `"build": "tsc -b --force"`
3. Add `tsconfig.json` extending `@dripl/typescript-config/base.json`
4. Add the package to root `tsconfig.json` `references`
5. Add the workspace dep to consuming packages: `"@dripl/<name>": "workspace:*"`
6. Run `pnpm install` to update the lockfile

---

## Adding a New App

1. Create `apps/<name>/`
2. Add `package.json` with `"private": true`
3. Add `turbo.json` with `"extends": ["//"]` and the appropriate `tags`
4. Do **not** add the app to root `tsconfig.json` references unless you need cross-IDE navigation

---

## Key Conventions

- **Never install deps at root** unless they are repo-level tools (`turbo`, `prettier`, `prisma`, `husky`, etc.)
- **`workspace:*`** for all internal package deps (pnpm protocol)
- **Conventional Commits** enforced by `commitlint.config.js` — run `pnpm commitlint` locally before pushing
- **`private: true`** on every package/app — nothing in this repo is published to npm
- **No barrel files** in packages — use granular `exports` in `package.json` instead. This remains an aspiration: `common`, `db`, `utils`, and `test-utils` still expose root `index.ts` files, while other packages have moved toward subpath exports (see TODOS #18/#48).
- **Server logging convention:** use structured JSON for new server logs; a few legacy/utility plain `console` calls remain and are tracked as cleanup, so this is not a claim of uniform compliance.

---

## Running Everything Locally

```bash
# 1. Copy env
cp .env.example .env && vi .env   # fill in real values

# 2. Install
pnpm install

# 3. Migrate DB
pnpm db:migrate

# 4. Start all services
pnpm dev
# → dripl-app  on http://localhost:3000
# → http-server on http://localhost:3002
# → ws-server  on http://localhost:3001
```

Or start individually — see each app's `CLAUDE.md`.

---

## Testing

```bash
pnpm test           # All suites
turbo run test --filter=http-server   # Single app
```

Tests use **Vitest**. Config lives in `vitest.config.ts` per package. Integration tests for `http-server` use `supertest`.

---

## Docker

All three apps have Dockerfiles in `docker/`. Use `docker-compose.yml` at the root for local containerized dev.

---

## CI/CD

GitHub Actions workflows live in `.github/`. The workflow defines four independent jobs: `lint`, `build`, `test` (with PostgreSQL), and `check-types`.

Turbo remote caching is configured via `TURBO_TOKEN` + `TURBO_TEAM` env vars in CI.

---

## Do Not

- ❌ Do NOT use `require()` — all packages use `"type": "module"` (ESM)
- ❌ Do NOT add `.js` extensions to TypeScript `import` paths inside `src/` (use bare module names)
- ❌ Do NOT commit `.env` files
- ❌ Do NOT add TypeScript `paths` in package `tsconfig.json` — use Node.js `imports` subpath field instead
- ❌ Do NOT create nested packages (`packages/foo/packages/bar`)
- ❌ Do NOT import across package boundaries via relative paths (`../../packages/common/src/...`)

---

## Known Gaps & Active Work

For the current evidence-weighted assessment, see [`docs/codebase-audit.md`](docs/codebase-audit.md); `TODOS.md` and `Problems.md` retain historical planning context. Current caveats and stale-claim reconciliation include:

- **ws-server is a large coordinator** — `apps/ws-server/src/index.ts` is currently 895 lines (`wc -l`, verified 2026-10-02; an earlier note here said ~1,500); auth, broadcast, rooms, rate limiting, and handlers are extracted, but the composition root still coordinates most protocol concerns.
- **Redis fan-out is optional, not shared state** — Upstash pub/sub can forward mutations, but room state, WS tickets, and fallback limiter state remain process-local; multi-instance behavior is unverified.
- **Barrel cleanup is partial** — `common`, `db`, `utils`, and `test-utils` still expose root `index.ts`; the workspace currently has six shared library packages, not seven.
- **Schema duplication remains** — the WS server uses the shared element schema at the element boundary but keeps a local schema in `validation.ts`.
- **Yjs adapter removed (2026-09-28)** — the dormant adapter is deleted from both client and server (~400 lines plus deps); active collaboration is JSON deltas, not CRDT wire sync.
- **Deployment evidence is incomplete** — Docker/CI configuration exists and a disposable PostgreSQL migration/HTTP run passed, but image builds, production/remote PostgreSQL/Redis, browser QA, and production-scale tests were not run.
