# Dripl — Monorepo Guide for AI Assistants

This is the **root-level guide** for the Dripl monorepo. Read this first before touching any code.

---

## What Is Dripl?

Dripl is a real-time collaborative canvas application (think Excalidraw/Figma). It consists of three deployable apps and six shared library packages, all managed in a Turborepo monorepo.

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
├── TODOS.md                     # Engineering roadmap (36 items)
├── Problems.md                  # Security audit report (23 findings)
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
│   ├── dripl/            # @dripl/dripl   — core canvas lib, hooks, state
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
           ──► @dripl/dripl   ──► @dripl/common, @dripl/math

http-server ──► @dripl/common, @dripl/db, @dripl/utils
ws-server   ──► @dripl/common, @dripl/db, @dripl/utils

@test-utils ──► @dripl/common (dev: @dripl/eslint-config, @dripl/typescript-config)
```

**No circular dependencies.** Apps never depend on other apps.

---

## Turborepo Task Pipeline

| Task | Runs in | DependsOn | Cached? |
|---|---|---|---|
| `build` | All packages | `^build` (deps first) | ✅ Yes |
| `dev` | All apps | `^build` | ❌ No (persistent) |
| `lint` | All packages | `transit` | ✅ Yes |
| `test` | All packages | `^build`, `build` | ✅ Yes |
| `check-types` | All packages | `transit` | ✅ Yes |
| `transit` | All packages | `^transit` | ✅ Yes |

The `transit` task is a dependency-ordering shim that allows `lint` and `check-types` to run in parallel while respecting package build order.

### Turbo Boundary Tags

Packages are tagged to enforce architectural boundaries:

| Tag | Applied To | Cannot depend on |
|---|---|---|
| `app:web` | `dripl-app` | other apps |
| `app:server` | `http-server`, `ws-server` | other apps |
| `pkg:core` | `dripl`, `element`, `math`, `utils` | apps |
| `pkg:data` | `db`, `common` | apps, `pkg:core` |

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
- **Output**: `dist/`  (produced by `tsc -b --force`)
- **Exports**: `dist/index.js` + `dist/index.d.ts`

The `dist/` output is listed in `turbo.json` `outputs: ["dist/**"]` so Turborepo can cache and restore builds.

> **Never import from `src/` across package boundaries.** Always import from the package name (e.g., `import { Foo } from '@dripl/common'`).

---

## TypeScript Configuration

Shared configs live in `tooling/typescript-config/`. Each package extends one of:

| Config file | Used by |
|---|---|
| `base.json` | Node/server packages |
| `nextjs.json` | `dripl-app` |
| `react-library.json` | `@dripl/dripl` |
| `tsconfig.json` | Generic fallback |

The root `tsconfig.json` only contains `references` for IDE project-wide go-to-definition — **do not add compiler options there**.

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

| Variable | Used By |
|---|---|
| `DATABASE_URL` | `@dripl/db`, `http-server` |
| `JWT_SECRET` | `http-server`, `ws-server` |
| `GEMINI_API_KEY` | `dripl-app` |
| `GOOGLE_CLIENT_ID` | `http-server`, `dripl-app` |
| `NEXT_PUBLIC_*` | `dripl-app` (client-side) |
| `FRONTEND_URL` | `http-server`, `ws-server` |
| `REDIS_URL` | `ws-server`, `http-server` |
| `PORT` / `WS_PORT` | `http-server` / `ws-server` |
| `SMTP_USER` / `SMTP_PASS` | `http-server` |

See `.env.example` for the full list with descriptions.

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
- **No barrel files** in packages — use granular `exports` in `package.json` instead (note: currently violated by all 7 packages — see TODOS #18)
- **All console output must be structured JSON** — no plain `console.log` in server code

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

GitHub Actions workflows live in `.github/`. The pipeline runs:
1. `lint` → `check-types` → `build` → `test` (in dependency order via Turbo)

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

For the full engineering roadmap, see `TODOS.md`. Key active items:

- **ws-server is a 737-line monolith** — documented module structure in `ws-server/CLAUDE.md` doesn't match reality (files like `rooms.ts`, `handlers.ts` don't exist yet)
- **Redis is declared but unused** — `REDIS_URL` in `.env.example` but no Redis client imports anywhere
- **Barrel files in all 7 packages** — violates the "no barrel files" rule above
- **Duplicate `.env` files** — app-level `.env` files exist and may contain real credentials
- **TypeScript version mismatch** — root at `^6.0.3`, apps at `^5.x`, some packages at `latest`
- **Docker runs dev in production** — all Dockerfiles use `CMD pnpm run dev`

See `Problems.md` for the full security audit (23 findings, 19 fixed).
