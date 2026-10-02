import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
const localEnvPath = path.resolve(__dirname, '../../../.env.local');
config({ path: envPath });
config({ path: localEnvPath, override: true });

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z
      .string()
      .min(isProd ? 32 : 1, 'JWT_SECRET must be at least 32 characters in production'),
    HTTP_SERVER_URL: z.string().min(1, 'HTTP_SERVER_URL is required'),
    WS_PORT: z.string().optional().default('3001'),
    // Production-only
    INTERNAL_SECRET: isProd
      ? z.string().min(32, 'INTERNAL_SECRET must be at least 32 characters in production')
      : z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    FRONTEND_URL: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
  })
  .refine(data => data.JWT_SECRET !== data.INTERNAL_SECRET, {
    message: 'JWT_SECRET and INTERNAL_SECRET must be different values',
  });

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console -- boot-time fatal diagnostics before logger init
    console.error('FATAL: Environment validation failed:');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console -- boot-time fatal diagnostics before logger init
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = validateEnv();
