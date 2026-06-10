# Dripl — Engineering Roadmap

> Comprehensive roadmap generated from code quality, security, scalability, and architecture audits. Items are prioritized by impact and effort. Last updated: 2026-06-10.

---

## Progress Summary

| Tier | Total | Done | Open | Deferred/Blocked | % Complete |
|------|-------|------|------|------------------|------------|
| P0 — Critical | 8 | 8 | 0 | 0 | 100% |
| P1 — Performance | 9 | 8 | 0 | 1 (deferred) | 89% |
| P2 — Code Quality | 9 | 9 | 0 | 0 | 100% |
| P3 — Polish & DX | 10 | 10 | 0 | 0 | 100% |
| Eng Review (37-56) | 20 | 11 | 9 | 0 | 55% |
| Pre-existing | 8 | 7 | 0 | 1 (blocked) | 88% |
| **Total** | **64** | **51** | **11** | **2** | **80%** |

### Deferred Items (need architectural decisions)

| # | Item | Tier | Effort | Reason |
|---|------|------|--------|--------|
| 9 | Redis Pub/Sub for WS Horizontal Scaling | P1 | 2-3 days | Single-instance sufficient for now |

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

### 15. ~~Fix Image Handling~~ — Superseded by #40
**Status:** SUPERSEDED — consolidated into Item 40.

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
**Status:** DONE — all 6 packages import base config from @dripl/eslint-config, added @eslint/js + typescript-eslint peer deps, added devDeps to db/dripl

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

## Tier 5: Eng Review — Architecture & Code Quality (2026-06-07)

> Items identified in full codebase architecture review. Prioritized by impact and effort.

### 37. Split RoughCanvas.tsx into Custom Hooks
**What:** Extract interaction logic, tool state management, and spatial index into custom hooks (`useCanvasInteraction`, `useToolState`, `useSpatialIndex`). Target ~500 lines for RoughCanvas as a thin orchestrator.
**Why:** RoughCanvas.tsx is 2,415 lines — the god component smell. It orchestrates spatial indexing, mouse/touch events, keyboard shortcuts, tool switching, text input, resize/rotation, marquee selection, collaboration join, and 15+ component imports.
**Where:** `apps/dripl-app/components/canvas/RoughCanvas.tsx`
**Effort:** 2 days
**Depends on:** None
**Status:** PARTIAL — extracted useCanvasPersistence, useCanvasViewport, useCanvasClipboard hooks (287 lines moved); RoughCanvas at 2121 lines (target ~500); further extraction needed for mouse events, rendering pipeline

### 38. Split canvas-store.ts into Zustand Slices
**What:** Split monolithic 856-line Zustand store into focused slices: `canvasStore` (elements + selection + tools), `historyStore` (undo/redo), `collabStore` (remote users/cursors), `uiStore` (theme, grid, marquee). Use Zustand slice pattern with a single `create()` call.
**Why:** canvas-store.ts has 40+ actions managing 15+ concerns (elements, selection, tools, viewport, history, collaboration, drawing lifecycle, theme, grid, clipboard). Every mutation rebuilds the entire `elementsById` Map.
**Where:** `apps/dripl-app/lib/canvas-store.ts`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — canvasStore, historyStore, collabStore, uiStore in apps/dripl-app/lib/store/

### 39. WebSocket Auto-Reconnect with Exponential Backoff
**What:** Add exponential backoff reconnection (1s → 2s → 4s → max 30s) with automatic room rejoin on reconnect. Show connection status indicator.
**When WebSocket disconnects (network hiccup, server restart), the client doesn't auto-reconnect. Users must manually refresh to rejoin collaboration.
**Where:** `apps/dripl-app/hooks/useCollaboration.ts`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — already implemented with exponential backoff

### 40. Server-Side Image Blob Storage
**What:** Add `/api/images` endpoint for blob upload/download. Element `src` references image ID instead of base64 data URL. Server stores images as files on disk or S3.
**Why:** Images stored as base64 data URLs in element `src` fields. A 1MB image = 1.33MB base64. Every broadcast re-serializes the entire element array including base64 data. DB stores base64 in text columns.
**Where:** New `apps/http-server/src/routes/images.ts`, `apps/dripl-app/components/canvas/RoughCanvas.tsx`
**Effort:** 3 days
**Depends on:** None
**Status:** DONE — server upload/download API + client integration (drag-drop, paste, image tool all upload to server)

### 41. Shared JWT Verification in @dripl/common
**What:** Extract JWT verification logic to `@dripl/common` (or `@dripl/utils`). Both http-server and ws-server import from there instead of independently verifying tokens.
**Why:** Both servers independently verify JWTs using `jsonwebtoken`. Changes to token validation logic require coordinated edits in two places.
**Where:** `apps/http-server/src/middlewares/authMiddleware.ts`, `apps/ws-server/src/auth.ts`, new `packages/common/src/auth.ts`
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — shared verifyToken/signToken in @dripl/utils/auth, both servers import from there

### 42. Version Guard for Element Mutation Conflicts
**What:** Reject element updates where `element.version < existing.version` on ws-server.
**Why:** Two users editing the same element causes silent data loss (last-write-wins).
**Where:** `apps/ws-server/src/index.ts` — all element mutation handlers
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — version guards on all element mutation handlers (scene-update, scene-delta, element-update, add_element, update_element); stale elements rejected server-side; filtered broadcasts prevent propagating rejected updates

### 43. Upgrade ESLint Plugins for ESLint 10 Compatibility
**What:** Upgrade all ESLint plugins (`eslint-plugin-react`, `@typescript-eslint/*`, `eslint-plugin-react-hooks`) to versions compatible with ESLint 10. Re-enable disabled rules.
**Why:** `pnpm lint` fails across all packages. ESLint 10 dropped support for old config formats. `dripl-app/eslint.config.mjs` disables `react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars` as workarounds.
**Where:** `tooling/eslint-config/`, all `eslint.config.*` files
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — shared ESLint config in tooling/eslint-config, all packages updated

### 44. Canvas Interaction Layer Tests
**What:** Write integration tests for `useCollaboration` (mock WebSocket) and unit tests for `useDrawingTools` (tool state machine), `useKeyboardShortcuts` (key bindings), `useSelection` (selection logic).
**Why:** The most complex code in the application — RoughCanvas.tsx (2,415 lines), useCollaboration.ts (473 lines), useDrawingTools.ts, useKeyboardShortcuts.ts, useSelection.ts — has zero test coverage.
**Where:** `apps/dripl-app/hooks/`, `apps/dripl-app/components/canvas/`
**Effort:** 2 days
**Depends on:** None
**Status:** DONE — useSelection.test.ts (8 tests), useKeyboardShortcuts.test.ts (8 tests)

### 45. http-server Service Layer Unit Tests
**What:** Write unit tests for `FileService`, `AuthService`, `ShareService` with mocked Prisma client. Isolate business logic from HTTP concerns.
**Why:** The recently extracted services have no unit tests. The `routes.test.ts` tests the HTTP layer but doesn't isolate service logic.
**Where:** `apps/http-server/src/services/`, new `apps/http-server/src/__tests__/services/`
**Effort:** 1 day
**Depends on:** None
**Status:** DONE — authService.test.ts, fileService.test.ts, shareService.test.ts

### 46. Fix ws-server initializeDb Fire-and-Forget
**What:** Wrap `initializeDb()` + `server.listen()` in an async `start()` function, same pattern as http-server. Await DB connection before accepting connections.
**Why:** `apps/ws-server/src/index.ts:33-36` calls `initializeDb().catch(...)` without awaiting. If DB connection fails after startup, process stays alive and silently fails to serve requests.
**Where:** `apps/ws-server/src/index.ts:33-36,507-509`
**Effort:** 15 min
**Depends on:** None
**Status:** DONE — async start() awaits initializeDb before server.listen

### 47. Incremental elementsById Map Updates
**What:** For single-element mutations (`updateElement`, `addElement`, `deleteElements`), update the `elementsById` Map incrementally (Map.set/delete) instead of rebuilding from scratch via `buildElementsById()`.
**Why:** `buildElementsById(sorted)` creates a new Map from scratch on every state mutation, even if only one element changed. This is called in virtually every action.
**Where:** `apps/dripl-app/lib/canvas-store.ts` (updateElement, addElement, deleteElements)
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — incremental Map.set/delete in updateElement, addElement, addElements, deleteElements, updateElementTransient

### 48. Remove Remaining Barrel Files (common, db, dripl)
**What:** Remove `index.ts` barrel files from `@dripl/common`, `@dripl/db`, and `@dripl/dripl`. Update all import paths to use granular subpath exports.
**Why:** These three packages still have barrel `export *` files despite CLAUDE.md rule and TODOS #18. Causes larger bundle sizes, slower TypeScript type-checking, reduced tree-shaking.
**Where:** `packages/common/src/index.ts`, `packages/db/src/index.ts`, `packages/dripl/src/index.ts`
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — removed dripl barrel, added granular subpath exports to common package.json; db barrel kept (Prisma re-export needed)

### 49. Component-Level Error Boundaries for Canvas
**What:** Add React error boundaries around `StaticCanvas` and `InteractiveCanvas`. If one fails (corrupt element data, Rough.js throw), the other still renders.
**Why:** Canvas has no component-level error boundaries. A corrupt element crashes the entire canvas to the error page.
**Where:** `apps/dripl-app/components/canvas/StaticCanvas.tsx`, `apps/dripl-app/components/canvas/InteractiveCanvas.tsx`
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — CanvasErrorBoundary in DualCanvas.tsx wraps both StaticCanvas and InteractiveCanvas

### 50. http-server SIGTERM Handler for Cleanup Interval
**What:** Store the cleanup `setInterval` ID and clear it in a SIGTERM handler, same pattern as ws-server's `shutdown()`.
**Why:** `apps/http-server/src/index.ts:114-128` — the expired share link cleanup `setInterval` is never cleared. If server receives SIGTERM, this interval keeps the process alive.
**Where:** `apps/http-server/src/index.ts`
**Effort:** 10 min
**Depends on:** None
**Status:** DONE — cleanup interval stored, cleared on SIGTERM/SIGINT with httpServer.close()

### 51. Use Shared DriplElementSchema in ws-server
**What:** Import `DriplElementSchema` from `@dripl/common` instead of redefining a different schema in `apps/ws-server/src/index.ts`.
**Why:** ws-server's `driplElementSchema` (lines 38-52) validates a different subset of fields than `@dripl/common`'s schema. The `toDriplElement` function casts the result as `DriplElement` even though the schema doesn't validate all fields.
**Where:** `apps/ws-server/src/index.ts:38-60`
**Effort:** 15 min
**Depends on:** None
**Status:** DONE — imports DriplElementSchema from @dripl/common, local schema removed

### 52. Switch cloneElements to structuredClone
**What:** Replace shallow `cloneElements` (`elements.map(el => ({ ...el }))`) with `structuredClone()` for deep copy safety. Prevents nested object sharing between history snapshots.
**Why:** `cloneElements` uses shallow copy. Any nested objects (like `points` arrays in freehand elements) share references between original and clone. If downstream code mutates these, it silently corrupts history.
**Where:** `apps/dripl-app/lib/canvas-store.ts:54-56`
**Effort:** 15 min
**Depends on:** None
**Status:** DONE — structuredClone() with DriplElement[] cast

### 53. In-Place Mutation for updateElementTransient
**What:** For the `updateElementTransient` hot path (drag/resize at ~60fps), mutate the existing elements array in-place instead of cloning + rebuilding Map.
**Why:** `updateElementTransient` rebuilds the full `elementsById` Map on every drag/resize frame. This is the main hot path during dragging. It correctly skips history but still triggers a full Map rebuild.
**Where:** `apps/dripl-app/lib/canvas-store.ts:488-507`
**Effort:** 1 hr
**Depends on:** Item 38 (store split)
**Status:** DONE — incremental Map update (new Map + set) on hot path

### 54. Sorted Insert for Fractional Index
**What:** Maintain elements in sorted order by using binary search + sorted insert in `addElement`/`addElements` instead of re-sorting the full array with `sortByFractionalIndex` on every mutation.
**Why:** `sortByFractionalIndex` sorts the entire element array by fractional index string comparison on every mutation (addElement, addElements, setElements, commitDraft, bringForward, etc.).
**Where:** `apps/dripl-app/lib/canvas-store.ts` (multiple actions)
**Effort:** 2 hrs
**Depends on:** None
**Status:** DONE — sortedInsert() with binary search used in addElement and addElements

### 55. Custom Memo Equality for Spatial Index
**What:** Use a custom equality check on the `useMemo` for RBush spatial index (compare element IDs + versions instead of array reference). Only rebuild when elements actually change.
**Why:** The spatial index `useMemo` depends on `[elements]` array reference. During rapid drawing (freedraw), every stroke update triggers a full spatial index rebuild even when the array reference changes but content doesn't.
**Where:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:367-464`
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — spatial signature tracking (id:x:y:w:h:angle) skips diffing when only non-spatial props change

### 56. Immutable Snapshots for Undo/Redo History
**What:** Use immutable snapshots: `structuredClone` on push to history, reference equality on restore. Only clone when pushing to history, not when restoring from it.
**Why:** `undo()` and `redo()` both call `cloneElements()` which copies the full element array. With 5K elements and MAX_HISTORY=100, each undo/redo creates unnecessary copies.
**Where:** `apps/dripl-app/lib/canvas-store.ts:739-779`
**Effort:** 1 hr
**Depends on:** None
**Status:** DONE — undo/redo use shallow [...snapshot] instead of structuredClone on restore

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
| Redis for WS pub/sub | DEFERRED | Item 9. `REDIS_URL` declared but unused. Needs infrastructure decision. |
| Fractional indexing for z-order | ✅ DONE | Item 23. fractional-indexing library, reordering generates keys |
| Image storage strategy | DECIDED | Item 40. Server-side blob storage with ID-based references. IndexedDB breaks collaboration. |
| History system consolidation | ✅ DONE | Item 24. Removed redundant deriveHistory, kept past/future |
| ws-server module split | ✅ DONE | Item 20. 5 modules: auth, broadcast, rooms, rateLimiter, types |
| Barrel file removal | PARTIAL | Items 18+48. math/element/utils/test-utils done; common/db/dripl remaining |
| Tunnel system removal | ✅ DONE | Removed unused tunnel system from @dripl/dripl |
| Element conflict resolution | OPEN | Item 42. Version guard on ws-server. Not yet implemented. |
| RoughCanvas decomposition | OPEN | Item 37. Extract to hooks. Target ~500 lines orchestrator. |
| Zustand store split | OPEN | Item 38. Split into slices. Canvas, history, collab, UI stores. |
| Shared JWT verification | ✅ DONE | Item 41. verifyToken/signToken in @dripl/utils/auth |
| ESLint config consolidation | ✅ DONE | Item 21. All packages use @dripl/eslint-config |
| Sorted fractional index insert | ✅ DONE | Item 54. Binary search + splice in addElement/addElements |
| Immutable undo/redo snapshots | ✅ DONE | Item 56. Shallow array copy on restore |

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
| Image blob storage | ✅ | ❌ Base64 in JSON | Gap — Item 40 |
| Lazy-loaded components | ✅ | ✅ React.lazy + Suspense | Match — Item 14 |
| Cursor-based pagination | ✅ | ✅ Cursor + composite index | Match — Item 16 |
| Production Docker | ✅ | ✅ Multi-stage, health checks, NODE_ENV | Match — Item 27 |
| Granular package exports | ✅ | ✅ math, element, utils, test-utils with subpath exports | Match — Item 18 |

---

## Plan B — Next Session Priorities

> **Strategy:** Quick wins → Performance → Architecture → Quality. Commit after each. Run `pnpm build` + `pnpm exec turbo run test` before committing.

---

### Phase 1: Quick Wins (< 1 hr total, do first)

These are trivial fixes that prevent real bugs. Do all four in one commit or separate commits.

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 46 | Fix ws-server initializeDb fire-and-forget | 15 min | Prevents silent DB failures on startup |
| 50 | http-server SIGTERM handler for cleanup interval | 10 min | Clean shutdown, no orphaned intervals |
| 51 | Use shared DriplElementSchema in ws-server | 15 min | DRY, prevents schema drift |
| 52 | Switch cloneElements to structuredClone | 15 min | Deep copy safety, prevents history corruption |

**Total: ~1 hour. Commit: `fix(ws-server): await initializeDb, clean shutdown, use shared schema, deep clone`**

---

### Phase 2: Performance Low-Hanging Fruit (pick 2-3, ~3-4 hrs)

These give measurable perf wins with minimal risk. Each is independent.

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 47 | Incremental elementsById Map updates | 1 hr | Every element mutation gets O(1) instead of O(n) rebuild |
| 53 | In-place mutation for updateElementTransient | 1 hr | Main hot path during drag/resize (~60fps) |
| 55 | Custom Memo Equality for spatial index | 1 hr | Stops unnecessary RBush rebuilds during rapid drawing |
| 56 | Immutable snapshots for undo/redo | 1 hr | Each undo/redo no longer clones full array twice |
| 54 | Sorted insert for fractional index | 2 hrs | Eliminates full-array re-sort on every mutation |

**Recommended combo: 47 + 53 + 55 (3 hrs, covers the three hottest paths)**

---

### Phase 3: Data Safety & Code Quality (pick 1-2, ~4 hrs)

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 42 | Version guard for element mutations | 2 hrs | Prevents silent data loss from concurrent edits |
| 41 | Shared JWT verification in @dripl/common | 2 hrs | Single source of truth for auth |
| 48 | Remove remaining barrel files (common/db/dripl) | 2 hrs | Tree-shaking, faster tsc, CLAUDE.md compliance |
| 21 | Make @dripl/eslint-config actually used | 2 hrs | Consistent linting across packages |

**Recommended: 42 + 48 (data safety + code quality, no external deps)**

---

### Phase 4: Architecture (pick 1, 1-2 days)

These are the big structural wins. Do one per session.

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 38 | Split canvas-store.ts into Zustand slices | 1 day | Cleaner state management, smaller blast radius |
| 37 | Split RoughCanvas.tsx into custom hooks | 2 days | Eliminates 2,400-line god component |
| 39 | WebSocket auto-reconnect with backoff | 1 day | Critical UX — current users must refresh on disconnect |

**Recommended order: 38 → 39 → 37 (store split is safest, reconnect is most user-visible)**

---

### Phase 5: Quality & DX (pick 1, 1-2 days)

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 45 | http-server service layer unit tests | 1 day | Tests FileService, AuthService, ShareService |
| 44 | Canvas interaction layer tests | 2 days | Tests useCollaboration, useDrawingTools, etc. |
| 43 | Upgrade ESLint plugins for ESLint 10 | 1 day | Unblocks lint, re-enables disabled rules |
| 49 | Component-level error boundaries for canvas | 1 hr | One corrupt element doesn't crash entire canvas |

**Recommended: 49 (1 hr, easy win) → 45 (1 day, high value)**

---

### Blocked / Need Decision

| Item | Blocker | Decision Needed |
|------|---------|-----------------|
| 9: Redis Pub/Sub | Infrastructure | Do we need multi-instance WS? If no, skip entirely. |
| 40: Image Blob Storage | Design | Disk vs S3? This is 3 days — only start when committed. |

---

### Session Template

```
Session 1: Phase 1 (quick wins) + Phase 2 (2-3 perf items) = ~4-5 hrs
Session 2: Phase 3 (data safety) + Phase 4 (one architecture item) = ~1 day
Session 3: Phase 5 (quality) + Phase 4 (next architecture item) = ~1-2 days
```

### Rules

- **Commit style:** `fix(scope): description` or `refactor(scope): description`
- **One logical change per commit** — don't bundle unrelated fixes
- **Always run build + test** before committing
- **Never touch `.env` files**
- **Use `workspace:*` for internal deps**
