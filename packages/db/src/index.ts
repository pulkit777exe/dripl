import { PrismaClient } from '@prisma/client';
export * from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { URL } from 'url';

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL || '';

  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Make sure dotenv is loaded before using the db module.'
    );
  }

  const isLocalhost = dbUrl.includes('localhost');
  const shouldDisableSsl = isLocalhost || process.env.NODE_ENV !== 'production';


  const url = new URL(dbUrl);
  const poolConfig = {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    ssl: shouldDisableSsl ? false : { rejectUnauthorized: false },
  };


  const pool = new Pool(poolConfig);

  pool.on('error', err => {
    console.error('[db] Pool error:', err);
  });

  pool.on('connect', () => {
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.DEBUG_PRISMA ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!prismaInstance) {
      prismaInstance = createPrismaClient();
    }
    return (prismaInstance as any)[prop];
  },
});

export default db;
