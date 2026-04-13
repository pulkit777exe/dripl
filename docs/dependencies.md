# Dependency Management

## Overview

This project uses pnpm workspaces with Turborepo. Dependencies are managed at the package level, not the root.

## Install Where Used

Always install dependencies in the package that needs them:

```bash
# Good
pnpm add lodash --filter=@dripl/utils
pnpm add react --filter=dripl-app

# Avoid
pnpm add lodash -w  # Only for repo-level tools
```

## Root Dependencies

Only these belong in the root `package.json`:

- `turbo` - Build system
- `prisma` - Database tooling
- `prettier` - Formatting
- `tsx` - TypeScript executor

## Internal Dependencies

Use `workspace:*` protocol:

```json
"dependencies": {
  "@dripl/common": "workspace:*"
}
```

## Build Dependencies

Dependencies needed only for building should be in `devDependencies`:

```json
"devDependencies": {
  "@dripl/typescript-config": "workspace:*",
  "typescript": "latest"
}
```

## Workspace Scripts

Root-level convenience scripts:

```bash
pnpm run build      # Build all packages
pnpm run dev       # Run all apps in dev mode
pnpm run lint      # Lint all packages
pnpm run test      # Run all tests
```
