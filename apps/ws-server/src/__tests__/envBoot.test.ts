/**
 * The two remaining unreachable-looking branches in `env.ts`, exercised in a
 * child process because both of them end the process.
 *
 * `env.ts` validates its configuration at module load, before the logger
 * exists, and calls `process.exit(1)` on failure. In-process that would take the
 * test worker with it; a child process is the only honest way to assert on a
 * boot-time refusal.
 *
 * Note what is *not* asserted: `JWT_SECRET`. It was deliberately removed from
 * this schema (ws-server holds no signing key), so a deploy that no longer sets
 * it must boot. That is the regression this file's second case guards, and it is
 * asserted by booting successfully, not by asserting on output.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_MODULE = path.join(APP_DIR, 'src/env.ts');

interface BootResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function bootEnv(overrides: Record<string, string | undefined>): Promise<BootResult> {
  // `dotenv.config()` never overrides an already-set variable, so anything passed
  // here wins over the repo `.env`. The `DATABASE_URL: ''` default is the point:
  // it is what proves the override works, and it guarantees the real Neon URL in
  // `.env` cannot reach a child process of this suite. Every other case supplies
  // its own unreachable localhost URL, so nothing here ever opens a connection.
  const script = `import(${JSON.stringify(ENV_MODULE)}).then(m => {
    process.stdout.write('BOOTED ' + JSON.stringify({ wsPort: m.env.WS_PORT, hasInternal: Boolean(m.env.INTERNAL_SECRET) }));
  });`;
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      {
        cwd: APP_DIR,
        env: {
          ...process.env,
          DATABASE_URL: '',
          HTTP_SERVER_URL: '',
          WS_ROOM_OWNERSHIP: 'on',
          INTERNAL_SECRET: undefined,
          UPSTASH_REDIS_REST_URL: '',
          UPSTASH_REDIS_REST_TOKEN: '',
          SENTRY_DSN: '',
          FRONTEND_URL: '',
          NEXT_PUBLIC_APP_URL: '',
          NODE_ENV: 'test',
          ...overrides,
        },
      }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('boot-time environment validation', () => {
  it('refuses to boot without a database URL', async () => {
    // Regression: an empty `DATABASE_URL` used to sail through the schema. The
    // process then started, served `/live` (which touches no database), and only
    // failed on the first save — after a user had joined a room and edited.
    const result = await bootEnv({});
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('BOOTED');
    expect(result.stderr).toContain('DATABASE_URL');
  });

  it('refuses to boot without the internal secret it will call with', async () => {
    // `HTTP_SERVER_URL` with no `INTERNAL_SECRET` is the shape of a deploy that
    // wired the ticket endpoint but not its credential. Booting would accept
    // sockets and then reject every ticket at redemption.
    const result = await bootEnv({ DATABASE_URL: 'postgres://x:y@127.0.0.1:5432/x' });
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('BOOTED');
    expect(result.stderr).toContain('HTTP_SERVER_URL');
  });

  it('boots without JWT_SECRET, because this service holds no signing key', async () => {
    // The regression this guards is the opposite direction: if `JWT_SECRET` were
    // re-added as required, every correct deploy of ws-server would fail to
    // start. ws-server redeems single-use tickets over HTTP instead of
    // verifying a session JWT, so it must not need the key at all.
    const result = await bootEnv({
      DATABASE_URL: 'postgres://x:y@127.0.0.1:5432/x',
      HTTP_SERVER_URL: 'http://127.0.0.1:3999',
      INTERNAL_SECRET: 'a-secret-long-enough-for-the-test',
      JWT_SECRET: undefined,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BOOTED');
  });

  it('defaults the WebSocket port when none is configured', async () => {
    // The default is part of the contract the compose files and `render.yaml`
    // rely on; a schema change that dropped the default would silently move the
    // port rather than fail.
    const result = await bootEnv({
      DATABASE_URL: 'postgres://x:y@127.0.0.1:5432/x',
      HTTP_SERVER_URL: 'http://127.0.0.1:3999',
      WS_PORT: undefined,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"wsPort":"3001"');
  });

  it('demands a 32-character internal secret in production', async () => {
    // Production-only requirement. A short secret is refused at boot rather than
    // accepted and used to sign internal requests for the life of the process.
    const result = await bootEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x:y@127.0.0.1:5432/x',
      HTTP_SERVER_URL: 'http://127.0.0.1:3999',
      INTERNAL_SECRET: 'too-short',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('INTERNAL_SECRET');
  });
});
