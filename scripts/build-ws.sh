#!/bin/bash
set -e

# Build workspace packages that ws-server depends on
echo "Building workspace packages..."
pnpm --filter @dripl/common build
pnpm --filter @dripl/utils build
pnpm --filter @dripl/db build

# Build ws-server
echo "Building ws-server..."
pnpm --filter ws-server build

echo "Build complete."
