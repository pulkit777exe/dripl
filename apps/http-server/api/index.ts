import { config } from 'dotenv';
import { resolve } from 'path';

// Load env before anything else (Vercel injects vars, but this is a safety net)
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

import { initializeDb } from '@dripl/db';
import { createApp } from '../src/app';

const app = createApp();

let dbInitialized = false;

async function ensureDb() {
  if (!dbInitialized) {
    await initializeDb();
    dbInitialized = true;
  }
}

// Initialize DB on module load (cold start)
ensureDb().catch(err => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'serverless_db_init_failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
});

export default app;
