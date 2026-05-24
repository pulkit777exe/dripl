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
**What:** Shared test utilities package with element factories, user factories, mock Canvas 2D.
**Why:** Every test creates 60-line inline element objects. No shared fixtures, no mock utilities.
**Pros:** Faster test writing, consistent fixtures, less boilerplate.
**Cons:** New package to maintain.
**Context:** Need: `createTestElement({ type: 'rectangle', x: 0, y: 0 })`, `createTestUser()`, `createTestFile()`, `mockCanvasContext()`, `mockWebSocketServer()`.
**Depends on:** None.
**Status:** ✅ COMPLETED - Package created with 21 tests covering all factories.

### 7. Element Resize Tests
**What:** Tests for `packages/element/src/resizeElements.ts` (457 lines).
**Why:** Complex resize logic with rotation, aspect ratio, text wrapping — zero tests.
**Pros:** Catches broken resize behavior, text sizing bugs.
**Cons:** Requires Canvas 2D mock for text measurement.
**Context:** `packages/element/src/resizeElements.ts`. Test all handle directions, rotation, aspect ratio lock, text auto-resize.
**Depends on:** Item 6 (test utils).
**Status:** ✅ COMPLETED - 48 tests added covering all resize functions, element types, and edge cases.

### 8. Hit Detection Tests
**What:** Tests for `packages/math/src/hit-detection.ts` (158 lines).
**Why:** Point-in-element, selection rect, element-at-point logic — zero tests.
**Pros:** Catches broken selection, hit testing bugs.
**Cons:** Minimal.
**Context:** `packages/math/src/hit-detection.ts`. Test: point in rect/ellipse/diamond, point on rotated element, selection rect intersection, element-at-point with overlapping elements.
**Depends on:** None.
**Status:** ✅ COMPLETED - 30+ tests added covering all hit detection functions.

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
**Status:** ✅ COMPLETED - 14 tests added for auth and CSRF middleware.

### 11. Encryption Utility Tests
**What:** Tests for `packages/utils/src/encryption/` (~100 lines).
**Why:** AES-GCM encryption/decryption for share links — zero tests. If broken, share links leak data or fail to decrypt.
**Pros:** Critical security validation.
**Cons:** Minimal.
**Context:** `packages/utils/src/encryption/crypto.ts`, `url.ts`. Test: encrypt/decrypt round-trip, URL key extraction, key rotation, malformed ciphertext.
**Depends on:** None.
**Status:** ✅ COMPLETED - 25+ tests added for crypto and URL utilities.

### 12. RBush Incremental Rebuild
**What:** Replace full RBush tree rebuild with incremental insert/remove.
**Why:** `RoughCanvas.tsx:322-339` rebuilds entire spatial index on every elements change. O(n log n) per update.
**Pros:** Faster renders for large canvases.
**Cons:** More complex state management, need to track element diffs.
**Context:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:322-339`. Current: `useMemo(() => { tree.load(items) }, [elements])`.
**Depends on:** None.
**Status:** ✅ COMPLETED - Incremental insert/remove with full rebuild threshold at 40% changes.

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
**Status:** ✅ COMPLETED - Replaced array-based accessOrder with Map-based counter for O(1) updates.

### 17. RAF Loop — One-Shot Bug (Fixed)
**What:** The one-shot RAF loop optimization caused committed elements to never render on StaticCanvas. Reverted to continuous loop matching InteractiveCanvas.
**Why:** StaticCanvas's RAF loop ran once on mount, set `rafRef.current = null`, and stopped. When elements changed later via `commitDraft()`, the other effect set `isDirtyRef.current = true` but no `requestAnimationFrame` was ever scheduled — the re-scheduling mechanism was never implemented. Fix: use continuous RAF (unconditional `requestAnimationFrame(loop)` at end of every frame, same pattern as InteractiveCanvas).
**Context:** `apps/dripl-app/components/canvas/StaticCanvas.tsx:113-150`. Also fixed `packages/element/src/rough-renderer.ts:70-73` — `undefined` backgroundColor passed `fill: undefined` to Rough.js (guard with `backgroundColor ?? 'transparent'`).
**Status:** ✅ FIXED - Continuous RAF loop + undefined backgroundColor guard.

### 18. Cursor Interpolation Optimization
**What:** Use ref-based approach instead of creating new Map every animation frame.
**Why:** `useInterpolatedCursors.ts:79-81` creates new Map every frame when cursors move.
**Pros:** Less GC pressure, smoother cursor rendering.
**Cons:** More complex state management.
**Context:** `apps/dripl-app/hooks/useInterpolatedCursors.ts`.
**Depends on:** None.
**Status:** ✅ COMPLETED - Pass same Map ref to setState, eliminating per-frame allocation.

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
**Status:** ✅ COMPLETED - Both operations now wrapped in Prisma transaction.

### 22. Connection Draining on ws-server Shutdown
**What:** Wait for pending saves to complete before `process.exit(0)`.
**Why:** `ws-server/src/index.ts:648-671` saves rooms fire-and-forget. If one takes 5 seconds and process exits after 2, data is lost.
**Pros:** Prevents data loss on deploy/restart.
**Cons:** Adds shutdown delay.
**Context:** `apps/ws-server/src/index.ts:648-671`. Use `Promise.all` with timeout.
**Depends on:** None.
**Status:** ✅ COMPLETED - Parallel saves with 10s timeout added to shutdown.

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

### 26. StaticCanvas RAF Loop Regression Test
**What:** Vitest test verifying StaticCanvas re-renders (via RAF) when elements prop changes from `[]` to `[element]`.
**Why:** This is the exact regression vector behind the invisible-shapes bug. A test would catch future RAF-loop breakage (one-shot vs continuous, missed re-scheduling, etc.).
**Context:** Test should mount `StaticCanvas` (or test `renderStaticScene` call scheduling), simulate elements update, and assert `renderStaticScene` was called via RAF callback.
**Depends on:** This fix (item 17) being in place first.
**Status:** ✅ COMPLETED — Vitest test mounts StaticCanvas with mock renderStaticScene + fake timers, simulates elements change, asserts re-render via RAF callback. See `apps/dripl-app/src/__tests__/StaticCanvas.test.tsx`.

### 27. Same Content Across Files Bug (Fixed)
**What:** Fix stale Zustand store contamination when navigating between different canvas files in the `/file/[id]` page.
**Why:** The auto-save `useEffect` could capture stale elements from the previous file when `fileId` changes, before React flushes batched state updates (`setLoading(true)`). Additionally, the store retained the previous file's elements, causing a visual flash and potential data bleed.
**Context:** `apps/dripl-app/app/file/[id]/page.tsx`. Two fixes applied:
- Added a `useEffect` that resets store (elements, history, selection, clipboard) and auto-save refs on `fileId` change, preventing stale data from persisting between navigations.
- Added `storeFileId !== fileId` guard to the auto-save effect, preventing saves when the store's fileId doesn't match the URL's fileId (e.g., during the fetch window before `setFileMetadata` is called).
**Depends on:** None.
**Status:** ✅ FIXED

### 28. Arrow Endpoint Handle Rotation (Fixed)
**What:** Apply rotation transforms to arrow/line endpoint handles so they appear at correct visual positions for rotated arrows.
**Why:** SelectionOverlay, interactiveScene, and RoughCanvas all computed arrow endpoint positions without accounting for `el.angle`, causing handles to render at wrong positions and dragging to apply deltas in wrong coordinate space.
**Context:** Three files modified:
- `SelectionOverlay.tsx` — uses `elementLocalPointToWorld` (from `@dripl/math`) to compute handle positions
- `interactiveScene.ts` — uses `elementLocalPointToWorld` for canvas-based handle rendering
- `RoughCanvas.tsx` — uses `inverseRotatePoint` to convert world-space drag delta to local-space delta
**Depends on:** `elementLocalPointToWorld`, `inverseRotatePoint`, `rotatePoint` being exported from `@dripl/math` (item from previous session).
**Status:** ✅ FIXED

---

### 27. error.tsx Tailwind v4 Syntax — Review Notes
**What:** The file `apps/dripl-app/app/error.tsx` uses `bg-(--color-primary)` and `text-(--color-primary-foreground)` syntax.
**Note:** This is valid Tailwind v4 arbitrary value syntax for referencing CSS custom properties. The project uses Tailwind CSS v4 per CLAUDE.md. However, the CSS variables `--color-primary` and `--color-primary-foreground` should be verified to exist in the project's CSS; if undefined, the button renders transparent/invisible. No syntax change needed — this is a design-system consistency concern.
**Status:** ✅ REVIEWED — No change required.

---

## Pre-existing Issues (Not Introduced by Review)

### P1. @dripl/common Test UUID Failures
Tests in `packages/common/src/actions.test.ts` and `schemas.test.ts` use non-UUID IDs (`"elem-1"`) while Zod schemas now require UUIDs. Tests need fixture updates.
**Status:** ✅ FIXED - Recreated test files with proper UUID fixtures.

### P2. @dripl/common Test FileSchema Failures
`packages/common/src/schemas.test.ts:244` — FileSchema requires `preview`, `folderId`, `teamId`, `userId` but test fixtures omit them.
**Status:** ✅ FIXED - Updated test fixtures with correct nullable fields.

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

---

## Tier 5: Architecture Gaps — Excalidraw Parity (Canvas Internals)

> These issues were identified by comparing Dripl's rendering, caching, selection, and z-ordering systems against Excalidraw's proven dual-canvas architecture. Each gap represents a real correctness or performance problem.

---

### 29. ShapeCache Uses Plain `Map` — Unbounded Memory Leak
**What:** `packages/element/src/shape-cache.ts` uses a `Map<string, Drawable>` keyed by `${id}:${version}`. Old entries from previous versions of the *same element* are never evicted — they accumulate indefinitely. The `pruneShapeCache(5000)` runs only every 1000 insertions and evicts by insertion order, not by staleness.
**Why:** Excalidraw uses a `WeakMap<ExcalidrawElement, shape>` keyed on the element *object reference*. When an element is replaced (immutable update), the old object is GC'd and the cache entry disappears automatically. No pruning needed.
**Problem in Dripl:** After 100 undo/redo operations on a 200-element canvas, the cache holds ~20,000 dead entries. Each Rough.js `Drawable` retains its full path data (several KB). This silently grows memory until the tab crashes.
**Fix:** Replace `Map<string, Drawable>` with a version-checked `Map<string, { shape, version }>` keyed by element ID only. On cache lookup, compare `element.version` — if stale, delete and regenerate. Alternatively, adopt `WeakMap` if element object identity is stable enough (it is for committed elements).
**Context:** `packages/element/src/shape-cache.ts:14`, `rough-renderer.ts:179-186`.
**Depends on:** None.
**Status:** ✅ FIXED — Cache is now keyed by `element.id` (not `id:version`). Lookup compares stored `version` and `theme`; stale entries are deleted on first miss. One entry per element, no accumulation.

### 30. No Theme-Aware Shape Cache Invalidation
**What:** Shape cache (`shape-cache.ts`) does not store or check the `theme` that was active when the shape was generated. When the user toggles dark/light mode, cached shapes still use the old theme's colors (especially dark-mode filter adjustments for stroke colors).
**Why:** Excalidraw stores `{ shape, theme }` in `ShapeCache.cache` and returns a cache miss if `theme !== cachedTheme` (shape.ts:91-97). This guarantees shapes are regenerated after a theme switch.
**Fix:** Add `theme` to the cache value and to the cache-hit check. Call `clearAllShapeCache()` on theme change as a fallback.
**Context:** `packages/element/src/shape-cache.ts:28-30` (no theme parameter), `rough-renderer.ts:131` (theme parameter exists but is never used for cache keying).
**Depends on:** None.
**Status:** ✅ FIXED — `CacheEntry` now stores `{ shape, version, theme }`. Cache hit requires both version and theme to match. `setTheme()` in `canvas-store.ts` calls `clearAllShapeCache()` for an instant full flush on theme switch.

### 31. Element Canvas Cache Uses String `versionKey` — O(n) Serialization Per Element Per Frame
**What:** `packages/element/src/staticScene.ts:37-72` builds a `versionKey` string by concatenating ~18 properties (including `JSON.stringify(points)` for linear elements). This runs for every visible element on every frame that could potentially be dirty.
**Why:** Excalidraw uses a `WeakMap<ExcalidrawElement, canvas>` for element-canvas caching. Cache validity is checked via object identity — since elements are immutably replaced on mutation, a new object reference = cache miss. No serialization needed.
**Fix:** Replace the string-based `makeVersionKey` with a version-number check: store `{ canvas, version: element.version }` in the cache. On lookup, compare `element.version` to the cached version. If the element object reference changed AND version bumped, regenerate. This is O(1) per element instead of O(properties + points).
**Context:** `packages/element/src/staticScene.ts:37-72, 259-276`.
**Depends on:** Item 29 (consistent version semantics).
**Status:** ✅ FIXED — `makeVersionKey` (O(n) string join + JSON.stringify) replaced by `getElementVersion()` returning `element.version ?? 0`. Cache stores `{ canvas, version: number }`. Hit check is a single integer comparison.

### 32. No `isExporting` Bypass for Shape Cache
**What:** During export (PNG/SVG), shapes must be regenerated with export-specific settings (e.g., guaranteed latest state, potentially different background color). Dripl's `renderRoughElement` always uses the cache and provides no mechanism to bypass it.
**Why:** Excalidraw's `ShapeCache.generateElementShape` accepts `isExporting: true` which forces cache bypass (shape.ts:129-132), guaranteeing export output always reflects the latest state.
**Fix:** Add an `isExporting` flag to `renderRoughElement()` and `getShapeFromCache()`. When true, skip cache lookup and do not write back to cache.
**Context:** `packages/element/src/rough-renderer.ts:179-186`, `apps/dripl-app/components/canvas/ExportModal.tsx`.
**Depends on:** None.
**Status:** ✅ FIXED — `renderRoughElement` now accepts `isExporting: boolean = false`. When true, cache lookup is skipped and the generated shape is not written back to the cache.

### 33. Hit Detection Ignores `shouldTestInside` — Transparent Elements Unclickable or Over-selectable
**What:** `packages/math/src/intersection.ts:84-176` (`isPointInElement`) always tests whether the point is *inside* the element's filled area. There is no concept of "only test the outline" for transparent/unfilled elements.
**Why:** Excalidraw separates `shouldTestInside` from `isPointOnElementOutline`. For a transparent rectangle (no background fill, no bound text), only the stroke is clickable — clicking the interior does nothing. For arrows, only the line itself is clickable, never the bounding area. This prevents users from accidentally selecting invisible background areas.
**Problem in Dripl:** A transparent rectangle with no fill is selectable by clicking anywhere inside it, which feels wrong. Conversely, thin arrows/lines are hard to select because the hit test checks the full bounding region rather than using a zoom-aware stroke tolerance.
**Fix:** Implement `shouldTestInside(element)` logic:
- Arrows: always test outline only.
- Rectangles/ellipses/diamonds: test inside only if `backgroundColor !== 'transparent'` OR has bound text OR is an image.
- Lines/freedraw: test inside only if filled AND forms a closed loop.
Add `isPointOnElementOutline(point, element, threshold)` that uses distance-to-shape (already partially implemented via `distanceToSegment`).
**Context:** `packages/math/src/intersection.ts:84-176`, `packages/math/src/hit-detection.ts:141-149`.
**Depends on:** None.

### 34. Hit Threshold Is Not Zoom-Aware
**What:** `getElementAtPosition` in `RoughCanvas.tsx:482-524` uses a hardcoded tolerance of `8` (pixels?) for both spatial-index query and `isPointNearElement`. This doesn't scale with zoom level.
**Why:** Excalidraw computes threshold as `max(strokeWidth/2 + 0.1, 0.85 * DEFAULT_COLLISION_THRESHOLD / zoom)`. At high zoom, thinner thresholds prevent accidental selections. At low zoom, wider thresholds keep small elements selectable.
**Fix:** Replace the hardcoded `8` with `Math.max(element.strokeWidth / 2 + 0.1, 8 / zoom)`. Pass `zoom` into `getElementAtPosition`.
**Context:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:485-503`.
**Depends on:** None.
**Status:** ✅ FIXED — Spatial-index query now uses `Math.max(2, 8 / zoom)` for the bounding box. Per-element `isPointNearElement` uses `Math.max(strokeWidth/2 + 0.1, 8/zoom)` for fine-grained tolerance.

### 35. Selection Box Doesn't Account for Element Rotation
**What:** `SelectionOverlay.tsx:96-113` computes selection bounds using `getElementBounds()` (which does handle rotation via AABB expansion), but the selection box itself is always axis-aligned — it doesn't visually rotate with the element. Additionally, `drawSelectionBox` in `interactiveScene.ts:454-489` also draws an axis-aligned rectangle.
**Why:** Excalidraw renders per-element selection borders with rotation: `getElementAbsoluteCoords` returns center coords, and the selection border is drawn with `context.rotate(element.angle)` at the element's center. This means a rotated rectangle's selection border is also rotated, matching the visual element exactly.
**Problem in Dripl:** A 45°-rotated rectangle gets a much larger selection box (the AABB of the rotated rectangle), causing confusing visual feedback. Users can't tell which element is actually selected when rotated elements overlap.
**Fix:** For single-element selection, render the selection box at the element's rotation angle, not axis-aligned. Use `ctx.translate(cx, cy) → ctx.rotate(angle) → draw rect → ctx.restore()`.
**Context:** `apps/dripl-app/components/canvas/SelectionOverlay.tsx:96-113`, `renderer/interactiveScene.ts:454-489`.
**Depends on:** None.

### 36. No Fractional Index for Z-Ordering — Collaboration Z-Order Conflicts
**What:** Z-ordering in Dripl is purely array-position based (`bringForward`/`sendBackward` swap array indices). There is no `index` property on elements.
**Why:** Excalidraw assigns a `FractionalIndex` (base-62 string like `"a1V"`) to each element. During collaboration, fractional indices are the *source of truth* for ordering — not array position. This allows two users to independently reorder elements without conflicting: user A moves element X to index `"a2"`, user B moves element Y to index `"a3"`, and reconciliation sorts by these strings. Array-index-based reordering would require a full re-index on every remote update.
**Problem in Dripl:** When two collaborators both use "bring to front" on different elements simultaneously, their local arrays diverge. The next `broadcastElements` call sends the full array, and the conflict resolution (last-write-wins) discards one user's reorder.
**Fix:** Add `index: string | null` to `DriplElement`. Use `fractional-indexing` (vendored, CC0 license) to generate keys. On `bringForward`/`sendBackward`, compute new fractional indices. On multiplayer reconciliation, sort by `index` instead of array position.
**Context:** `apps/dripl-app/lib/canvas-store.ts:479-585`, `@dripl/common` element type definition.
**Depends on:** Diff-based element broadcasting (Item 2).

### 37. `elementCanvasCache` Never Evicted — Orphaned Canvases Accumulate
**What:** `packages/element/src/staticScene.ts:31` uses `Map<string, CacheEntry>` for offscreen element canvases. When an element is deleted, its cached `<canvas>` DOM node is never removed from the map. Each cached canvas allocates GPU-backed memory.
**Why:** Excalidraw uses `WeakMap<ExcalidrawElement, canvas>` — deleted elements are GC'd, and their canvas entries disappear automatically. Additionally, `elementWithCanvasCache.delete(element)` is called on any shape cache miss.
**Fix:** In `deleteElements`, call `invalidateElementCache(id)` for each deleted element (already done). But also need to periodically prune the `elementCanvasCache` — or switch to a `WeakMap`/`WeakRef`-based approach. As a simpler fix: in `invalidateElementCache`, also delete the offscreen canvas from `elementCanvasCache`.
**Context:** `packages/element/src/staticScene.ts:31,104-106`, `canvas-store.ts:453-477`.
**Depends on:** None.
**Status:** ✅ FIXED — `invalidateElementCache(id, element?)` now also calls `clearShapeFromCache(element)` when the element object is provided. `canvas-store.ts` passes the element in `commitDraft`, `updateElement`, and `updateElementTransient`. Shape + offscreen canvas are now evicted together.

### 38. Interactive Canvas Duplicates Full Element Rendering
**What:** `renderer/interactiveScene.ts:644-651` re-renders *all committed elements* with its own Canvas 2D path-based renderer (manual roughness simulation via multi-pass jitter) when `renderCommittedElements` is true. Currently it's passed `false` from `InteractiveCanvas.tsx:173`, but the code exists and the rendering path is fundamentally different from `StaticCanvas` (which uses Rough.js).
**Why:** Excalidraw has a clear separation: `renderStaticScene` handles element rendering exclusively; `renderInteractiveScene` only draws selection boxes, handles, cursors, snap lines, and other UI overlays. No element rendering code exists in the interactive scene.
**Problem in Dripl:** Having two independent element renderers (one in `interactiveScene.ts` using manual multi-pass jitter, one in `rough-renderer.ts` using Rough.js) means: (a) visual inconsistency if both are ever enabled, (b) maintenance burden — element rendering bugs must be fixed in two places, (c) ~400 lines of dead/redundant code in `interactiveScene.ts`.
**Fix:** Remove all element rendering functions from `interactiveScene.ts` (lines 127-414). The interactive canvas should only render overlays. Remove the `renderCommittedElements` parameter.
**Context:** `renderer/interactiveScene.ts:127-414,644-651`, `InteractiveCanvas.tsx:173`.
**Depends on:** None.

### 39. No `mutateElement` Centralization — Shape Cache Invalidation Is Ad-Hoc
**What:** Element mutations happen in three places: `updateElement` (canvas-store.ts:398), `updateElementTransient` (canvas-store.ts:430), and `commitDraft` (canvas-store.ts:297). Each must manually call `invalidateElementCache(id)`. There's no centralized mutation function that automatically invalidates caches.
**Why:** Excalidraw's `mutateElement()` is the single mutation point. It automatically calls `ShapeCache.delete(element)` whenever geometry-affecting properties change (width, height, points, fileId). This makes it impossible to forget cache invalidation.
**Problem in Dripl:** `commitDraft` (line 297-330) does NOT call `invalidateElementCache`. If a draft element had a cached shape from a preview render, the committed element may display a stale shape. Also, `setElements` (line 335-353) — used for full remote syncs — doesn't invalidate any caches, meaning remotely-changed elements may show stale offscreen canvases.
**Fix:** Create a centralized `mutateElement(element, updates)` utility that: (a) bumps version/versionNonce, (b) calls `invalidateElementCache(id)` and `clearShapeFromCache(element)`, (c) returns the new element. Use this in all store actions.
**Context:** `canvas-store.ts:297-330,335-353,398-428,430-451`.
**Depends on:** None.
**Status:** ✅ FIXED — `commitDraft` now calls `clearShapeFromCache` + `invalidateElementCache` after creating the committed element. `updateElement` and `updateElementTransient` call `clearShapeFromCache(previous)`. `setElements` clears the full shape cache on scene replace, and on `skipHistory` path it selectively invalidates changed elements.

### 40. Box Selection (Marquee) Doesn't Support "Contain" vs "Overlap" Correctly
**What:** `packages/math/src/hit-detection.ts:151-158` (`getElementsInSelectionRect`) uses `elementIntersectsSelectionRect` which checks if *any part* of the element touches the selection rect. The store has `marqueeSelectionMode: 'intersecting' | 'contained'`, but the `contained` mode is never implemented — both modes use intersection logic.
**Why:** Excalidraw's `getElementsWithinSelection` supports both `BoxSelectionMode: "contain" | "overlap"`. In "contain" mode, the element must be fully inside the selection box. In "overlap" mode, any intersection counts.
**Fix:** Implement the `contained` mode: check if the selection AABB fully contains the element AABB using `boundsContainBounds(selectionBounds, elementBounds)`.
**Context:** `packages/math/src/hit-detection.ts:151-158`, `canvas-store.ts:255` (mode state exists), `RoughCanvas.tsx` (where marquee selection is evaluated).
**Depends on:** None.
**Status:** ✅ FIXED — `contained` mode is implemented directly in the RoughCanvas.tsx pointer-up handler (lines 1378-1393). When `marqueeSelectionMode === 'contained'`, the spatial index candidates are filtered so only elements whose full AABB lies inside the marquee rect are selected.

### 41. Viewport / Container Dimensions Stale on Resize
**What:** In `RoughCanvas.tsx`, the `viewport` dimensions (`width` and `height`) are read directly from `containerRef.current?.clientWidth` and `clientHeight` during rendering.
**Why:** React does not automatically trigger re-renders when a DOM element's width or height changes. As a result, the viewport dimensions remain completely stale (often initialized to `0` or initial load size) until a pan, zoom, or element update forces a re-render.
**Problem in Dripl:** Resizing the window or panel layout causes rendering artifacts, incorrect mouse-to-canvas coordinate transformations on click, and breaks spatial culling.
**Fix:** Implement a `ResizeObserver` on the canvas container that synchronizes the width and height into a local React state or canvas-store state, forcing an instant and correct re-render when bounds change.
**Context:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:327-334`.
**Depends on:** None.

### 42. Laser Trail Updates Trigger Massive Redundant Component Re-renders
**What:** Drawing with the laser tool updates a React state `laserTrailPoints` and sets up a `60ms` interval to clean up old points.
**Why:** Because `RoughCanvas` is a massive component containing state subscriptions, toolbars, overlays, and spatial index logic, triggering state updates every few milliseconds causes the entire component tree to re-render.
**Problem in Dripl:** Drawing with the laser tool causes high CPU/GPU overhead and perceptible frame drops, which defeats the purpose of a smooth laser pointer.
**Fix:** Move the transient laser trail rendering out of React state and into a lightweight dedicated canvas overlay or a direct `requestAnimationFrame` loop on a separate overlay layer that doesn't trigger React tree updates.
**Context:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:93, 1507-1514`.
**Depends on:** None.

### 43. No Client-Side Idle Timeout or Inactivity Expiry for Remote Cursors
**What:** Remote cursors/collaborators are saved in state via websocket updates but are never pruned unless a explicit `user-leave` event is received.
**Why:** If a remote collaborator loses network connection, closes their tab unexpectedly, or locks their device, their socket may drop without cleanly sending a `user-leave` message.
**Problem in Dripl:** Idle or disconnected collaborator cursors remain frozen on screen indefinitely, cluttering the workspace.
**Fix:** Implement a tick interval or check within the render loop that hides or fades out any remote cursor whose `updatedAt` timestamp is older than 5 seconds.
**Context:** `apps/dripl-app/hooks/useCollaboration.ts:246-268`.
**Depends on:** None.

### 44. Endpoint-Only Handles for Multi-Point Linear Paths
**What:** For linear elements (arrows and lines) that have multiple points, the selection overlay only displays handles for the first and last points (`points[0]` and `points[points.length - 1]`).
**Why:** The selection overlay logic simplifies handles to start/end points and lacks any mechanism for rendering or dragging intermediate path vertices.
**Problem in Dripl:** Users cannot edit, add, or move intermediate points of multi-point lines, making detailed diagramming extremely difficult.
**Fix:** Map over the entire `points` array of selected linear elements to render intermediate handle markers, updating the target point's local offset in `updateElementTransient` when dragged.
**Context:** `apps/dripl-app/components/canvas/SelectionOverlay.tsx:242-250`.
**Depends on:** None.

### 45. No Client-Side Throttling or Debouncing on Canvas Storage Serialization
**What:** Canvas state persistence to `localStorage` is debounced inside a simple React effect whenever `elements` change.
**Why:** Large canvases with hundreds of complex elements (or high-point freedraw lines) translate to massive JSON strings.
**Problem in Dripl:** Serializing the entire scene on every mouse release or zoom change blocks the main thread, causing minor but noticeable frame freezes (jank) on low-end devices.
**Fix:** Offload serialization to a Web Worker, or use a throttling strategy that only writes when the user has been completely inactive for several seconds.
**Context:** `apps/dripl-app/components/canvas/RoughCanvas.tsx:269-289`.
**Depends on:** None.

