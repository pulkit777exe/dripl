#!/bin/sh
# Container entrypoint for dripl-app.
#
# Purges the Next.js image-optimizer disk cache (`.next/cache/images`) before
# handing off to `next start`, and optionally re-purges it periodically.
#
# Why this exists
# ---------------
# Next 16 reads an image cache entry with an unbounded `fs.promises.readFile`
# (next/dist/server/image-optimizer.js -> readFromCacheDir) and coalesces every
# concurrent request for the same cache key behind a single promise that is
# only cleared in a `finally` (next/dist/lib/batcher.js). So one cache entry
# whose read blocks -- e.g. a FIFO left behind by an interrupted or corrupted
# write on the container's writable layer -- wedges that image URL forever:
# no timeout, no self-heal, ~0% CPU while it is parked. Once enough such reads
# are parked, the libuv threadpool starves and every other async fs operation in
# the process stalls too. `docker restart` does not help, because the entry
# lives in the writable layer and is read again on the next boot.
#
# The cache holds only derived data: Next re-optimizes any image on demand.
# The app has eight <Image> elements across five files and a cache of ~1 MB, so
# a cold cache costs a few hundred milliseconds per distinct
# (url, width, quality, mime-type) tuple, once.
#
# Env:
#   DRIPL_APP_DIR                     app directory. Defaults to the image's
#                                     own /app/apps/dripl-app when that exists,
#                                     else $PWD.
#   DRIPL_IMAGE_CACHE_PURGE_INTERVAL  hours between background purges. 0 (or any
#                                     non-numeric value) disables the periodic
#                                     purge; the startup purge is unconditional.

set -u

DEFAULT_APP_DIR=/app/apps/dripl-app
if [ -n "${DRIPL_APP_DIR:-}" ]; then
  APP_DIR="$DRIPL_APP_DIR"
elif [ -d "$DEFAULT_APP_DIR/.next" ]; then
  APP_DIR="$DEFAULT_APP_DIR"
else
  APP_DIR="$PWD"
fi
CACHE_DIR="$APP_DIR/.next/cache/images"
PURGE_INTERVAL_HOURS="${DRIPL_IMAGE_CACHE_PURGE_INTERVAL:-6}"

log() {
  printf '[entrypoint] %s\n' "$*" >&2
}

purge() {
  if [ ! -d "$CACHE_DIR" ]; then
    log "image cache absent at $CACHE_DIR -- nothing to purge"
    return 0
  fi

  entries=$(find "$CACHE_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
  size_kb=$(du -sk "$CACHE_DIR" 2>/dev/null | cut -f1)
  log "purging image cache at $CACHE_DIR (${entries} entries, ${size_kb:-?}K)"

  # A failed purge must not keep the app down: Next just re-optimizes on the
  # next request. Warn loudly so the original failure mode stays diagnosable.
  rm -rf "$CACHE_DIR" || log "WARNING: could not purge $CACHE_DIR -- a corrupt entry may still hang"
  mkdir -p "$CACHE_DIR" 2>/dev/null || log "WARNING: could not recreate $CACHE_DIR"
}

purge

# Only ever loop on a plain non-negative integer number of hours. Anything else
# (empty, negative, non-numeric) disables the background purge rather than
# risking a tight `rm -rf` loop.
case "$PURGE_INTERVAL_HOURS" in
  '' | *[!0-9]*)
    log "ignoring invalid DRIPL_IMAGE_CACHE_PURGE_INTERVAL='$PURGE_INTERVAL_HOURS' -- periodic purge disabled"
    PURGE_INTERVAL_HOURS=0
    ;;
esac

if [ "$PURGE_INTERVAL_HOURS" -gt 0 ]; then
  (
    while :; do
      sleep "${PURGE_INTERVAL_HOURS}h" || exit 0
      purge
    done
  ) &
  log "background image-cache purge every ${PURGE_INTERVAL_HOURS}h"
fi

# Replace this shell so the server owns PID 1 and receives SIGTERM directly.
exec "$@"