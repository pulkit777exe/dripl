# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
