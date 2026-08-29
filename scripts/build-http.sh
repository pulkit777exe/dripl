#!/bin/bash
set -e

# Build http-server with all workspace deps in dependency order.
# Turbo's `^build` automatically builds @dripl/* packages first.
pnpm turbo run build --filter=http-server

echo "Build complete."
