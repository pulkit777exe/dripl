#!/bin/bash
set -e

# Build workspace packages that http-server depends on
echo "Building workspace packages..."
pnpm --filter @dripl/common build
pnpm --filter @dripl/utils build
pnpm --filter @dripl/db build

# Build http-server
echo "Building http-server..."
pnpm --filter http-server build

echo "Build complete."
