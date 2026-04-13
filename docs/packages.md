# Package Management

## Creating a New Package

### 1. Create Directory

```bash
mkdir packages/my-new-package
```

### 2. Create package.json

```json
{
  "name": "@dripl/my-new-package",
  "version": "0.0.0",
  "description": "Description",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@dripl/eslint-config": "workspace:*",
    "@dripl/typescript-config": "workspace:*",
    "eslint": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

### 3. Add to Workspace

No changes needed - `pnpm-workspace.yaml` already includes `packages/*`.

## Adding Dependencies

### Internal Package

```bash
pnpm add @dripl/common --filter=@dripl/utils
```

### External Package

```bash
pnpm add lodash --filter=@dripl/utils
```

## Building

```bash
pnpm run build
```

Individual package:

```bash
cd packages/utils && pnpm build
```

## Common Patterns

### Consumer App

Apps consume packages via dependencies:

```json
"dependencies": {
  "@dripl/utils": "workspace:*"
}
```

### Peer Dependencies

For libraries that require consumers to provide dependencies:

```json
"peerDependencies": {
  "react": "^18.0.0 || ^19.0.0"
}
```

### Private Packages

For internal-only packages that shouldn't be published:

```json
"private": true
```
