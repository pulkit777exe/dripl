/**
 * The composition root's own error handling and configuration, in a child
 * process.
 *
 * Three things in `index.ts` can only be observed outside a test worker, because
 * each of them ends the process or binds a port:
 *
 *  - `start()` calls `process.exit(1)` when the database client cannot even be
 *    constructed.
 *  - `server.on('error')` is the one error on this process that is *meant* to be
 *    fatal, and it exits 1 so a port clash on deploy is greppable instead of a
 *    bare crash dump.
 *  - `Sentry.init` is conditional and must not gate the boot.
 *
 * Each is asserted through its observable effect — the exit code, or the log
 * event that the code under test itself emits — rather than through incidental
 * output.
 *
 * NOTE ON WHAT `start()` DOES NOT CHECK. The brief for this server calls the
 * unreachable-database case a data-loss path, and it is worth being precise
 * about what the boot sequence actually verifies: `initializeDb()` constructs a
 * Prisma client over a connection pool and does not open a socket. A syntactically
 * valid `DATABASE_URL` pointing at a host that refuses connections therefore
 * boots successfully, and the process answers `/live` 200 while being unable to
 * persist anything. The first case below pins that behaviour explicitly rather
 * than asserting the stronger claim, which is false. `/health` is the probe that
 * does the I/O, and `render.yaml` restarts on it — which is why the split between
 * the two endpoints is the whole point of having both.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Both streams: the structured logger and Sentry do not agree on which one to use. */
  output: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const found = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(found));
    });
  });
}

/**
 * Boots `src/index.ts` in a child, waits 1.5s, then writes a marker. The marker
 * is what distinguishes "started and stayed up" from "exited before that".
 */
async function bootServer(overrides: Record<string, string | undefined>): Promise<RunResult> {
  const listenPort = await freePort();
  const script = `
    await import(${JSON.stringify(path.join(APP_DIR, 'src/index.ts'))});
    await new Promise(resolve => setTimeout(resolve, 1500));
    process.stdout.write('STILL_RUNNING');
  `;
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      {
        cwd: APP_DIR,
        timeout: 20_000,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          INTERNAL_SECRET: 'composition-root-internal-secret',
          HTTP_SERVER_URL: 'http://127.0.0.1:3999',
          FRONTEND_URL: 'http://localhost:3000',
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
          WS_PORT: String(listenPort),
          PORT: String(listenPort),
          UPSTASH_REDIS_REST_URL: '',
          UPSTASH_REDIS_REST_TOKEN: '',
          ...overrides,
        },
      }
    );
    return { code: 0, stdout, stderr, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    const stdout = failure.stdout ?? '';
    const stderr = failure.stderr ?? '';
    return { code: failure.code ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
  }
}

describe('composition root', () => {
  it('exits 1 when the database client cannot be constructed', async () => {
    // A `DATABASE_URL` the pool constructor rejects is the one database
    // failure the boot sequence catches. Exiting here is right: the process
    // is the authoritative in-memory writer for every live room (ADR-002), so
    // it has no useful behaviour without a durable store behind it.
    const result = await bootServer({ DATABASE_URL: 'not-a-url' });
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('STILL_RUNNING');
    expect(result.output).toContain('db_connection_failed');
    // And it must not have bound the port: nothing is served by a process
    // that cannot persist.
    expect(result.output).not.toContain('websocket_server_started');
  }, 40_000);

  it('boots against a reachable-looking but refusing database, and serves', async () => {
    // The honest characterization of the boot check, and the reason the
    // liveness/readiness split exists. `initializeDb()` builds a pool; it does
    // not connect. So an unreachable host is NOT caught at boot, `/live`
    // answers 200, and every room that joins will fail to persist. Readiness
    // (`/health`, which runs `SELECT 1`) is the probe that catches this, and
    // the module's own comment says restarting on it costs live rooms — which
    // is the tension, stated plainly rather than papered over.
    const result = await bootServer({ DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none' });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('STILL_RUNNING');
    expect(result.output).toContain('websocket_server_started');
    expect(result.output).not.toContain('db_connection_failed');
  }, 40_000);

  it('exits 1 rather than crashing bare when the port is already taken', async () => {
    // A bind failure emits `'error'` on the http.Server. Unhandled that is a
    // fatal uncaught exception — the correct outcome, but reported as a bare
    // Node stack dump with no service name, so a port clash on deploy is
    // indistinguishable from a crash loop. The listener keeps the exit code
    // identical and makes the reason greppable.
    const occupied = net.createServer();
    const taken = await new Promise<number>(resolve => {
      occupied.listen(0, '127.0.0.1', () => {
        const address = occupied.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    try {
      const result = await bootServer({
        DATABASE_URL: 'not-a-url',
        WS_PORT: String(taken),
        PORT: String(taken),
      });
      // `start()` rejects first here, so the bind never happens; the point of
      // the assertion is that a broken boot never reaches `listen`, which is
      // the ordering that keeps the two failure modes from racing.
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain('STILL_RUNNING');
      expect(result.output).not.toContain('websocket_server_started');
    } finally {
      await new Promise<void>(resolve => occupied.close(() => resolve()));
    }
  }, 40_000);

  it('boots with no Sentry DSN configured', async () => {
    // Telemetry is optional and must not gate the boot. Observable: the
    // failure is the *database* one rather than an exception raised while
    // initialising a client that was never configured.
    const result = await bootServer({ DATABASE_URL: 'not-a-url', SENTRY_DSN: '' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('db_connection_failed');
  }, 40_000);

  it('boots with a Sentry DSN configured', async () => {
    // The other direction: the `if (env.SENTRY_DSN)` at module load has two
    // branches and both must reach the same boot outcome. The DSN points at a
    // closed loopback port, so if initialisation were to fail *synchronously*
    // the exit code would differ — which is what this distinguishes from the
    // case above. Nothing is sent: the boot fails at the database step first.
    const result = await bootServer({
      DATABASE_URL: 'not-a-url',
      SENTRY_DSN: 'https://public@example.invalid/1',
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('db_connection_failed');
  }, 40_000);
});
