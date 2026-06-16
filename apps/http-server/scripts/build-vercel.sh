#!/bin/bash
set -e

cd ../..

pnpm --filter @dripl/common build
pnpm --filter @dripl/utils build
pnpm --filter @dripl/db build

cd apps/http-server

npx esbuild --bundle --platform=node --target=node20 --format=esm \
  --outfile=api/index.js \
  --conditions=import \
  api/index.src.ts
