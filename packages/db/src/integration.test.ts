import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDb } from './index';

const runDatabaseSmokeTest = process.env.RUN_DB_INTEGRATION === 'true';

describe.skipIf(!runDatabaseSmokeTest)('database integration smoke test', () => {
  beforeAll(async () => {
    await initializeDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('connects to the migrated PostgreSQL database', async () => {
    const result = await db.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`;
    expect(result[0]?.value).toBe(1);
  });
});
