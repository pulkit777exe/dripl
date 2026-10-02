import { env } from './env';
import { logger } from './logger';

import { initializeDb } from '@dripl/db';
import { createApp } from './app';

const app = createApp();
const port = Number(process.env.PORT || env.HTTP_PORT) || 3002;

async function start() {
  try {
    await initializeDb();
    logger.info({ event: 'db_connected' });
  } catch (err: unknown) {
    logger.error({
      event: 'db_connection_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const cleanupInterval = setInterval(async () => {
    try {
      const db = (await import('@dripl/db')).db;
      const result = await db.shareLink.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      logger.info({ event: 'expired_links_cleaned', count: result.count });
    } catch (err) {
      logger.error({
        event: 'cleanup_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, CLEANUP_INTERVAL_MS);

  const httpServer = app.listen(port, () => {
    logger.info({ event: 'http_server_started', port });
  });

  function shutdown() {
    clearInterval(cleanupInterval);
    httpServer.close(() => {
      logger.info({ event: 'http_server_closed' });
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// `start()` handles the one expected failure (no database) by logging and
// exiting. Anything else it throws — `createApp`, `app.listen`, the Prisma
// import inside the cleanup interval's first tick — used to become a bare
// unhandled rejection: the process died with nothing in the log, so a bad boot
// was indistinguishable from a crash loop. Record it and exit non-zero.
void start().catch((err: unknown) => {
  logger.error({
    event: 'http_server_start_failed',
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
