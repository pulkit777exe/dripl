# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- GitHub Actions CI/CD workflow
- GitHub issue and PR templates
- Dockerfiles for all apps
- Docker Compose for local development
- Commitlint configuration
- LICENSE file (MIT)
- CONTRIBUTING.md
- Prettier configuration
- Shared ESLint configuration
- React error boundary for Next.js

### Fixed

- JWT secret fallback to require env var
- CSRF protection implementation
- Security headers (CSP, HSTS, referrer-policy)
- Per-user rate limiting
- WebSocket message size validation
- Cookie secure flag handling
- Removed .js extensions from imports
- Package.json metadata (description, license)

### Changed

- Enhanced Helmet security configuration
