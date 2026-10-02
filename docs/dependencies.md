# Dependency Management

> This is a workflow guide, not a generated dependency inventory. Use the
> workspace manifests and `pnpm-lock.yaml` as the source of truth for versions
> and scripts; do not copy `latest` ranges into new packages.

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

Root-level `devDependencies` are reserved for repo-wide tooling and scripts;
the exact list is maintained in the root `package.json`. Typical examples are
`turbo`, `prisma`, `prettier`, `tsx`, ESLint, TypeScript, and the workspace
test/type-check tools. Do not add app- or package-specific libraries at the
root.

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
  "typescript": "^5.9.3"
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
