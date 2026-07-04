import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
config({ path: envPath });

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    HTTP_SERVER_URL: z.string().min(1, 'HTTP_SERVER_URL is required'),
    WS_PORT: z.string().optional().default('3001'),
    // Production-only
    INTERNAL_SECRET: isProd
      ? z.string().min(1, 'INTERNAL_SECRET is required in production')
      : z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    FRONTEND_URL: z.string().optional(),
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
