# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Tests**: Add canvas coordinates unit tests (10 tests for viewport transformations)
- **Tests**: Add WebSocket integration tests (26 tests for element CRUD, cursor, room management)
- **Database**: Add indexes on File, Folder, CanvasRoom, CanvasRoomMember for query optimization
- **WebSocket**: Add rate limiting (30 msgs/sec per connection)

### Fixed

- **Code Quality**: Consolidate auth middleware to single source of truth
- **Tests**: Fix http-server routes test imports
- **WebSocket**: Add element coordinate bounds validation (width/height 0-50000, coords -100000 to 100000)
- **WebSocket**: Reduce periodic save interval from 60s to 15s
- **Security - IDOR**: Fix IDOR vulnerability in fileController.ts (updateFile, deleteFile methods)
- **Dead Code**: Remove unused packages/runtime (store refactored to dripl-app)
- **Orphaned Code**: Remove duplicate websocket-server.ts from http-server
- **Code Quality**: Standardize console logging to JSON format across http-server and ws-server
- **Tests**: Add 5 edge case tests to ws-server validation.test.ts
- **Duplicate Store**: Remove TanStack store, keep only Zustand in canvas-store.ts

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
