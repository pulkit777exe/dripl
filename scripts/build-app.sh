#!/bin/bash
set -e

# Build workspace packages that dripl-app depends on
echo "Building workspace packages..."
pnpm --filter @dripl/common build
pnpm --filter @dripl/math build
pnpm --filter @dripl/utils build
pnpm --filter @dripl/element build

# Build dripl-app
echo "Building dripl-app..."
pnpm --filter dripl-app build

echo "Build complete."
