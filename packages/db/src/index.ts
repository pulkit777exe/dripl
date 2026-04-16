import { PrismaClient } from '@prisma/client';
export * from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { URL } from 'url';

let prismaInstance: PrismaClient | null = null;

async function createPrismaClient(): Promise<PrismaClient> {
  const dbUrl = process.env.DATABASE_URL || '';

  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Make sure dotenv is loaded before using the db module.'
    );
  }

  const isLocalhost = dbUrl.includes('localhost');
  const isNeon = dbUrl.includes('neon.tech');
  const shouldDisableSsl = isLocalhost && !isNeon && process.env.NODE_ENV !== 'production';

  const url = new URL(dbUrl);
  const poolConfig = {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    ssl: shouldDisableSsl ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  };

  const pool = new Pool(poolConfig);

  pool.on('error', err => {
    console.error('[db] Pool error:', err);
  });

  pool.on('connect', () => {});

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.DEBUG_PRISMA ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === 'then') {
      return undefined;
    }
    if (!prismaInstance) {
      throw new Error(
        'PrismaClient not initialized. This may be due to accessing db before dotenv is loaded or a connection issue. Make sure to load environment variables before using db operations.'
      );
    }
    return (prismaInstance as any)[prop];
  },
});

export async function initializeDb(): Promise<PrismaClient> {
  if (!prismaInstance) {
    prismaInstance = await createPrismaClient();
  }
  return prismaInstance;
}
