# Architecture Solutions

> Documented problems, root causes, and fixes applied to the Dripl codebase.

---

## 1. ws-server Monolith Decomposition

### Problem Statement

The WebSocket collaboration server (`apps/ws-server/src/index.ts`) was a single 737-line file containing all application logic: HTTP server setup, JWT authentication, room state management, message dispatch, broadcasting, rate limiting, heartbeat, database persistence, and graceful shutdown. This monolith made the codebase difficult to navigate, test in isolation, and extend with new features.

### Root Cause

No architectural boundaries were drawn during initial development. The WebSocket server was built as a quick prototype where all concerns lived in one file. Over time, as message types grew (scene-update, scene-delta, element-update, cursor-move, etc.), the file became unwieldy. There was no decomposition step because the server "worked" and there was no explicit refactoring task tracked.

### Solution

Split the monolith into five focused modules with clear responsibilities:

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `types.ts` | 30 | Shared interfaces: `UserConnection`, `Cursor`, `RoomState`, `RateLimitInfo` |
| `auth.ts` | 29 | JWT token extraction from URL and verification via `jsonwebtoken` |
| `broadcast.ts` | 39 | `send()`, `broadcast()`, `roomUsersPayload()`, `roomCursorsPayload()` |
| `rooms.ts` | 159 | Room CRUD, element serialization, DB load/save, debounced persistence |
| `rateLimiter.ts` | 31 | Token-bucket rate limiting with periodic cleanup |
| `index.ts` | 567 | Composition root: HTTP server, WS setup, message dispatch, heartbeat, shutdown |

The composition root (`index.ts`) imports from all modules and wires them together. A `userRoomMap` (`Map<WebSocket, string>`) was added for O(1) userId-to-roomId lookups during heartbeat cleanup, replacing the previous O(n) scan of all rooms.

### File Map

- **Created:** `apps/ws-server/src/types.ts`
- **Created:** `apps/ws-server/src/auth.ts`
- **Created:** `apps/ws-server/src/broadcast.ts`
- **Created:** `apps/ws-server/src/rooms.ts`
- **Created:** `apps/ws-server/src/rateLimiter.ts`
- **Modified:** `apps/ws-server/src/index.ts` (refactored from 737 to ~567 lines)

---

## 2. Docker Dev-in-Production Fix

### Problem Statement

All three Dockerfiles (`Dockerfile.dripl-app`, `Dockerfile.http-server`, `Dockerfile.ws-server`) used `CMD pnpm run dev` with `NODE_ENV=development`. The builds also referenced a now-deleted `packages/runtime` directory; the Dockerfiles were later updated to copy `packages/test-utils` instead. Running dev servers in production containers wastes resources (hot-reload watchers, source maps, verbose logging) and introduces security risks.

### Root Cause

The Dockerfiles were written during early development and never updated for production use. The `packages/runtime` reference came from the pre-refactor package layout and was removed after the runtime package was deleted. The `CMD pnpm run dev` pattern was carried over from local development scripts without considering the production container context.

### Solution

Applied multi-stage builds across all three Dockerfiles:

1. **`deps` stage:** Installs dependencies with frozen lockfile, builds internal packages
2. **`runner` stage:** Copies only built artifacts, sets `NODE_ENV=production`, runs `pnpm run start`

Key changes in each Dockerfile:
- Added `corepack enable pnpm` for deterministic pnpm versions
- Changed `CMD pnpm run dev` to `CMD ["pnpm", "run", "start"]`
- Set `ENV NODE_ENV=production` in runner stage
- Fixed `packages/runtime` references to `packages/test-utils`
- Added `USER node` for non-root execution
- Used exec-form `CMD` for proper signal handling

### File Map

- **Modified:** `docker/Dockerfile.dripl-app`
- **Modified:** `docker/Dockerfile.http-server`
- **Modified:** `docker/Dockerfile.ws-server`

---

## 3. Docker Health Checks and Dependency Ordering

### Problem Statement

The `docker-compose.yml` had no health checks for any service. Services started without verifying that their dependencies were actually ready. This caused race conditions where `ws-server` or `http-server` would fail to connect to PostgreSQL or Redis on startup, requiring manual restarts.

### Root Cause

Health checks were omitted for simplicity during initial compose setup. Docker Compose's default `depends_on` only waits for container start, not service readiness. PostgreSQL can take several seconds to initialize after its container starts, and Redis similarly needs time to bind its port.

### Solution

Added health checks to all four services and switched to `service_healthy` dependency conditions:

| Service | Health Check | Interval | Start Period |
|---------|-------------|----------|--------------|
| postgres | `pg_isready -U dripl` | 5s | — |
| redis | `redis-cli ping` | 5s | — |
| http-server | `wget -qO- http://localhost:3002/health` | 10s | 15s |
| ws-server | `wget -qO- http://localhost:3001/health` | 10s | 15s |

Application services use `depends_on` with `condition: service_healthy`, ensuring PostgreSQL and Redis are fully initialized before connection attempts. The `start_period` on application health checks gives them time to boot before health probes begin.

### File Map

- **Modified:** `docker-compose.yml`

---

## 4. TypeScript Version Fragmentation

### Problem Statement

TypeScript versions were inconsistent across the monorepo: root had `^6.0.3`, apps used `^5.x`, and five packages pinned `latest`. This caused conflicting type resolution, inconsistent compiler behavior, and occasional build failures when packages were built with different TypeScript versions.

### Root Cause

Each package and app managed its own TypeScript version independently. There was no workspace-level enforcement or shared version constraint. The root `package.json` was updated to TypeScript 6 independently, while apps and packages stayed on 5.x. Some packages used `latest` as a shortcut to avoid version management.

### Solution

Unified TypeScript to `^5.9.3` across all apps and packages. Aligned related tooling versions:

- **TypeScript:** `^5.9.3` everywhere (root, apps, packages)
- **Prisma:** `^7.2.0` (aligned across `@dripl/db` consumers)
- **Vitest:** `^4.0.14` (aligned across test configurations)
- **Zod:** `^4.3.6` (aligned across runtime consumers)

This ensures all packages compile with the same type checker and share compatible type definitions.

### File Map

- **Modified:** `package.json` (root)
- **Modified:** `apps/dripl-app/package.json`
- **Apps/http-server/package.json`
- **Modified:** `apps/ws-server/package.json`
- **Modified:** `packages/common/package.json`
- **Modified:** `packages/db/package.json`
- **Modified:** `packages/math/package.json`
- **Modified:** `packages/element/package.json`
- **Modified:** `packages/dripl/package.json`
- **Modified:** `packages/utils/package.json`

---

## 5. Runtime Dependencies in devDependencies

### Problem Statement

`@dripl/common` and `@dripl/math` were listed in `@dripl/dripl`'s `devDependencies`, but they are imported and used at runtime in the published package. When consumers installed `@dripl/dripl`, these packages were not installed, causing `MODULE_NOT_FOUND` errors at runtime.

### Root Cause

The packages were initially only used during development and testing. When runtime imports were added (e.g., element types from `@dripl/common`, geometry calculations from `@dripl/math`), the `devDependencies` classification was never updated. The distinction between dev and runtime dependencies was not enforced by linting or CI checks.

### Solution

Moved `@dripl/common` and `@dripl/math` from `devDependencies` to `dependencies` in `packages/dripl/package.json`. This ensures they are installed when consumers depend on `@dripl/dripl`.

Before:
```json
{
  "devDependencies": {
    "@dripl/common": "workspace:*",
    "@dripl/math": "workspace:*"
  }
}
```

After:
```json
{
  "dependencies": {
    "@dripl/common": "workspace:*",
    "@dripl/math": "workspace:*"
  }
}
```

### File Map

- **Modified:** `packages/dripl/package.json`

---

## 6. Automated Dependency Updates

### Problem Statement

The repository had no automated dependency management. Dependencies aged silently, security patches were not applied, and upgrade PRs had to be created manually. This led to accumulated technical debt and potential security vulnerabilities.

### Root Cause

No dependency management tool was configured. The team relied on manual `pnpm update` commands and periodic manual reviews. There was no visibility into which dependencies were outdated or had known vulnerabilities.

### Solution

Added Renovate bot configuration (`renovate.json`) with:

- **Auto-merge:** Minor and patch updates are auto-merged after CI passes
- **Grouped rules:** Related packages are updated together in single PRs:
  - `prisma` — all `@prisma/*` and `prisma` packages (manual review)
  - `typescript` — `typescript` and `ts-*` packages (manual review)
  - `eslint` — `eslint`, `@eslint/*`, `typescript-eslint` (auto-merge)
  - `vitest` — `vitest` and `@vitest/*` (auto-merge)
  - `react` — `react` and `react-dom` (manual review)
  - `nextjs` — `next` (manual review)
- **Base config:** Extends `config:recommended` for sensible defaults

Major version updates (e.g., React 19, Next.js 15) require manual review. Security patches are still auto-merged regardless of semver range.

### File Map

- **Created:** `renovate.json`
