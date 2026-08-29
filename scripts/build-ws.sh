#!/bin/bash
set -e

# Build ws-server with all workspace deps in dependency order.
# Turbo's `^build` automatically builds @dripl/* packages first.
pnpm turbo run build --filter=ws-server

echo "Build complete."
