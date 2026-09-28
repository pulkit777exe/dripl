import type { PrismaClient } from './generated/client';
import * as PrismaClientModule from './generated/client';
export type { Prisma } from './generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as PgModule from 'pg';
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
  const shouldDisableSsl = isLocalhost && process.env.NODE_ENV !== 'production';
  const allowInsecureRemoteTls =
    process.env.NODE_ENV !== 'production' && process.env.DB_ALLOW_INSECURE_TLS === 'true';

  const url = new URL(dbUrl);
  const poolConfig = {
    // Preserve query parameters such as sslmode from managed PostgreSQL URLs;
    // reconstructing only host/user/password silently downgraded TLS.
    connectionString: dbUrl,
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    // Keep certificate verification enabled by default. Insecure remote TLS
    // is an explicit development-only escape hatch, never a production
    // default.
    ssl: shouldDisableSsl
      ? false
      : allowInsecureRemoteTls
        ? { rejectUnauthorized: false }
        : undefined,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: Math.max(1, parseInt(process.env.DB_POOL_SIZE || '20', 10) || 20),
  };

  const pool = new PgModule.Pool(poolConfig);

  pool.on('error', err => {
    // eslint-disable-next-line no-console -- pool errors fire outside any request/logger context
    console.error('[db] Pool error:', err);
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClientModule.PrismaClient({
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
    return (prismaInstance as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export async function initializeDb(): Promise<PrismaClient> {
  if (!prismaInstance) {
    prismaInstance = await createPrismaClient();
  }
  return prismaInstance;
}
