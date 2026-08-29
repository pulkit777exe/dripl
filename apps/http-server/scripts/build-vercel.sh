#!/bin/bash
set -e

cd ../..

# Turbo's `^build` automatically builds @dripl/* deps before http-server.
pnpm turbo run build --filter=http-server

cd apps/http-server

npx esbuild --bundle --platform=node --target=node20 --format=esm \
  --outfile=api/index.js \
  --conditions=import \
  api/index.src.ts
