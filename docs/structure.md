# Repository Structure

## Overview

```
dripl/
├── apps/                    # Deployable applications
├── packages/               # Shared library packages
├── tooling/                # Repository configuration
├── turbo.json              # Turborepo configuration
├── pnpm-workspace.yaml    # pnpm workspace
└── package.json           # Root package (minimal deps)
```

## Directories

### `apps/`

Deployable applications - the endpoints of the package graph.

| Package     | Description             |
| ----------- | ----------------------- |
| dripl-app   | Next.js web application |
| http-server | HTTP API server         |
| ws-server   | WebSocket server        |

### `packages/`

Shared library code consumed by apps or other packages.

| Package | Description                      |
| ------- | -------------------------------- |
| common  | Shared types, schemas, utilities |
| db      | Database (Prisma) client         |
| dripl   | Core canvas library              |
| element | Canvas elements                  |
| math    | Math utilities                   |
| runtime | Runtime state management         |
| utils   | Utility functions                |

### `tooling/`

Repository-level configuration packages.

| Package           | Description              |
| ----------------- | ------------------------ |
| eslint-config     | ESLint configuration     |
| typescript-config | TypeScript configuration |

## Package Naming

- **Apps**: Unnamespaced (e.g., `dripl-app`)
- **Packages**: Namespaced with `@dripl/` (e.g., `@dripl/utils`)
- **Tooling**: Namespaced with `@dripl/` (e.g., `@dripl/eslint-config`)

## Build Strategy

Packages use the **Compiled** strategy:

- Source in `src/`
- Compiled output to `dist/`
- Build with `tsc -b`

This enables caching by Turborepo and works with all consumers.
