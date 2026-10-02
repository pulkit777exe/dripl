# Changelog

> **Historical release record.** Entries describe changes at the time they
> were written. The current WebSocket authentication path is a short-lived
> ticket, and the active message limit is 200 KB; older JWT/header and 10 MB
> entries are not current architecture documentation.

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Test Infrastructure**: Created `@dripl/test-utils` package with element factories (all 9 types), user/presence factories, and mock Canvas 2D context
- **Element Resize Tests**: 48 comprehensive tests for `packages/element/src/resizeElements.ts` covering all element types, handle directions, aspect ratio, rotation, and edge cases
- **Engineering Review**: Comprehensive codebase review (architecture, code quality, tests, performance)
- Created `TODOS.md` with 25 prioritized items + 15 pre-existing issues documented

### Fixed

- **Performance - RAF Loop**: `StaticCanvas` now only schedules `requestAnimationFrame` when dirty, cancels when idle (was 60fps continuous)
- **Performance - RBush**: Replaced full spatial index rebuild with incremental insert/remove in `RoughCanvas` (falls back to full rebuild when >40% elements changed)
- **Performance - Cursor Interpolation**: Eliminated per-frame `new Map()` allocation in `useInterpolatedCursors` by passing same ref to setState
- **Performance - Gesture Updates**: Batched transient element changes and dependent bound-arrow/label updates per gesture frame
- **Performance - Spatial Hit Testing**: Reused scene order, sorted only indexed candidates, and added a version/geometry-keyed bounds cache
- **Performance - Research**: Added a pinned third-party source research pass and browser-measurement plan (both research documents have since been removed; the measurements that survived are in `docs/performance-benchmark.md`)
- **Performance - Instrumentation**: Development-only User Timing measures on static/interactive frames and pointer-move batches, plus a best-effort `PerformanceObserver` for `longtask`, `event`, and `long-animation-frame` (with per-script attribution) behind a dev-only `window.__driplPerformance` handle
- **Performance - Browser Harness**: Added an opt-in `e2e/performance.spec.ts` that seeds scenes through the local persistence format and measures zoom-out, pan, and freehand; results and their limits are recorded in `docs/performance-benchmark.md`
- **Performance - Pointer Budget**: Bounded coalesced pointer samples per frame and the pending pointer queue, keeping the latest sample instead of letting a blocked frame become an unbounded burst of scene updates
- **Performance - Spatial Index**: Transient gesture batches now publish changed IDs with a matching spatial revision, so the RBush index updates only the changed extents during a gesture instead of diffing the whole scene
- **Performance - Static Rendering**: Stopped resizing a scratch canvas in `createRoughCanvas` that the function never drew into. This was dead work, removed on inspection rather than on a measurement
- **Canvas Robustness**: Capped per-element offscreen canvas dimensions to 16,777,216 device pixels and 32,767 px per axis. Previously an element of 40,000 x 40,000 world pixels would request a ~1.6 billion pixel surface. The cache entry now records the resolution used so downscaled bitmaps still draw at the correct size. Verified in the browser, with no change to ordinary scenes
- **Wheel Pan Fix**: Removed the wheel-pan inertia loop. It decayed by only 0.95 per frame, so one wheel notch of 200 glided roughly 6,000 px over about two seconds, which at a zoomed-out view carried the viewport off the scene and left a blank canvas. Wheel and trackpad now pan directly by the delta, with no momentum path. Shift+wheel now also honours a vertical delta. The performance spec asserts the static layer is never blank after a pan, and that assertion failed against the old code
- **Local Persistence**: Raised the IndexedDB ceiling from 5,000 to 50,000 elements. IndexedDB is not bound by the localStorage byte budget, so the old cap left large scenes unpersisted and made 10k/20k scenes untestable. Neither backend now reports success after writing a partial scene: the localStorage fallback budgets by serialized size and marks a truncated payload, and IndexedDB refuses to overwrite a complete snapshot with a truncated one
- **Rendering Determinism**: Elements that arrive without a `seed` (imported, legacy, or hand-authored scenes) now derive a stable seed from their id, so their hand-drawn sketch no longer changes every time a bitmap is regenerated. Verified reproducible in the browser across fresh page loads
- **Cache Invalidation**: `invalidateElementCache` no longer walks every cached element to find the owners of a changed label, which made each mutated element scan the whole scene on every drag frame. Cached bitmaps now record the versions of the elements drawn into them and re-check on reuse, so invalidation is O(1)
- **Bitmap Cache Bound**: The per-element offscreen bitmap cache is now bounded by bytes (128 MB) and entry count (20,000) with insertion-order eviction. A 100x70 element costs about 43 KB, so an unbounded cache could ask for multiple gigabytes on a large scene. Measured at 10,000 elements: 1,219 entries / 52.5 MB, well inside the ceiling
  At 10,000 elements the budget does not activate (300 new bitmaps against a cap of 400), so it is a guard for denser scenes rather than a measured speedup
- **Static Frame Attribution**: `renderStaticScene` now reports `setupMs` / `generateMs` / `blitMs` / `directMs` per frame (development only, and only when stats are requested). This showed a generated bitmap costs ~76 us against ~1.7 us for a cached blit, so Rough.js path generation was 96% of the worst frame
- **Dense-Scene Verification at 50,000 Elements**: The per-frame bitmap cap was re-verified on a scene 5x larger than the one it was tuned against. The cap held at 100 bitmaps, the worst static frame during pan was 13.40 ms (10.6 ms of it generation), the bitmap cache held 1,281 entries / 55.2 MB against a 128 MB bound, and static layer ink stayed non-zero. Reaching this exposed a harness defect: seeding wrote the whole scene into localStorage as well as IndexedDB, so a 50,000-element run failed with `QuotaExceededError` before the canvas mounted
- **Server Images Could Not Start (Fixed)**: The http-server and ws-server Docker images built cleanly and then crashed on startup with `ERR_MODULE_NOT_FOUND`. `moduleResolution: "bundler"` allows extensionless relative imports and `tsc` never adds the extension, so the emitted ESM was unresolvable at runtime; type-checking, building, and vitest all resolve the way a bundler does and could not see it. 148 specifiers across 69 files now carry explicit extensions, and a new `pnpm check-esm` check fails the build if one is dropped
- **CI Silently Skipped the Database-Backed Collaboration Tests (Fixed)**: `turbo.json` uses `envMode: "strict"`, which strips environment variables that are not declared, and the `test` task did not declare `RUN_WS_DB_INTEGRATION` (nor did the workflow set it). The two-client WebSocket suite would have been skipped while CI reported green. Both are fixed, and the CI-shaped run now passes 116/116 in ws-server with no skipped tests
- **Docker Stack Verified**: all three images build and `docker compose up` reaches postgres, http-server, and ws-server healthy with the app serving pages. The seven migrations apply via the exact command CI uses and are idempotent on re-run
- **Next Image Optimizer Deadlocks in the Container (Open)**: webp/avif requests never return and the process sits at 0% CPU, a libvips thread stall rather than slow encoding. It blocks the `load` event, so browser tests time out against the production stack. `shm_size: '1gb'` is set as the standard remedy but is unverified
- **Database-Backed WebSocket Tests**: A new opt-in suite (`production-db.test.ts`) runs two real `ws` clients against a real migrated PostgreSQL instead of mocked seams. It covers stored-scene load on join, a debounced delta persisted and read back from the column, read-only denial for a shared viewer, denial for an unrelated user (close code 4003), share revocation, replayed-version rejection, newer-version-wins, and the optimistic-concurrency fence losing to a concurrent writer. Each of those was verified to fail under a deliberate mutation of the code it covers. The HTTP ticket exchange remains the one stubbed seam
- **Frame Allocation Budget**: A static frame can now allocate at most 100 per-element bitmaps and draws a cheap placeholder for the rest, so the frame stays complete while a following frame builds their real bitmaps. The worst static frame during pan at 10,000 elements fell from 24.10 ms to 14.20 ms, while the median rose from 1.80 ms to 6.30 ms as the work spread over more frames
- **Zoom Correctness**: Fixed `AnimationController.stop()` leaving a deactivated animation in the map, which made every `smoothZoom` call after the first in a wheel burst a silent no-op — zoom stopped responding and `shouldCacheIgnoreZoom` stayed `true` for the rest of the session, allowing stale per-element bitmaps to be reused
- **Playwright Infrastructure**: Fixed the dev-server command passing `--` (Next read `--port` as a project directory) and added `allowedDevOrigins: ['127.0.0.1']`, without which Next 16 blocked dev resources and left the page unhydrated with zero canvases
- **End-to-End Tests**: Made `google-oauth` specs host-agnostic after finding 6 pre-existing failures. They hardcoded `http://localhost:3000` and cookie domain `localhost` while the suite runs on `127.0.0.1:<E2E_PORT>`, so OAuth state cookies never reached the callback route and three tests silently asserted the wrong error path. The suite now passes (18 passed, 1 opt-in skipped)
- **Cleanup**: Removed unused zoom helpers (`zoomToFit`, `zoomToSelection`, `calculateZoom`, `getScaledDimensions`, `getScaledPoint`, `getMousePosition`) and made the wheel handler use `DEFAULT_ZOOM_SETTINGS` instead of duplicated zoom literals
- **Collaboration Correctness**: Prevented remote deltas from replacing elements or drafts being edited locally
- **WebSocket Security**: JWT auth via `Sec-WebSocket-Protocol` header instead of URL query parameter
- **Rate Limiting**: Added per-IP rate limiting (30 req/15min) to public share endpoint
- **Scene Validation**: Added `MAX_ELEMENTS_PER_SCENE = 5000` limit to prevent OOM attacks
- **Empty Room TTL**: 5-minute grace period before evicting empty rooms from memory
- **Heartbeat Cleanup**: Dead connections now properly clean up room state and cursors
- **Shape Cache**: Kept version/theme-aware WeakMap caching and removed no-op pruning calls
- **Compression**: Added gzip compression middleware to http-server
- **Test Infrastructure**: Added `vitest.config.ts` for ws-server
- **Tests**: 65 validation tests for ws-server Zod schemas (join, element CRUD, cursor, scene-update)
- **Handle Utilities**: Extracted shared `HandlePosition` type and `getCursorForHandle()` helper
- **LoadingState Component**: Added missing `LoadingState` export to ErrorState component
- **Database**: Parallelized `loadRoomElements` queries using `Promise.all`

### Additional fixes

- **Security - Cookie Mismatch**: Standardized cookie name to `dripl-session` across auth middleware
- **Security - Auth URL**: Moved JWT from URL query (`?token=`) to WebSocket headers (prevents logging in access logs)
- **Security - Share Endpoint**: Added rate limiting to prevent token brute-force attacks
- **Security - Scene Update**: Added element count limit to prevent OOM from malicious payloads
- **Data Integrity - Race Condition**: Fixed `loadedFromDb` flag set BEFORE await (was after, causing duplicate DB loads)
- **Data Integrity - Stale Save**: Fixed `scheduleSave` to read from `room.elements` at execution time instead of capturing stale reference
- **Data Integrity - History**: Replaced `JSON.parse(JSON.stringify())` with `structuredClone()` (preserves Sets/Maps/Dates)
- **Bug - SelectionBox**: Fixed `height={width}` typo → `height={height}`
- **Bug - UseCollaborationReturn**: Added missing `disconnect` method to interface
- **Bug - createPortal**: Fixed import from `'react'` → `'react-dom'`
- **Bug - handleSubmit**: Made `React.FormEvent` parameter optional for retry callbacks
- **Bug - AI Route**: Added `Number()` casts for unknown-type arithmetic operations
- **Performance - DB Queries**: Parallelized sequential `findUnique` calls in `loadRoomElements`
- **Performance - Room Eviction**: Added TTL-based eviction for empty rooms instead of immediate deletion
- **Performance - Heartbeat**: Clean up room state when terminating dead connections
- **Performance - Shape Cache**: Removed no-op pruning calls; cache invalidation remains version/theme driven
- **Performance - Compression**: Added gzip compression to http-server responses
- **Dead Code**: Removed `fileController.ts` (superseded by `files.ts` routes)
- **Dead Code**: Removed `userController.ts` (superseded by `auth.ts` routes)
- **Dead Code**: Removed `packages/element/src/intersection.ts` (useless re-export barrel)
- **Dead Code**: Removed `packages/math/src/collision.ts` (6-line passthrough)
- **Dead Code**: Removed scaffold files (`button.tsx`, `card.tsx`, `code.tsx`)
- **Dead Code**: Removed empty `middleware/` directory and stray `package-lock.json`
- **Code Quality - Duplicate Types**: Replaced duplicate `DriplElement`/`Point`/`Bounds` in `@dripl/dripl` with re-exports from `@dripl/common`
- **Code Quality - Index Files**: Fixed broken exports in `@dripl/math` and `@dripl/element` after deleting useless files
- **Code Quality - Commented Code**: Removed commented-out import in `@dripl/common`
- **Code Quality - Duplicate Route**: Removed duplicate `/share/:token` registration in `roomRoutes.ts`
- **Code Quality - Find-then-Act**: Fixed `updateRoom`, `deleteRoom`, `addMember`, `removeMember` to use combined `where: { slug, ownerId }` queries
- **Code Quality - deepClone**: Updated test expectations for `structuredClone` behavior (preserves Date/Map/Set)

### Changed

- **WebSocket Auth**: Clients must now pass JWT via `Sec-WebSocket-Protocol` header or `Authorization: Bearer` header
- **History System**: Uses native `structuredClone` instead of JSON round-trip (correctness improvement)
- **Auth Forms**: `handleSubmit` accepts optional event parameter for programmatic calls

---

## [1.0.0] - 2026-04-07

### Added

- **CI/CD**: GitHub Actions workflow with lint, typecheck, and test jobs
- **Issue/PR Templates**: Bug report and feature request templates
- **Docker Support**: Dockerfiles for all 3 apps (dripl-app, http-server, ws-server)
- **Docker Compose**: Local development environment with postgres, redis, and all services
- **Commitlint**: Conventional commit message validation
- **Prettier**: Code formatting configuration at root
- **ESLint**: Shared ESLint configuration in `tooling/eslint-config/`
- **Error Boundary**: React error boundary for Next.js (`app/error.tsx`)
- **Health Endpoints**: Enhanced `/health` with uptime, version, timestamp
- **CHANGELOG.md**: Project changelog
- **LICENSE**: MIT license file
- **CONTRIBUTING.md**: Contributor guidelines
- **README**: Updated documentation

### Fixed

- **Security - JWT**: No longer falls back to insecure default; throws if `JWT_SECRET` missing
- **Security - CSRF**: Added `/csrf-token` endpoint and `X-CSRF-Token` header handling
- **Security - Headers**: Enhanced Helmet with CSP, HSTS, referrer-policy, noSniff, xssFilter
- **Security - Rate Limiting**: Per-user rate limiting via `req.userId` in key generator
- **Security - WebSocket**: Added 10MB message size validation before processing
- **Security - Cookies**: Fixed `secure` flag to use `isProduction` constant
- **Code Quality - Imports**: Removed `.js` extensions from all http-server imports
- **Code Quality - Package Metadata**: Added description and license to all packages
- **Code Quality - tsconfig**: Enhanced root tsconfig with proper compilerOptions

### Changed

- **Auth**: Updated README to reflect cookie-based auth (not Clerk)
- **Module Resolution**: Standardized on ESNext/bundler resolution
- **Environment**: Removed hardcoded secrets from `.env` (now placeholder values)

---

## [0.x.x] - Pre-2026

See git history for earlier changes.
