# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Engineering Review**: Comprehensive codebase review (architecture, code quality, tests, performance)
  - Created `TODOS.md` with 25 prioritized items + 15 pre-existing issues documented
- **WebSocket Security**: JWT auth via `Sec-WebSocket-Protocol` header instead of URL query parameter
- **Rate Limiting**: Added per-IP rate limiting (30 req/15min) to public share endpoint
- **Scene Validation**: Added `MAX_ELEMENTS_PER_SCENE = 5000` limit to prevent OOM attacks
- **Empty Room TTL**: 5-minute grace period before evicting empty rooms from memory
- **Heartbeat Cleanup**: Dead connections now properly clean up room state and cursors
- **Shape Cache Pruning**: Periodic cache cleanup every 1000 operations to prevent memory leaks
- **Compression**: Added gzip compression middleware to http-server
- **Test Infrastructure**: Added `vitest.config.ts` for ws-server
- **Tests**: 65 validation tests for ws-server Zod schemas (join, element CRUD, cursor, scene-update)
- **Handle Utilities**: Extracted shared `HandlePosition` type and `getCursorForHandle()` helper
- **LoadingState Component**: Added missing `LoadingState` export to ErrorState component
- **Database**: Parallelized `loadRoomElements` queries using `Promise.all`

### Fixed

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
- **Performance - Shape Cache**: Added periodic `pruneShapeCache()` calls
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
