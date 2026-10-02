# Architecture Solutions

> **Historical architecture/remediation record.** Several sections describe
> packages, versions, and line counts that no longer exist. Current source
> manifests and [`docs/codebase-audit.md`](../codebase-audit.md) are the source
> of truth; retain these entries for decision history, not as a current
> architecture description.

---

## 1. ws-server Monolith Decomposition

### Problem Statement

The original WebSocket collaboration server was a single 737-line file.
The current tree has extracted auth, broadcast, room, rate-limit, type, and
handler modules, but `index.ts` is still a large composition root (895 lines
in the current workspace, measured with `wc -l apps/ws-server/src/index.ts`).
The decomposition reduces concentration of pure helpers; it does not make the
coordinator a small module.

### Root Cause

No architectural boundaries were drawn during initial development. The WebSocket server was built as a quick prototype where all concerns lived in one file. Over time, as message types grew (scene-update, scene-delta, element-update, cursor-move, etc.), the file became unwieldy. There was no decomposition step because the server "worked" and there was no explicit refactoring task tracked.

### Solution

Split the monolith into five focused modules with clear responsibilities:

| Module           | Current role                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `types.ts`       | Shared interfaces and room/connection state types                       |
| `auth.ts`        | Ticket extraction and HTTP-server validation                            |
| `broadcast.ts`   | `send()`, `broadcast()`, presence/cursor payloads                       |
| `rooms.ts`       | Room state, stored-scene parsing, persistence, debounced saves          |
| `rateLimiter.ts` | Upstash-backed or bounded local message limiting                        |
| `handlers/`      | Extracted message-handler seam (currently cursor handling)              |
| `index.ts`       | Large composition root: HTTP/WS setup, dispatch, persistence, lifecycle |

The current composition root imports these modules but still owns substantial
protocol orchestration. Reverse indexes exist, but the old line-count targets
in this historical table are not current acceptance criteria.

### File Map

- **Created:** `apps/ws-server/src/types.ts`
- **Created:** `apps/ws-server/src/auth.ts`
- **Created:** `apps/ws-server/src/broadcast.ts`
- **Created:** `apps/ws-server/src/rooms.ts`
- **Created:** `apps/ws-server/src/rateLimiter.ts`
- **Modified:** `apps/ws-server/src/index.ts` (historical decomposition; current coordinator is 895 lines)

---

## 2. Docker Dev-in-Production Fix

### Problem Statement

All three Dockerfiles (`Dockerfile.dripl-app`, `Dockerfile.http-server`, `Dockerfile.ws-server`) used `CMD pnpm run dev` with `NODE_ENV=development`. The builds also referenced a now-deleted `packages/runtime` directory; the Dockerfiles were later updated to copy `packages/test-utils` instead. Running dev servers in production containers wastes resources (hot-reload watchers, source maps, verbose logging) and introduces security risks.

### Root Cause

The Dockerfiles were written during early development and never updated for production use. The `packages/runtime` reference came from the pre-refactor package layout and was removed after the runtime package was deleted. The `CMD pnpm run dev` pattern was carried over from local development scripts without considering the production container context.

### Solution

Applied multi-stage builds across the three application Dockerfiles. The
current files build after copying app source and use production start commands;
image builds and runtime behavior were not re-executed by this documentation
inventory.

1. **`deps` stage:** Installs dependencies with frozen lockfile, builds internal packages
2. **`runner` stage:** Copies built artifacts, sets `NODE_ENV=production`, and runs the app's compiled start command (`pnpm run start` for the frontend; `node dist/index.js` for the two backend images).

Key changes in each Dockerfile:

- Added `corepack enable pnpm` for deterministic pnpm versions
- Changed the historical dev-server command to a production start command
  (`pnpm run start` for the frontend and `node dist/index.js` for the two
  backend images)
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

Historical remediation: the original compose change described a Redis service
and health checks for all four services. The current `docker-compose.yml` has
PostgreSQL plus the three application services, uses health checks for those
services, and treats Upstash Redis as optional external configuration. The
table below preserves the earlier design, not a current Redis-container claim.

| Service                               | Historical health check                   | Interval | Start Period |
| ------------------------------------- | ----------------------------------------- | -------- | ------------ |
| postgres                              | `pg_isready -U dripl`                     | 5s       | —            |
| redis (not a current compose service) | `redis-cli ping`                          | 5s       | —            |
| http-server                           | `node fetch http://localhost:3002/health` | 10s      | 20s          |
| ws-server                             | `node fetch http://localhost:3001/health` | 10s      | 20s          |

The current compose file uses `depends_on: condition: service_healthy` for
PostgreSQL and the HTTP/WS dependency chain. The `start_period` gives the
application services time to boot before probes begin; no image build or live
container startup was run by this inventory.

### File Map

- **Modified:** `docker-compose.yml`

---

## 4. TypeScript Version Fragmentation

### Problem Statement

TypeScript versions were inconsistent across the monorepo: root had `^6.0.3`, apps used `^5.x`, and five packages pinned `latest`. This caused conflicting type resolution, inconsistent compiler behavior, and occasional build failures when packages were built with different TypeScript versions.

### Root Cause

Each package and app managed its own TypeScript version independently. There was no workspace-level enforcement or shared version constraint. The root `package.json` was updated to TypeScript 6 independently, while apps and packages stayed on 5.x. Some packages used `latest` as a shortcut to avoid version management.

### Solution

The current package manifests align TypeScript to `^5.9.3` across the
workspace. The surrounding versions in the original note (for example
Prisma `^7.2.0`, Vitest `^4.0.14`, and Zod `^4.3.6`) are historical; current
manifests use newer ranges. Do not use the old version list as a lockfile
substitute.

### File Map (historical)

The original change touched manifests that no longer all exist. Current
package manifests under `apps/*/package.json` and `packages/*/package.json`
are authoritative; there is no `packages/dripl/package.json`.

---

## 5. Runtime Dependencies in devDependencies

### Historical status

This entire section is superseded: `@dripl/dripl` was removed and the current
workspace has six shared library packages. The old `devDependencies` versus
`dependencies` example is retained only to explain the former package-layout
decision.

---

## 6. Automated Dependency Updates

### Problem Statement

The repository had no automated dependency management. Dependencies aged silently, security patches were not applied, and upgrade PRs had to be created manually. This led to accumulated technical debt and potential security vulnerabilities.

### Root Cause

No dependency management tool was configured. The team relied on manual `pnpm update` commands and periodic manual reviews. There was no visibility into which dependencies were outdated or had known vulnerabilities.

### Solution

Added Renovate bot configuration (`renovate.json`) with:

- **Auto-merge:** minor/patch updates are configured for automerge; actual merge
  still depends on branch protection and required CI status checks
- **Grouped rules:** Related packages are updated together in single PRs:
  - `prisma` — all `@prisma/*` and `prisma` packages (manual review)
  - `typescript` — `typescript` and `ts-*` packages (manual review)
  - `eslint` — `eslint`, `@eslint/*`, `typescript-eslint` (auto-merge)
  - `vitest` — `vitest` and `@vitest/*` (auto-merge)
  - `react` — `react` and `react-dom` (manual review)
  - `nextjs` — `next` (manual review)
- **Base config:** Extends `config:recommended` for sensible defaults

Major updates are not automatically merged by these rules; the original
“security patches always auto-merge” wording is not a current policy claim.
Review Renovate’s resolved config and CI status on each update.

### File Map

- **Created:** `renovate.json`

---

## 9. Fractional Indexing for Z-Ordering (Not CRDT Convergence)

### Problem Statement

Z-ordering was based on array position. During real-time collaboration, two users reordering elements simultaneously caused conflicts — last-write-wins discarded one user's reorder. The canvas had two disconnected ordering systems: array-position (used by `bringForward`/`sendBackward`/etc.) and numeric `zIndex` property (used by PropertiesPanel), but the renderer only used array position.

### Root Cause

The initial canvas implementation used a simple array for element storage. Z-order was implicit — elements earlier in the array rendered behind elements later in the array. This works for single-user but breaks in collaborative scenarios where concurrent reorders need to merge without conflict.

### Solution

Integrated the `fractional-indexing` library to generate lexicographically-sortable string keys for element ordering:

1. **Type system:** Added `fractionalIndex?: string` to `ElementBase` in `@dripl/common` and `BaseElementSchema` in `@dripl/common/schemas.ts`
2. **Canvas store:**
   - Added `sortByFractionalIndex()` helper that sorts elements lexicographically by their fractional index
   - Added `ensureFractionalIndexes()` for backward-compatible migration of existing elements
   - All element insertion (`commitDraft`, `addElement`, `addElements`) generates a fractional index via `generateKeyBetween(lastIndex, null)`
   - `setElements` (remote sync) ensures and sorts by fractional index
3. **Reordering functions:** Rewrote `bringForward`, `sendBackward`, `bringToFront`, `sendToBack` to generate new fractional indexes between neighbors instead of array swapping
4. **PropertiesPanel:** Layer buttons now call store reordering functions instead of setting numeric `zIndex` directly
5. **zIndexUtils.ts:** Rewrote all utility functions to sort by `fractionalIndex` instead of numeric `zIndex`
6. **ws-server:** `elementsToArray()` sorts by fractional index before serialization, ensuring consistent order across all clients
7. **Import sorting:** `canvasUtils.ts` import logic sorts by `fractionalIndex` with y-position fallback

### Key Design Decisions

- **Lexicographic sorting:** `fractional-indexing` generates BASE_62 strings that sort lexicographically. Keys like `"a0"`, `"a0V"`, `"a1"` sort in that order.
- **Infinite insertability:** `generateKeyBetween(a, b)` always produces a key between `a` and `b`, no matter how many times it's called. No re-indexing needed.
- **Backward compatibility:** `ensureFractionalIndexes()` assigns indexes to elements that lack them (legacy data). Elements without `fractionalIndex` sort first.
- **Kept `zIndex` field:** The numeric `zIndex` property remains on `ElementBase` for backward compatibility but is no longer used for ordering.

### Impact

- **Ordering implementation:** fractional indexes provide sortable insert keys; this is not evidence of CRDT convergence.
- **Collaboration safety:** version/nonce reconciliation and ordering keys are present, but concurrent multi-user convergence remains unverified.
- **No re-indexing for insertion:** inserting between existing keys does not require renumbering the whole scene.
- The current tree contains fractional-index tests; the historical “17 tests” count is not a current test-run claim.

### Files Modified

- `packages/common/src/types/element.ts` — Added `fractionalIndex?: string` to `ElementBase`
- `packages/common/src/schemas.ts` — Added `fractionalIndex: z.string().optional()` to `BaseElementSchema`
- `apps/dripl-app/lib/canvas-store.ts` — Sorting, index generation, rewritten reordering
- `apps/dripl-app/utils/zIndexUtils.ts` — Rewrote to use fractional indexes
- `apps/dripl-app/utils/canvasUtils.ts` — Import sorting uses fractional index
- `apps/dripl-app/components/canvas/PropertiesPanel.tsx` — Layer buttons use store reordering
- `apps/ws-server/src/rooms.ts` — `elementsToArray()` sorts by fractional index
- `packages/test-utils/src/elements.ts` — Added `fractionalIndex` to factory options
- `apps/dripl-app/src/__tests__/fractional-index.test.ts` — New test file (17 tests)
