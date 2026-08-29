#!/bin/bash
set -e

# Build dripl-app with all workspace deps in dependency order.
# Turbo's `^build` automatically builds @dripl/* packages first.
pnpm turbo run build --filter=dripl-app

echo "Build complete."
