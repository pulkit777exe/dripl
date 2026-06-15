import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(process.cwd(), '../../.env.local'), override: true });

import { initializeDb } from '@dripl/db';
import { createApp } from './app';

const app = createApp();
const port = Number(process.env.PORT ?? 3002);

async function start() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error(
      JSON.stringify({ level: 'error', event: 'missing_env', error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required' }),
    );
    process.exit(1);
  }

  try {
    await initializeDb();
    console.log(JSON.stringify({ level: 'info', event: 'db_connected' }));
  } catch (err: unknown) {
    console.error(
      JSON.stringify({ level: 'error', event: 'db_connection_failed', error: err instanceof Error ? err.message : String(err) }),
    );
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
      console.log(JSON.stringify({ level: 'info', event: 'expired_links_cleaned', count: result.count }));
    } catch (err) {
      console.error(
        JSON.stringify({ level: 'error', event: 'cleanup_failed', error: err instanceof Error ? err.message : String(err) }),
      );
    }
  }, CLEANUP_INTERVAL_MS);

  const httpServer = app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', event: 'http_server_started', port }));
  });

  function shutdown() {
    clearInterval(cleanupInterval);
    httpServer.close(() => {
      console.log(JSON.stringify({ level: 'info', event: 'http_server_closed' }));
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
