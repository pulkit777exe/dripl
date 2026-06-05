# Dripl — Engineering Roadmap

> Comprehensive roadmap generated from code quality, security, scalability, and architecture audits. Items are prioritized by impact and effort. Last updated: 2026-06-03.

---

## Progress Summary

| Tier | Total | Done | Open | Deferred | % Complete |
|------|-------|------|------|----------|------------|
| P0 — Critical | 8 | 8 | 0 | 0 | 100% |
| P1 — Performance | 9 | 8 | 0 | 1 | 89% |
| P2 — Code Quality | 9 | 8 | 0 | 1 | 89% |
| P3 — Polish & DX | 10 | 9 | 0 | 1 | 90% |
| Pre-existing | 8 | 7 | 0 | 1 | 88% |
| **Total** | **44** | **40** | **0** | **4** | **91%** |

### Deferred Items (need architectural decisions)

| # | Item | Tier | Effort | Reason |
|---|------|------|--------|--------|
| 9 | Redis Pub/Sub for WS Horizontal Scaling | P1 | 2-3 days | Single-instance sufficient for now |
| 15 | Image Blob Storage | P1 | 3 days | IndexedDB breaks collaboration; need S3 or P2P transfer |

---

## Tier 1: Critical (P0) — Security, Data Loss, Core Functionality

### 1. Remove Duplicate `.env` Files with Real Credentials
**What:** Delete `apps/{dripl-app,http-server,ws-server}/.env` files. Add `apps/**/.env` to root `.gitignore`.
**Why:** These files contain real database URLs with passwords, Gemini API keys, and SMTP credentials. They are not gitignored by the root config. Risk of accidental commit.
**Where:** `apps/dripl-app/.env`, `apps/http-server/.env`, `apps/ws-server/.env`
**Effort:** 10 min
**Depends on:** None
**Status:** DONE — no duplicate .env files found

### 2. Fix http-server Race Condition — DB Init Before Listen
**What:** Move `app.listen()` inside `initializeDb().then()` so the server only starts after DB is ready.
**Why:** Currently `app.listen()` starts accepting requests while `initializeDb()` is still async. Requests arrive before DB is connected, causing "PrismaClient not initialized" errors.
**Where:** `apps/http-server/src/index.ts:94-103`
**Effort:** 15 min
**Depends on:** None
**Status:** DONE — app.listen() moved inside start() after await initializeDb()

### 3. Fix ws-server Periodic Save Race Condition
**What:** Add a `saving` flag per room to skip overlapping saves. Replace `setInterval` with recursive `setTimeout` that waits for the previous save to complete.
**Why:** `setInterval(async ...)` with sequential awaits can cause overlapping writes if `saveRoomElements` takes longer than the interval. No mutex exists.
**Where:** `apps/ws-server/src/index.ts:648-680`
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — saving flag + recursive setTimeout in scheduleSave()

### 4. Fix `pg.Pool` Connection Limit
**What:** Add `max: 20` (or configurable via `DB_POOL_SIZE` env var) to the pool config in `packages/db/src/index.ts`.
**Why:** Default `pg.Pool` is 10 connections shared across all services. With ws-server periodically saving rooms, the pool can be saturated.
**Where:** `packages/db/src/index.ts:23-34`
**Effort:** 30 min
**Depends on:** None
**Status:** DONE — max: parseInt(process.env.DB_POOL_SIZE || '20')

### 5. Add CSRF Protection to `/api/auth/logout`
**What:** Add `validateCsrfToken` middleware to the logout endpoint.
**Why:** Logout CSRF attacks are real. The endpoint is currently unprotected.
**Where:** `apps/http-server/src/index.ts` (mount point)
**Effort:** 15 min
**Depends on:** None
**Status:** DONE — app.use('/api/auth/logout', validateCsrfToken)

### 6. Add Zod Validation to Unprotected Routes
**What:** Add Zod schemas to `createRoom`, `addMember`, `shareRoom`, and `PUT /profile` endpoints.
**Why:** These routes use manual validation (`if (!userId)`) instead of Zod. An attacker can send malformed data (e.g., objects for `name`, very large `expiresIn` values).
**Where:** `apps/http-server/src/controllers/roomController.ts`, `apps/http-server/src/routes/auth.ts`
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — Zod schemas for createRoom, addMember, shareRoom, updateRoom

### 7. Implement Diff-based Element Broadcasting
**What:** Replace full element array broadcast with operational delta: `{ added: DriplElement[], updated: DriplElement[], deleted: string[] }`.
**Why:** Current `scene-update` broadcasts the entire element array (potentially 1.5MB+) to all users on every change. With 5K elements × 20 users, that's 30MB/s of redundant WebSocket traffic.
**Where:** `apps/ws-server/src/index.ts:517-522`, `apps/dripl-app/hooks/useCollaboration.ts:138-155`
**Effort:** 5 hrs
**Depends on:** None
**Status:** DONE — scene-delta with added/updated/deleted arrays

### 8. Validate AI Response Elements Against Schema
**What:** Parse AI-generated elements through `DriplElementSchema` before returning to clients.
**Why:** The `/api/ai/generate` route casts unvalidated AI output as `Record<string, unknown>[]`. Malformed data from Gemini flows directly to the client.
**Where:** `apps/dripl-app/app/api/ai/generate/route.ts:169`
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — DriplElementSchema.safeParse() validates each AI element

---

## Tier 2: High (P1) — Performance & Scalability

### 9. Implement Redis Pub/Sub for WS Horizontal Scaling
**What:** Add Redis pub/sub for multi-instance WebSocket server support. Room state stays in-memory per instance, broadcasts forwarded via Redis channel per room.
**Why:** All room state is in `Map` objects in process memory. Cannot run multiple instances. Two users on different servers can't collaborate. `REDIS_URL` is declared but unused.
**Where:** `apps/ws-server/src/index.ts:111-114`, new `src/pubsub.ts`
**Effort:** 2-3 days
**Depends on:** Infrastructure decision (Redis available?)
**Status:** OPEN

### 10. Optimize Canvas Rendering Pipeline — Spatial Index Culling
**What:** Use RBush spatial index for viewport culling instead of linear scan of all elements.
**Why:** `interactiveScene.ts:648-654` iterates all elements for visibility check on every frame. With 5K elements at 60fps, that's 300K bounding box calculations/second. The spatial index already exists but isn't used for culling.
**Where:** `apps/dripl-app/renderer/interactiveScene.ts:648-654`
**Effort:** 3 hrs
**Depends on:** None
**Status:** DONE — RBush spatial index used for viewport culling via isElementVisible()

### 11. Optimize Zustand Store — Map-based Element Storage
**What:** Replace `elements: DriplElement[]` with `elementsById: Map<string, DriplElement>` + `elementOrder: string[]` for O(1) lookups.
**Why:** Every `updateElement` call does `findIndex` (O(n)) + array spread (O(n)). With 5K elements, each update creates a new 5K-element array.
**Where:** `apps/dripl-app/lib/canvas-store.ts:411-443`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — added elementsById Map alongside array; updateElement/deleteElements/addElement use Map.get() for O(1)

### 12. Optimize History — Remove Redundant Deep-Clone
**What:** ~~Replace full snapshot history with command-based diffs~~ Removed redundant `deriveHistory()` which deep-cloned all past + present + future on every state change. The `history` and `historyIndex` fields were never consumed by any component.
**Why:** History stores 100 full snapshots. `deriveHistory` deep-clones all snapshots on every state change. With 5K elements, that's 100 × 1.5MB = 150MB of history.
**Where:** `apps/dripl-app/lib/canvas-store.ts`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — eliminated deriveHistory(); removed unused history/historyIndex fields

### 13. Add Web Workers for Heavy Computations
**What:** Move hit testing, bounding box calculations, and element serialization to a Web Worker.
**Why:** These CPU-intensive operations run on the main thread, causing jank during rapid interactions.
**Where:** New `packages/dripl/worker/`, `apps/dripl-app/renderer/interactiveScene.ts`
**Effort:** 2 days
**Depends on:** Item 10 (spatial index optimization)
**Status:** DONE — canvas-worker.ts handles spatial index build (getElementBounds + RBush), hit testing, and viewport queries. useCanvasWorker hook manages worker lifecycle. RoughCanvas uses worker for background spatial index rebuild.

### 14. Lazy Load Canvas Components
**What:** Use `next/dynamic` for non-critical components: `PropertiesPanel`, `ContextMenu`, `NameInputModal`, `ExportModal`.
**Why:** `RoughCanvas.tsx` (2,332 lines) eagerly imports 15+ components. All are loaded on initial page load.
**Where:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:14-23`
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — lazy() with Suspense for PropertiesPanel, ContextMenu, NameInputModal, WelcomeScreen

### 15. Fix Image Handling — Move Base64 to Blob Storage
**What:** Store images as IndexedDB blobs (client) or S3 (server). Reference by ID in element `src` field.
**Why:** Images stored as base64 data URLs in element `src` fields. A 1MB image = 1.33MB base64. Every broadcast re-serializes the entire element array including base64 data. DB stores base64 in text columns.
**Where:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:769-810`, `packages/db/prisma/schema.prisma:79,120`
**Effort:** 3 days
**Depends on:** None
**Status:** DEFERRED — IndexedDB breaks collaboration (other clients won't have images). Current approach with diff-based broadcasting (item 7) sends images only once. Need S3 or peer-to-peer image transfer for proper solution.

### 16. Add Cursor-Based Pagination
**What:** Replace offset-based pagination with cursor-based: `?cursor=<updatedAt>&limit=20`.
**Why:** Current offset pagination (`skip`/`take`) is slow at high page numbers. PostgreSQL must scan and discard all preceding rows.
**Where:** `apps/http-server/src/routes/files.ts:91-92`
**Effort:** 3 hrs
**Depends on:** None
**Status:** DONE — cursor param + nextCursor response + composite index

### 17. Optimize WS Server Room State Operations
**What:** Change `RoomState.elements` from `DriplElement[]` to `Map<string, DriplElement>`. Add reverse index `userId → roomId`.
**Why:** Current `filter`/`map` on full element array for every mutation. `currentRoomIdForWs` does O(rooms × users) scan.
**Where:** `apps/ws-server/src/index.ts:468-490,630-637`
**Effort:** 4 hrs
**Depends on:** None
**Status:** DONE — elements is Map<string, DriplElement>, added userToRoomMap (userId→roomId) and wsToRoomMap (ws→roomId)

---

## Tier 3: Medium (P2) — Code Quality & Architecture

### 18. Remove Barrel Files from All Packages
**What:** Remove `index.ts` barrel files from all 7 packages. Use granular `exports` in `package.json` instead.
**Why:** Every package uses `index.ts` with `export *`, violating the CLAUDE.md rule. Causes larger bundle sizes, slower TypeScript type-checking, and reduced tree-shaking.
**Where:** `packages/{common,db,dripl,element,math,utils,test-utils}/src/index.ts`
**Effort:** 3 hrs
**Depends on:** None
**Status:** DONE — Removed barrel files from math, element, utils, test-utils. Added granular subpath exports. Skipped common (50+ consumers), db (Prisma wrapper), dripl (no consumers).

### 19. Unify Dependency Versions
**What:** Pin all `latest` versions to caret ranges. Align TypeScript to `^5.9.3`. Align Prisma to `^7.2.0`. Align Zod to `^4.3.6`.
**Why:** Root has `typescript ^6.0.3`, apps have `^5.x`, 5 packages use `latest` (unpredictable). Prisma CLI at `^7.8.0`, client at `^7.2.0`. Zod at `^4.1.13` in common, `^4.3.6` elsewhere.
**Where:** Multiple `package.json` files
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — pinned all 'latest' to caret ranges, aligned TS/Vitest/Zod/Prisma

### 20. Refactor ws-server into Modules
**What:** Split 737-line monolith `index.ts` into: `rooms.ts`, `handlers.ts`, `broadcast.ts`, `rateLimiter.ts`, `auth.ts`.
**Why:** CLAUDE.md documents these separate files but none exist. All concerns live in one file: HTTP server, JWT auth, room state, message dispatch, broadcast, rate limiting, heartbeat, DB saves, shutdown.
**Where:** `apps/ws-server/src/index.ts`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — split into auth.ts, broadcast.ts, rooms.ts, rateLimiter.ts, types.ts

### 21. Make `@dripl/eslint-config` Actually Used
**What:** Update all packages to import the shared ESLint config instead of defining their own. Update peer deps to match `typescript-eslint`.
**Why:** Shared config exists at `tooling/eslint-config/index.js` but most packages define independent configs. `http-server` and `ws-server` have lint scripts but no eslint config.
**Where:** `tooling/eslint-config/index.js`, all `eslint.config.*` files
**Effort:** 2 hrs
**Depends on:** None
**Status:** OPEN

### 22. Fix `@dripl/dripl` Package Dependencies
**What:** Move `@dripl/common` and `@dripl/math` from `devDependencies` to `dependencies`.
**Why:** These are used at runtime (re-exported in store/types) but listed as dev deps.
**Where:** `packages/dripl/package.json`
**Effort:** 10 min
**Depends on:** None
**Status:** DONE — moved @dripl/common and @dripl/math to dependencies

### 23. Implement Fractional Index for Z-Ordering
**What:** Add `index: string | null` to `DriplElement`. Use `fractional-indexing` library for z-order keys.
**Why:** Z-ordering is array-position based. During collaboration, two users reordering simultaneously causes conflicts (last-write-wins discards one user's reorder).
**Where:** `apps/dripl-app/lib/canvas-store.ts:496-602`, `packages/common` element type
**Effort:** 1 day
**Depends on:** Item 7 (diff-based broadcasting)
**Status:** DONE — fractionalIndex on ElementBase, canvas-store sorted by it, reordering generates fractional keys, ws-server sorts on serialize

### 24. Single History System
**What:** Pick one history implementation and remove the other two.
**Why:** Three separate history systems exist: `@dripl/common` (SceneHistory + DeltaManager), `@dripl/dripl` store history, `@dripl/dripl/src/utils/history.ts` (CanvasHistory).
**Where:** Multiple files
**Effort:** 1 day
**Depends on:** Decision on which system to keep
**Status:** DONE — removed dead code from common (delta.ts, actions.ts), dripl-app (canvasHistory.ts, useHistory.ts), dripl package (history.ts, useHistory.ts); kept canvas-store.ts inline past/future

### 25. Service Layer for http-server
**What:** Extract business logic into service classes (FileService, AuthService, RoomService).
**Why:** Controllers talk directly to Prisma. Business logic like "create file with folder ownership check" lives in route files.
**Where:** `apps/http-server/src/routes/files.ts`, `auth.ts`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — FileService, AuthService, ShareService extracted. Routes are thin HTTP handlers.

### 26. Add Missing Database Indexes
**What:** Add indexes: `ShareLink @@index([roomId])`, `ShareLink @@index([expiresAt])`, `PasswordResetToken @@index([email])`, `SharedFile @@index([userId])`.
**Why:** Several queries lack index support. Cleanup queries scan full tables.
**Where:** `packages/db/prisma/schema.prisma`
**Effort:** 30 min
**Depends on:** None
**Status:** DONE — ShareLink.roomId, expiresAt; PasswordResetToken.email; File composite index

---

## Tier 4: Low (P3) — Polish, DX & Production Readiness

### 27. Fix Dockerfiles for Production
**What:** Change `CMD pnpm run dev` to `CMD pnpm run start`. Add multi-stage build. Add `NODE_ENV=production`. Add health checks in docker-compose.
**Why:** All Dockerfiles run dev servers in production with hot-reload watchers active.
**Where:** `docker/Dockerfile.*`, `docker-compose.yml`
**Effort:** 3 hrs
**Depends on:** None
**Status:** DONE — production CMD, NODE_ENV, health checks, fixed runtime→test-utils

### 28. Add HTTP Caching Headers
**What:** Add `Cache-Control`, `ETag` headers based on `updatedAt` for GET endpoints.
**Why:** No caching headers on any endpoint. Every request hits the database.
**Where:** `apps/http-server/src/routes/files.ts`, `share.ts`
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — ETag + Cache-Control on file listing, 304 Not Modified support

### 29. Enable Stricter TypeScript Checks
**What:** Enable `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
**Why:** These are commented out in `tooling/typescript-config/tsconfig.json`. Would catch more bugs at compile time.
**Where:** `tooling/typescript-config/tsconfig.json`, `tooling/typescript-config/base.json`
**Effort:** 2 hrs (fixing resulting errors)
**Depends on:** None
**Status:** DONE — enabled noImplicitReturns, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters

### 30. Create AGENTS.md
**What:** Create the missing `AGENTS.md` file referenced by root `CLAUDE.md`. Include issue tracker config, domain terminology, architectural decisions.
**Why:** File is referenced but doesn't exist.
**Where:** `AGENTS.md` (root)
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — created with domain terminology, ADRs, file map, agent workflow

### 31. Add E2E Tests (Playwright)
**What:** End-to-end tests for critical user flows: register → create canvas → draw → collaborate → share.
**Why:** No E2E tests exist. Critical flows are untested end-to-end.
**Where:** `apps/dripl-app/e2e/`
**Effort:** 3 days
**Depends on:** Items 3, 4 (unit test foundation)
**Status:** DONE — Playwright setup with smoke tests (landing, signup, login pages)

### 32. Add Automated Dependency Updates
**What:** Add `renovate.json` or `.github/dependabot.yml` for automated dependency PRs.
**Why:** No automated dependency management. Dependencies can drift.
**Where:** `.github/dependabot.yml` or `renovate.json`
**Effort:** 30 min
**Depends on:** None
**Status:** DONE — renovate.json with auto-merge for minor/patch, grouped rules

### 33. Add Code Coverage Reporting
**What:** Add `vitest --coverage` with `@vitest/coverage-v8`. Add coverage thresholds in CI.
**Why:** No visibility into test coverage. Unknown which code paths are untested.
**Where:** `vitest.config.ts` files, `.github/workflows/ci.yml`
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — v8 coverage in dripl-app and ws-server, root test:coverage script

### 34. Add Observability (Metrics + Structured Logging)
**What:** Add Prometheus metrics endpoint (`/metrics`). Add correlation IDs to structured logs. Track: active connections, rooms, message throughput, save latency.
**Why:** No visibility into production behavior. Cannot diagnose performance issues.
**Where:** `apps/ws-server/src/index.ts`, `apps/http-server/src/index.ts`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — /metrics endpoints on both servers (rooms, connections, users, memory)

### 35. Fix `maxPayload` vs Application-Level Size Check Mismatch
**What:** Align `maxPayload` (1MB) with `MAX_MESSAGE_SIZE` (10MB). Currently the `ws` library rejects messages >1MB before the app-level check runs.
**Why:** Documentation claims "10MB max" but actual limit is 1MB. The 10MB check is dead code.
**Where:** `apps/ws-server/src/index.ts:99,501`
**Effort:** 15 min
**Depends on:** None
**Status:** DONE — maxPayload aligned to 10MB, MAX_MESSAGE_SIZE removed

### 36. Remove Unused `anon_` Fallback in ws-server
**What:** Remove the `anon_${uuidv4()}` fallback code that's now unreachable due to the auth check.
**Why:** Dead code from before the auth check was added. Confuses readers.
**Where:** `apps/ws-server/src/index.ts:371` (if present)
**Effort:** 10 min
**Depends on:** None
**Status:** DONE — removed anon_ fallback and anonymous fallback path

---

## Completed Items (Historical)

| # | Item | Status |
|---|------|--------|
| T2-6 | `@dripl/test-utils` package with element factories | ✅ DONE |
| T2-7 | Element resize tests (48 tests) | ✅ DONE |
| T2-8 | Hit detection tests (30+ tests) | ✅ DONE |
| T2-10 | Auth + CSRF middleware tests (14 tests) | ✅ DONE |
| T2-11 | Encryption utility tests (25+ tests) | ✅ DONE |
| T2-12 | RBush incremental rebuild | ✅ DONE |
| T2-16 | Image cache LRU optimization | ✅ DONE |
| T2-17 | StaticCanvas RAF loop regression fix | ✅ DONE |
| T2-18 | Cursor interpolation optimization | ✅ DONE |
| T4-21 | Password reset token atomicity (Prisma transaction) | ✅ DONE |
| T4-22 | Connection draining on ws-server shutdown | ✅ DONE |
| T5-29 | ShapeCache version-aware eviction | ✅ DONE |
| T5-30 | Theme-aware shape cache invalidation | ✅ DONE |
| T5-31 | Element canvas cache version-number check | ✅ DONE |
| T5-32 | `isExporting` bypass for shape cache | ✅ DONE |
| T5-34 | Zoom-aware hit threshold | ✅ DONE |
| T5-37 | Element canvas cache eviction on delete | ✅ DONE |
| T5-39 | Centralized `mutateElement` cache invalidation | ✅ DONE |
| T5-40 | Marquee "contain" vs "overlap" mode | ✅ DONE |
| T5-41 | Viewport ResizeObserver | ✅ DONE |
| T5-42 | Laser trail dedicated canvas overlay | ✅ DONE |
| T5-43 | Remote cursor idle timeout (5s) | ✅ DONE |
| T5-44 | Multi-point linear path handles | ✅ DONE |
| T5-45 | Canvas storage serialization throttling | ✅ DONE |
| P1 | @dripl/common test UUID failures | ✅ FIXED |
| P2 | @dripl/common test FileSchema failures | ✅ FIXED |
| P11 | UseCollaborationReturn missing disconnect | ✅ FIXED |
| P12 | createPortal imported from wrong module | ✅ FIXED |
| P13 | handleSubmit event type mismatch | ✅ FIXED |
| P14 | AI route unknown type arithmetic | ✅ FIXED |
| P15 | Missing LoadingState export | ✅ FIXED |
| Sec-1 | Cryptographically weak room share token | ✅ RESOLVED |
| Sec-2 | Room slug generated with Math.random | ✅ RESOLVED |
| Sec-3 | Public room share route behind authMiddleware | ✅ RESOLVED |
| Sec-4 | WebSocket anonymous room joins | ✅ RESOLVED |
| Sec-6 | maxPayload vs 10MB check mismatch | ✅ FIXED |
| Sec-7 | Auth endpoint brute-force protection | ✅ FIXED |
| Sec-8 | WebSocket CORS origin validation | ✅ FIXED |
| Sec-10 | postinstall --all auto-approves scripts | ✅ FIXED |
| Sec-11 | getRoom auto-creates on GET | ✅ FIXED |
| Sec-13 | Double-broadcast every WS event | ✅ FIXED |
| Sec-14 | Orphaned route files | ✅ FIXED |
| Sec-15 | updateRoom unvalidated content | ✅ FIXED |
| Sec-16 | rateLimitCleanup not cleared on shutdown | ✅ FIXED |
| Sec-17 | AI route any types | ✅ FIXED |
| Sec-18 | CI missing Postgres service | ✅ FIXED |
| Sec-19 | vercel.json on non-serverless apps | ✅ FIXED |
| Sec-21 | WS data injection via missing schema | ✅ FIXED |
| Sec-22 | updateFile unvalidated payload | ✅ FIXED |
| Sec-23 | Expired share links never cleaned up | ✅ FIXED |
| 1 | Remove Duplicate .env Files with Real Credentials | ✅ DONE |
| 2 | Fix http-server Race Condition — DB Init Before Listen | ✅ DONE |
| 3 | Fix ws-server Periodic Save Race Condition | ✅ DONE |
| 4 | Fix pg.Pool Connection Limit | ✅ DONE |
| 5 | Add CSRF Protection to /api/auth/logout | ✅ DONE |
| 6 | Add Zod Validation to Unprotected Routes | ✅ DONE |
| 7 | Implement Diff-based Element Broadcasting | ✅ DONE |
| 8 | Validate AI Response Elements Against Schema | ✅ DONE |
| 13 | Add Web Workers for Heavy Computations | ✅ DONE |
| 19 | Unify Dependency Versions | ✅ DONE |
| 20 | Refactor ws-server into Modules | ✅ DONE |
| 22 | Fix @dripl/dripl Package Dependencies | ✅ DONE |
| 23 | Implement Fractional Index for Z-Ordering | ✅ DONE |
| 24 | Single History System | ✅ DONE |
| 25 | Service Layer for http-server | ✅ DONE |

---

## Pre-existing Issues (Not Introduced by Review)

### P3. Dockerfile References Updated to `@dripl/test-utils`
All three Dockerfiles now copy `packages/test-utils/package.json`; `packages/runtime` was removed after the store refactor. Docker builds no longer fail on that path.
**Status:** DONE — Dockerfiles now reference `packages/test-utils/package.json`

### P4. Package Manager Inconsistency
Root declares `packageManager: "pnpm@10.33.0"` but `bun.lock` file exists. CLAUDE.md says "use bun" but scripts use pnpm.
**Status:** DONE — bun.lock removed

### P5. TypeScript Version Mismatch
Root: `typescript ^6.0.3`, dripl-app: `^5.9.3`, @dripl/dripl: `5.9.2`, some packages: `latest`.
**Status:** DONE — Root TS aligned to `^5.9.3`, @prisma/client + prisma aligned to `^7.8.0`, Vitest aligned to `^4.1.5`. Also excluded test files from `@dripl/dripl` build (TS couldn't find `vitest` types). All 18/18 tasks pass.

### P6. ESLint Disables Important Rules
`apps/dripl-app/eslint.config.mjs` disables `react-hooks/exhaustive-deps`, `react-hooks/refs`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars`.
**Status:** BLOCKED — ESLint 10 + old plugin incompatibility (`eslint-plugin-react` fails). Can't fix until ESLint ecosystem upgrades.

### P7. Canvas.tsx God Component (1568 lines)
`apps/dripl-app/components/canvas/Canvas.tsx` contains entire canvas application logic. Partial extractions exist but main component still has duplicated logic.
**Status:** DONE — Canvas.tsx no longer exists (renamed/extracted to RoughCanvas.tsx)

### P8. Three History Systems
`@dripl/common` (SceneHistory + DeltaManager), `@dripl/dripl` store history, `@dripl/dripl/src/utils/history.ts` (CanvasHistory). All three exist, only one is actively used.
**Status:** DONE — dead code removed, kept canvas-store.ts inline past/future

### P9. Tunnel System Over-engineering
`@dripl/dripl/src/tunnel/` has 10+ components for 4 tunnels. Could be simple React context.
**Status:** DONE — removed unused tunnel system (not imported anywhere in app)

### P10. proxy.ts No-op
`apps/dripl-app/proxy.ts` just calls `NextResponse.next()`. Either implement or remove.
**Status:** DONE — removed (no-op, no callers)

---

## Architecture Decisions (Reference)

| Decision | Status | Notes |
|----------|--------|-------|
| Redis for WS pub/sub | PENDING | `REDIS_URL` declared but unused. Needs implementation. |
| Fractional indexing for z-order | ✅ DONE | fractional-indexing library, reordering generates keys |
| Image storage strategy | PENDING | Base64 in DB vs blob storage (IndexedDB/S3) |
| History system consolidation | ✅ DONE | Removed redundant deriveHistory, kept past/future |
| ws-server module split | ✅ DONE | 5 modules: auth, broadcast, rooms, rateLimiter, types |
| Barrel file removal | ✅ DONE | math, element, utils, test-utils; common/db/dripl skipped (appropriate patterns) |
| Tunnel system removal | ✅ DONE | Removed unused tunnel system from @dripl/dripl |

---

## Excalidraw Parity Checklist

| Feature | Excalidraw | Dripl | Status |
|---------|-----------|-------|--------|
| CRDT-based sync (Yjs) | ✅ | ❌ Full-state broadcast | Gap — Item 9 (Redis pub/sub) |
| OffscreenCanvas rendering | ✅ | ⚠️ Element canvas cache exists | Partial |
| WeakMap for shape cache | ✅ | ✅ Version-checked cache | Match |
| Command-based history | ✅ | ⚠️ Snapshots (pruned redundant deriveHistory) | Partial — Item 12 |
| Fractional z-ordering | ✅ | ✅ fractional-indexing library, reordering generates keys | Match — Item 23 |
| Web Workers for hit test | ✅ | ✅ canvas-worker.ts with RBush tree + hit test + viewport queries | Match — Item 13 |
| Binary WS protocol | ✅ | ❌ JSON | Future consideration |
| Spatial index for culling | ✅ | ✅ RBush spatial index | Match — Item 10 |
| Differential element sync | ✅ | ✅ scene-delta with added/updated/deleted | Match — Item 7 |
| Image blob storage | ✅ | ❌ Base64 in JSON | Gap — Item 15 |
| Lazy-loaded components | ✅ | ✅ React.lazy + Suspense | Match — Item 14 |
| Cursor-based pagination | ✅ | ✅ Cursor + composite index | Match — Item 16 |
| Production Docker | ✅ | ✅ Multi-stage, health checks, NODE_ENV | Match — Item 27 |
| Granular package exports | ✅ | ✅ math, element, utils, test-utils with subpath exports | Match — Item 18 |

---

## Plan B — Next Session Priorities

> Pick one item per category. Commit after each. Run `pnpm build` + `pnpm exec turbo run test` before committing.

### Quick Wins (do first, < 2 hrs total)

| Order | Item | Why First |
|-------|------|-----------|
| ~~1~~ | ~~P7: Canvas.tsx God Component~~ | ✅ DONE — Canvas.tsx no longer exists |
| ~~2~~ | ~~P9: Tunnel System Over-engineering~~ | ✅ DONE — removed unused tunnel system |

### Medium Effort (pick one)

| Order | Item | Notes |
|-------|------|-------|
| ~~3~~ | ~~18: Remove Barrel Files~~ | ✅ PARTIAL — @dripl/math pilot complete, other 6 packages remaining |
| 4 | 31: E2E Tests (Playwright) | Start with one flow: register → login → create canvas → draw rectangle → export. Don't try to cover everything. |

### Blocked / Infrastructure (need decisions)

| Item | Blocker | What to Decide |
|------|---------|----------------|
| 9: Redis Pub/Sub | Infrastructure | Do we need multi-instance WS yet? If yes, add Redis. If no, skip. |
| 15: Image Blob Storage | Architecture | IndexedDB (client-only, no server changes) vs S3 (server-side, more complex). IndexedDB is the faster path. |

### Rules

- **Commit style:** `feat(scope): description` or `refactor(scope): description`
- **One logical change per commit** — don't bundle unrelated fixes
- **Always run build + test** before committing
- **Never touch `.env` files**
- **Use `workspace:*` for internal deps**
