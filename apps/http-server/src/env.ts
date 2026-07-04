import { z } from 'zod';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Load env from repo root regardless of CWD
const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(__dirname, '../../..');
config({ path: resolve(repoRoot, '.env') });
config({ path: resolve(repoRoot, '.env.local'), override: true });

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    HTTP_PORT: z.string().optional().default('3002'),
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
    // Production-only
    INTERNAL_SECRET: isProd
      ? z.string().min(1, 'INTERNAL_SECRET is required in production')
      : z.string().optional(),
    FRONTEND_URL: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
  })
  .refine(data => (isProd ? data.FRONTEND_URL || data.NEXT_PUBLIC_APP_URL : true), {
    message: 'FRONTEND_URL or NEXT_PUBLIC_APP_URL is required in production',
  })
  .refine(data => data.JWT_SECRET !== data.INTERNAL_SECRET, {
    message: 'JWT_SECRET and INTERNAL_SECRET must be different values',
  });

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console -- Runs before logger is initialized
    console.error('FATAL: Environment validation failed:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console -- Runs before logger is initialized
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = validateEnv();
