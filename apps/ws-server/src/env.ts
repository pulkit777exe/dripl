import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../../.env');
const localEnvPath = path.resolve(__dirname, '../../../.env.local');
config({ path: envPath });
config({ path: localEnvPath, override: true });

const isProd = process.env.NODE_ENV === 'production';

// `JWT_SECRET` is deliberately NOT required here.
//
// ws-server holds no signing key. It never verifies a session JWT: a client
// proves who it is with a single-use ticket that `POST /api/auth/ws-ticket`
// minted, and http-server spends that ticket's 30 seconds redeeming it at
// `/internal/validate-ticket` behind `INTERNAL_SECRET`. `jsonwebtoken` is not a
// dependency of this package at all.
//
// Validating the variable anyway was a liability, not a compatibility shim: it
// put the signing key for every session in this service's environment, where a
// compromised or over-broad deploy of the WebSocket tier would hand it over
// along with the ability to mint tokens for any account. It also meant a
// rotation of that key had to be coordinated with a service that cannot use it,
// so an unrelated deploy could fail on a secret it has no use for.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
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
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Console is correct here: this runs at module load, before the pino
    // logger exists, and the process is about to exit.
    console.error('FATAL: Environment validation failed:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = validateEnv();
