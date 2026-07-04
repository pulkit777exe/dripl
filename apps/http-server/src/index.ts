import { createLogger } from '@dripl/utils/logger';
import { env } from './env.js';

const logger = createLogger('http-server');

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

start();
