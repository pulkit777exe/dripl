#!/bin/bash
set -e

APP=$1

# Install all deps from monorepo root
pnpm install

# Build workspace packages the app depends on
pnpm --filter @dripl/common build
pnpm --filter @dripl/utils build
pnpm --filter @dripl/db build

# Bundle api entry point with esbuild (avoids @vercel/node pnpm symlink issues)
npx esbuild "apps/$APP/api/index.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile="apps/$APP/api/index.js" \
  --external:@prisma/client \
  --external:@prisma/adapter-pg \
  --external:prisma \
  --external:pg

echo "Install + bundle complete for $APP"
