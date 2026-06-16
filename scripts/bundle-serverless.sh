#!/bin/bash
# Bundle a serverless function with esbuild for Vercel deployment
# Usage: bash scripts/bundle-serverless.sh <app-dir>
# Example: bash scripts/bundle-serverless.sh apps/http-server

set -euo pipefail

APP_DIR="${1:?Usage: bundle-serverless.sh <app-dir>}"
APP_DIR="$(cd "$APP_DIR" && pwd)"

echo "Bundling serverless function in $APP_DIR..."

cd "$APP_DIR"

# Find esbuild from node_modules (hoisted at root or local)
ESBUILD="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  ESBUILD="../../node_modules/.bin/esbuild"
fi
if [ ! -x "$ESBUILD" ]; then
  echo "Error: esbuild not found. Run 'pnpm install' first."
  exit 1
fi

"$ESBUILD" api/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=api/index.js \
  --log-level=info

echo "Bundle complete: api/index.js"
