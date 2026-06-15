import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

import { initializeDb } from '@dripl/db';
import { healthHandler } from '../src/app';

let dbInitialized = false;

async function ensureDb() {
  if (!dbInitialized) {
    await initializeDb();
    dbInitialized = true;
  }
}

ensureDb().catch(err => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'serverless_db_init_failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
});

export default healthHandler;
