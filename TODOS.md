# Dripl — Engineering TODOs

> Generated from comprehensive engineering review (May 2026). Items are prioritized by impact and effort.

---

## Tier 1: Critical (Security, Data Loss, Core Functionality)

### 1. Horizontal Scaling for ws-server
**What:** Add Redis pub/sub for multi-instance WebSocket server support.
**Why:** `rooms` Map is in-process memory. Cannot scale beyond 1 server. Two users on different instances can't collaborate.
**Pros:** Enables production-scale deployment, load balancing, zero-downtime deploys.
**Cons:** Adds Redis dependency, significant architectural change (~500+ lines).
**Context:** Current: `const rooms = new Map<string, RoomState>()` in `ws-server/src/index.ts:109`. Need Redis pub/sub for cross-instance broadcast + Redis for shared room state.
**Depends on:** Infrastructure decision (Redis vs alternative).

### 2. Diff-based Element Broadcasting
**What:** Replace full element array broadcast with operational delta (added/updated/deleted).
**Why:** `broadcastElements` sends ALL elements on every change. For 1000-element canvas, every stroke transmits 1000 elements over WebSocket.
**Pros:** 90%+ bandwidth reduction, faster collaboration, lower server CPU.
**Cons:** Requires conflict resolution strategy, adds complexity to element tracking.
**Context:** `apps/dripl-app/hooks/useCollaboration.ts:149-155`. Current: `pendingElementsRef.current = nextElements` → full array send.
**Depends on:** None.

### 3. Comprehensive Test Coverage for ws-server
**What:** Integration tests for WebSocket message handling, room lifecycle, auth, rate limiting, shutdown.
**Why:** 678-line server had ZERO tests before this review. Only validation schemas are now tested (65 tests).
**Pros:** Catches data loss bugs, race conditions, auth bypasses before production.
**Cons:** Requires WebSocket test harness setup, mock DB.
**Context:** `apps/ws-server/src/index.ts`. Needs: join/leave flow, element CRUD, scene-update, rate limiting, heartbeat, graceful shutdown, concurrent joins.
**Depends on:** `ws-server/vitest.config.ts` (created).

### 4. Test Coverage for http-server Auth & File Routes
**What:** Integration tests for auth.ts (551 lines) and files.ts (502 lines) using Supertest.
**Why:** Security-critical endpoints (login, register, password reset, file CRUD, encryption) have zero happy-path tests.
**Pros:** Prevents auth bypass, data loss, IDOR vulnerabilities.
**Cons:** Requires test DB setup, Prisma test instance.
**Context:** `apps/http-server/src/routes/auth.ts`, `apps/http-server/src/routes/files.ts`. Current test only validates Zod schemas, not actual DB operations.
**Depends on:** Test DB infrastructure.

### 5. Canvas Renderer Tests
**What:** Unit tests for `apps/dripl-app/renderer/interactiveScene.ts` (724 lines).
**Why:** Entire canvas render engine is untested. 12 render functions, visibility culling, selection, marquee, collaborator cursors.
**Pros:** Catches rendering regressions, broken culling, selection bugs.
**Cons:** Requires Canvas 2D context mocking, complex test fixtures.
**Context:** `apps/dripl-app/renderer/interactiveScene.ts`. Each render function (rectangle, ellipse, diamond, path, text, image, grid, selection, marquee, collaborators, locks) needs at least one test.
**Depends on:** Canvas mock utility.

---

## Tier 2: High Priority (Core UX Features)

### 6. Test Infrastructure: @dripl/test-utils Package
**What:** Shared test utilities package with element factories, user factories, mock Canvas 2D, mock WebSocket.
**Why:** Every test creates 60-line inline element objects. No shared fixtures, no mock utilities.
**Pros:** Faster test writing, consistent fixtures, less boilerplate.
**Cons:** New package to maintain.
**Context:** Need: `createTestElement({ type: 'rectangle', x: 0, y: 0 })`, `createTestUser()`, `createTestFile()`, `mockCanvasContext()`, `mockWebSocketServer()`.
**Depends on:** None.

### 7. Element Resize Tests
**What:** Tests for `packages/element/src/resizeElements.ts` (457 lines).
**Why:** Complex resize logic with rotation, aspect ratio, text wrapping — zero tests.
**Pros:** Catches broken resize behavior, text sizing bugs.
**Cons:** Requires Canvas 2D mock for text measurement.
**Context:** `packages/element/src/resizeElements.ts`. Test all handle directions, rotation, aspect ratio lock, text auto-resize.
**Depends on:** Item 6 (test utils).

### 8. Hit Detection Tests
**What:** Tests for `packages/math/src/hit-detection.ts` (158 lines).
**Why:** Point-in-element, selection rect, element-at-point logic — zero tests.
**Pros:** Catches broken selection, hit testing bugs.
**Cons:** Minimal.
**Context:** `packages/math/src/hit-detection.ts`. Test: point in rect/ellipse/diamond, point on rotated element, selection rect intersection, element-at-point with overlapping elements.
**Depends on:** None.

### 9. Collaboration Hook Tests
**What:** Tests for `apps/dripl-app/hooks/useCollaboration.ts` (392 lines).
**Why:** WebSocket client: reconnection, heartbeat, element broadcasting, cursor sync — zero tests.
**Pros:** Catches broken collaboration, reconnection bugs, race conditions.
**Cons:** Requires WebSocket mock, Zustand store mock.
**Context:** `apps/dripl-app/hooks/useCollaboration.ts`. Test: join room, receive elements, broadcast changes, reconnect, cursor throttling, room ID changes.
**Depends on:** Item 6 (test utils).

### 10. Auth Middleware Tests
**What:** Tests for `apps/http-server/src/middlewares/authMiddleware.ts` and `csrfMiddleware.ts`.
**Why:** JWT verification, cookie handling, CSRF protection — zero tests.
**Pros:** Catches auth bypass, CSRF vulnerabilities.
**Cons:** Minimal.
**Context:** Test: valid token, expired token, missing token, cookie vs header, CSRF valid/missing/mismatched, safe methods bypass.
**Depends on:** None.

### 11. Encryption Utility Tests
**What:** Tests for `packages/utils/src/encryption/` (~100 lines).
**Why:** AES-GCM encryption/decryption for share links — zero tests. If broken, share links leak data or fail to decrypt.
**Pros:** Critical security validation.
**Cons:** Minimal.
**Context:** `packages/utils/src/encryption/crypto.ts`, `url.ts`. Test: encrypt/decrypt round-trip, URL key extraction, key rotation, malformed ciphertext.
**Depends on:** None.

---

## Tier 3: Medium Priority (Code Quality, Performance)

### 12. RBush Incremental Rebuild
**What:** Replace full RBush tree rebuild with incremental insert/remove.
**Why:** `RoughCanvas.tsx:322-339` rebuilds entire spatial index on every elements change. O(n log n) per update.
**Pros:** Faster renders for large canvases.
**Cons:** More complex state management, need to track element diffs.
**Context:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:322-339`. Current: `useMemo(() => { tree.load(items) }, [elements])`.
**Depends on:** None.

### 13. Zustand Store Split
**What:** Split 782-line monolith store into focused stores (canvas, history, collab, UI).
**Why:** Single store holds everything: elements, selection, tools, theme, zoom/pan, history, clipboard, remote users, cursors, locks, grid, file metadata, room state.
**Pros:** Better performance (fewer re-renders), testable in isolation, clearer boundaries.
**Cons:** Breaking change for all consumers, migration effort.
**Context:** `apps/dripl-app/lib/canvas-store.ts`. Split into: `canvas-store` (elements, selection, tools, zoom/pan), `history-store` (undo/redo), `collab-store` (remote users, cursors, locks), `ui-store` (theme, grid, modals).
**Depends on:** None.

### 14. Service Layer for http-server
**What:** Extract business logic into service classes (FileService, AuthService, RoomService).
**Why:** Controllers talk directly to Prisma. Business logic like "create file with folder ownership check" lives in route files.
**Pros:** Testable business logic, reusable across routes, cleaner controllers.
**Cons:** More files, indirection.
**Context:** `apps/http-server/src/routes/files.ts` has `ensureFolderOwnership`, `parseStoredFileContent`, `serializeStoredFileContent` inline. Move to `FileService`.
**Depends on:** None.

### 15. WebSocket Protocol Abstraction
**What:** Replace giant switch statement with handler registry pattern + middleware chain.
**Why:** `ws-server/src/index.ts:366-573` handles all message types inline. No middleware chain (auth → rate limit → validate → handle).
**Pros:** Easier to add new message types, testable handlers, consistent validation.
**Cons:** Architectural change, refactoring effort.
**Context:** `apps/ws-server/src/index.ts`. Create: `MessageHandler` interface, `HandlerRegistry`, middleware chain for WS messages.
**Depends on:** None.

### 16. Image Cache LRU Optimization
**What:** Replace O(n) `indexOf`/`splice` with Map-based LRU.
**Why:** `packages/element/src/image-cache.ts:102-108` uses array operations for access order tracking.
**Pros:** O(1) LRU operations, faster cache hits.
**Cons:** Slightly more complex implementation.
**Context:** `packages/element/src/image-cache.ts`. Use `Map` (preserves insertion order) instead of array for access tracking.
**Depends on:** None.

### 17. RAF Loop Optimization
**What:** Cancel RAF loop when not dirty, restart when dirty.
**Why:** `StaticCanvas.tsx:113-147` fires `requestAnimationFrame` 60fps even when nothing changes.
**Pros:** Better battery life, lower CPU usage.
**Cons:** Need to track dirty state transitions carefully.
**Context:** `apps/dripl-app/components/canvas/StaticCanvas.tsx:113-147`.
**Depends on:** None.

### 18. Cursor Interpolation Optimization
**What:** Use ref-based approach instead of creating new Map every animation frame.
**Why:** `useInterpolatedCursors.ts:79-81` creates new Map every frame when cursors move.
**Pros:** Less GC pressure, smoother cursor rendering.
**Cons:** More complex state management.
**Context:** `apps/dripl-app/hooks/useInterpolatedCursors.ts`.
**Depends on:** None.

---

## Tier 4: Low Priority (Cleanup, Polish)

### 19. Remove Legacy Canvas Implementation
**What:** Delete `apps/dripl-app/hooks/useCanvas.ts` if it's superseded by RoughCanvas architecture.
**Why:** Dual canvas implementations exist. Legacy `useCanvas` renders ALL elements every change with no viewport culling.
**Pros:** Less confusion, smaller bundle.
**Cons:** Risk of breaking something if it's still referenced.
**Context:** Verify `useCanvas` is not used anywhere before deleting.
**Depends on:** Code audit.

### 20. Single History System
**What:** Pick one history implementation and remove the other two.
**Why:** Three separate history systems: `@dripl/common` (SceneHistory + DeltaManager), `@dripl/dripl` store history, `@dripl/dripl/src/utils/history.ts` (CanvasHistory).
**Pros:** Less confusion, consistent undo/redo behavior.
**Cons:** Migration effort, need to pick the right one.
**Context:** Evaluate which system is most complete and migrate to it.
**Depends on:** Decision on which system to keep.

### 21. Password Reset Token Atomicity
**What:** Use Prisma transaction to delete token and update password atomically.
**Why:** `auth.ts:337-376` deletes token AFTER password update. If update fails, token is gone but password unchanged.
**Pros:** Prevents lost password reset attempts.
**Cons:** Minimal.
**Context:** `apps/http-server/src/routes/auth.ts:354-363`. Wrap in `db.$transaction([...])`.
**Depends on:** None.

### 22. Connection Draining on ws-server Shutdown
**What:** Wait for pending saves to complete before `process.exit(0)`.
**Why:** `ws-server/src/index.ts:648-671` saves rooms fire-and-forget. If one takes 5 seconds and process exits after 2, data is lost.
**Pros:** Prevents data loss on deploy/restart.
**Cons:** Adds shutdown delay.
**Context:** `apps/ws-server/src/index.ts:648-671`. Use `Promise.all` with timeout.
**Depends on:** None.

### 23. Docker Production Hardening
**What:** Fix Dockerfiles to use production builds, not `pnpm run dev`. Remove hardcoded credentials from docker-compose.
**Why:** Dockerfiles use `CMD pnpm run dev` and `NODE_ENV=development`. docker-compose has hardcoded `POSTGRES_PASSWORD: dripl`.
**Pros:** Production-ready containers, security.
**Cons:** Separate deployment concern.
**Context:** `docker/Dockerfile.*`, `docker-compose.yml`.
**Depends on:** None.

### 24. Response Cache Headers
**What:** Add `Cache-Control` / `ETag` headers to GET endpoints.
**Why:** `getFiles`, `getRoom` don't set cache headers. Browser re-fetches on every navigation.
**Pros:** Faster page loads, less server load.
**Cons:** Cache invalidation complexity.
**Context:** `apps/http-server/src/controllers/fileController.ts`, `roomController.ts`.
**Depends on:** None.

### 25. E2E Tests (Playwright)
**What:** End-to-end tests for critical user flows.
**Why:** No E2E tests exist. Critical flows (register → create canvas → draw → collaborate) are untested end-to-end.
**Pros:** Catches integration bugs, regression safety.
**Cons:** Heavy infrastructure, slow CI.
**Context:** Flows: auth, canvas creation, drawing, collaboration, share links, export.
**Depends on:** Items 3, 4 (unit test foundation).

---

## Pre-existing Issues (Not Introduced by Review)

### P1. @dripl/common Test UUID Failures
Tests in `packages/common/src/actions.test.ts` and `schemas.test.ts` use non-UUID IDs (`"elem-1"`) while Zod schemas now require UUIDs. Tests need fixture updates.

### P2. @dripl/common Test FileSchema Failures
`packages/common/src/schemas.test.ts:244` — FileSchema requires `preview`, `folderId`, `teamId`, `userId` but test fixtures omit them.

### P3. Dockerfile References Missing @dripl/runtime
All three Dockerfiles reference `packages/runtime/package.json` which doesn't exist. Docker builds will fail.

### P4. Package Manager Inconsistency
Root declares `packageManager: "pnpm@10.33.0"` but `bun.lock` file exists. CLAUDE.md says "use bun" but scripts use pnpm.

### P5. TypeScript Version Mismatch
Root: `typescript ^6.0.3`, dripl-app: `^5.9.3`, @dripl/dripl: `5.9.2`, some packages: `latest`.

### P6. ESLint Disables Important Rules
`apps/dripl-app/eslint.config.mjs` disables `react-hooks/exhaustive-deps`, `react-hooks/refs`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars`.

### P7. Canvas.tsx God Component (1568 lines)
`apps/dripl-app/components/canvas/Canvas.tsx` contains entire canvas application logic. Partial extractions exist (`CanvasBootstrap.tsx`, `useCanvas.ts`) but main component still has duplicated logic.

### P8. Three History Systems
`@dripl/common` (SceneHistory + DeltaManager), `@dripl/dripl` store history, `@dripl/dripl/src/utils/history.ts` (CanvasHistory). All three exist, only one is actively used.

### P9. Tunnel System Over-engineering
`@dripl/dripl/src/tunnel/` has 10+ components for 4 tunnels. Could be simple React context.

### P10. proxy.ts No-op
`apps/dripl-app/proxy.ts` just calls `NextResponse.next()`. Either implement or remove.

### P11. UseCollaborationReturn Missing disconnect
`apps/dripl-app/hooks/useCollaboration.ts:77-85` — Interface didn't include `disconnect` method that was returned. Fixed.

### P12. createPortal Imported from Wrong Module
`apps/dripl-app/components/dashboard/FileBrowser.tsx:3` — `createPortal` imported from `'react'` instead of `'react-dom'`. Fixed.

### P13. handleSubmit Event Type Mismatch
`apps/dripl-app/app/signup/page.tsx:23`, `login/page.tsx:22` — `handleSubmit` required `React.FormEvent` but retry callback called without event. Made event optional. Fixed.

### P14. AI Route Unknown Type Arithmetic
`apps/dripl-app/app/api/ai/generate/route.ts:168` — `el.x` typed as `unknown` used in arithmetic. Added `Number()` casts. Fixed.

### P15. Missing LoadingState Export
`apps/dripl-app/components/ui/ErrorState.tsx` — `LoadingState` component imported by `canvas/page.tsx` but never exported. Added component. Fixed.
