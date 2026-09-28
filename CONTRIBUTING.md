# Contributing to Dripl

Thank you for your interest in contributing to Dripl! This guide will help you get started.

---

## Prerequisites

- **Node.js** 20+ (`node --version`)
- **pnpm** 10+ (`pnpm --version`)
- **PostgreSQL** (for local development)
- **Redis** (optional, for production features)

---

## Development Setup

### 1. Clone & Install

```bash
git clone <repo-url>
cd dripl
pnpm install
```

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env with your local values
```

Required variables:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Minimum 32 characters
- `INTERNAL_SECRET` — Distinct server-to-server secret (required in production)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Required by the current HTTP auth route
- `FRONTEND_URL` — Usually `http://localhost:3000`

### 3. Database Setup

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate
```

### 4. Start Development

```bash
# Start all services
pnpm dev

# Or start individually
cd apps/dripl-app && pnpm dev    # Port 3000
cd apps/http-server && pnpm dev  # Port 3002
cd apps/ws-server && pnpm dev    # Port 3001
```

---

## Project Structure

```
dripl/
├── apps/
│   ├── dripl-app/       # Next.js 16 frontend
│   ├── http-server/     # Express 5 REST API
│   └── ws-server/       # WebSocket collaboration server
├── packages/
│   ├── common/          # Shared types & Zod schemas
│   ├── db/              # Prisma ORM client
│   ├── element/         # Element factory & rendering
│   ├── math/            # Geometry utilities
│   ├── utils/           # Shared utilities
│   └── test-utils/      # Shared test factories
├── tooling/
│   ├── eslint-config/   # Shared ESLint rules
│   └── typescript-config/ # Shared tsconfigs
└── docker/              # Dockerfiles
```

---

## Coding Standards

### TypeScript

- **Strict mode** is enabled across all packages
- **ESM only** — use `import`/`export`, never `require()`
- **No `any` types** — use `unknown` + type narrowing
- **No barrel files** in packages — use granular `exports` in `package.json` where practical; the current workspace still has some root barrels, so avoid expanding that debt.

### Code Style

- **Prettier** for formatting (runs on save)
- **ESLint** for linting (run `pnpm lint` before committing)
- **100 char line width** max
- **Single quotes**, **trailing commas**, **2-space indent**

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Examples:**

```
feat(canvas): add multi-select with marquee
fix(ws-server): prevent overlapping periodic saves
docs: update architecture diagram in README
test(element): add resize tests for diamond shapes
```

### Package Manager

- **Always use `pnpm`** for package management
- **Use `workspace:*`** for all internal package dependencies
- **Never install deps at root** unless they are repo-level tools

---

## Testing

### Running Tests

```bash
pnpm test              # All suites
pnpm test -- --watch   # Watch mode

# Single package
turbo run test --filter=@dripl/element
turbo run test --filter=http-server
```

### Database-backed tests (opt-in)

Two suites run against a **real, migrated PostgreSQL** rather than mocks. They
are skipped by `pnpm test`, so an ordinary run never needs a database.

```bash
# 1. Disposable database
docker run -d --name dripl-pg-test \
  -e POSTGRES_PASSWORD=dripl -e POSTGRES_USER=dripl -e POSTGRES_DB=dripl_test \
  -p 55432:5432 postgres:latest

# 2. Migrations. Run from packages/db so prisma.config.ts is discovered.
(cd packages/db && DATABASE_URL="postgresql://dripl:dripl@127.0.0.1:55432/dripl_test?schema=public" \
  pnpm exec prisma migrate deploy)

# 3. The suites
RUN_DB_INTEGRATION=true RUN_WS_DB_INTEGRATION=true \
  DATABASE_URL="postgresql://dripl:dripl@127.0.0.1:55432/dripl_test?schema=public" \
  pnpm --filter http-server --filter ws-server test
```

| Suite                                                          | What it proves                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http-server/src/__tests__/integration/fileService.db.test.ts` | Owner scoping, scene validation, and stale-save rejection through real Prisma queries                                                                                                                                                                                                                     |
| `ws-server/src/__tests__/production-db.test.ts`                | Two real WebSocket clients over a real database: stored-scene load, debounced persistence read back from the column, read-only denial, denial for an unrelated user, share revocation, replayed-version rejection, newer-version-wins, and the optimistic-concurrency fence losing to a concurrent writer |

The WebSocket suite stubs the HTTP ticket exchange; everything else in it,
including all seven migrations and every authorization query, is real. That stub
is the one thing it does not cover, and it is named in the suite's `describe`
block so it cannot be mistaken for full end-to-end coverage.

Tear down with `docker rm -f dripl-pg-test`.

### Running the built servers

Servers are bundled with esbuild (`pnpm --filter ws-server build`), which
resolves every relative import at build time — the output is a single
`dist/index.js` with no relative specifiers left for Node to fail on. The CI
lint job asserts that property statically. The direct smoke below is what
covers "the artifact actually boots":

```bash
# Boot each server from dist/ and hit its health endpoint.
JWT_SECRET=aaa INTERNAL_SECRET=bbb \
  DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db \
  HTTP_SERVER_URL=http://127.0.0.1:3002 HTTP_PORT=3002 \
  node apps/ws-server/dist/index.js
```

Both secrets must differ and, with `NODE_ENV=production`, both must be at least 32
characters. Those checks are deliberate; they are what a deployment hits first.

### Browser tests against a running server

By default the Playwright config starts its own dev server. Point it at an
already-running instance instead, optionally at a different pixel density:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 pnpm exec playwright test
E2E_DEVICE_SCALE_FACTOR=2 E2E_PORT=3400 pnpm exec playwright test
```

`E2E_DEVICE_SCALE_FACTOR` matters because frame cost scales with backing-store
pixels; a DPR-1 run says nothing about a retina display.

### Browser performance evidence

The canvas performance spec is opt-in because it records machine-specific
frame and input data:

```bash
# Install the browser once if it is not already present
pnpm exec playwright install chromium

# One scene size (default 1000 and 5000)
RUN_PERF_E2E=true pnpm --filter dripl-app test:e2e e2e/performance.spec.ts

# Explicit scene sizes
RUN_PERF_E2E=true PERF_SCENE_SIZES=1000,5000 \
  pnpm --filter dripl-app test:e2e e2e/performance.spec.ts
```

The spec starts its own dev server. It prints a per-phase summary to stdout and
attaches raw measurements to the Playwright report; it does not assert a
universal FPS target. Local persistence is budgeted by serialized size for
`localStorage` and capped at 50,000 elements for IndexedDB
(`MAX_PERSISTED_ELEMENTS` in `apps/dripl-app/lib/canvas-db.ts`); the perf
harness seeds the scene into IndexedDB only, so 10k/50k scenes are measurable
through the local path.

> **Rebuild packages before measuring.** The app imports `@dripl/common`,
> `@dripl/element`, `@dripl/math`, and `@dripl/utils` from each package's built
> `dist/`, not from source. Editing `packages/*/src` has no effect in the browser
> until that package is rebuilt:
>
> ```bash
> pnpm --filter @dripl/element build
> ```
>
> Skipping this silently measures stale code, which is easy to mistake for a real
> result. Run it before any browser measurement or A/B of package code, and
> between the two arms of an A/B.

> **Interleave A/B arms.** Do not measure "all of A, then all of B". On a shared
> or loaded machine the drift between two batches is larger than most real
> effects. Alternate the arms and measure a control the change cannot affect: the
> performance spec's `load` phase renders roughly 60 elements regardless of scene
> size, so its variance is the noise floor. One claim in
> `docs/performance-benchmark.md` was withdrawn after identical code turned out
> to vary by 2.5× run to run.

Results, environment, and their limits are recorded in
[`docs/performance-benchmark.md`](docs/performance-benchmark.md). The pinned
comparison is in [`docs/excalidraw-performance-research.md`](docs/excalidraw-performance-research.md).

### Writing Tests

- Tests live alongside source files or in `__tests__/` directories
- Use **Vitest** as the test framework
- Use `@dripl/test-utils` for element/user factories
- Integration tests for `http-server` use **Supertest**

### Test Patterns

```typescript
// Unit test
import { describe, it, expect } from 'vitest';
import { getElementBounds } from '../src';

describe('getElementBounds', () => {
  it('returns correct bounds for rectangle', () => {
    const element = createTestElement({ type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const bounds = getElementBounds(element);
    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});
```

---

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feat/my-feature
# or
git checkout -b fix/my-bugfix
```

### 2. Make Changes

- Follow the coding standards above
- Add tests for new functionality
- Update documentation if needed

### 3. Validate

```bash
pnpm lint         # Fix lint errors
pnpm build        # Verify TypeScript compiles
pnpm test         # Ensure tests pass
```

### 4. Submit PR

- Use a clear, descriptive title
- Reference any related issues
- Fill out the PR template checklist

### 5. Code Review

- At least one approval required
- All CI checks must pass
- Address review feedback

---

## Architecture Decisions

For major architectural decisions, see:

- `TODOS.md` — Engineering roadmap and active work
- `Problems.md` — Security audit findings
- `AGENTS.md` — Domain terminology and decisions

---

## Common Tasks

### Adding a New Package

1. Create `packages/<name>/`
2. Add `package.json` with `"name": "@dripl/<name>"`
3. Add `tsconfig.json` extending `@dripl/typescript-config/base.json`
4. Add to root `tsconfig.json` `references`
5. Run `pnpm install`

### Adding a New API Route

1. Create route file in `apps/http-server/src/routes/`
2. Add Zod schema for request validation
3. Add `authMiddleware` for protected routes
4. Mount router in `apps/http-server/src/app.ts` (the current Express composition root)
5. Add tests

### Adding a New Canvas Element

1. Add type to `@dripl/common` element types
2. Add factory in `@dripl/element`
3. Add rendering in `@dripl/element/rough-renderer.ts`
4. Add hit detection in `@dripl/math`
5. Add tests

---

## Getting Help

- Check existing issues and discussions
- Read the codebase documentation (`CLAUDE.md` files)
- Ask questions in PRs or issues

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
