/**
 * Local, throwaway infrastructure for the ADR-002 proofs.
 *
 * Both proof scripts need the same three things: a real Redis, a real
 * Postgres with the schema applied, and the shim that lets `@upstash/redis`
 * (REST-only) talk to that Redis. They live in containers named with a
 * `dripl-proof-` prefix so they cannot collide with, or be mistaken for, any
 * other local database.
 *
 * Nothing here touches a production resource. In particular the repo `.env`
 * holds real Upstash credentials and a remote Neon `DATABASE_URL`; the proof
 * scripts always override both.
 */
import { execFileSync } from 'node:child_process';

export const REDIS_CONTAINER = 'dripl-proof-redis';
export const PG_CONTAINER = 'dripl-proof-pg';
export const REDIS_PORT = 16379;
export const PG_PORT = 15432;
export const PG_URL = `postgresql://proof:proof@127.0.0.1:${PG_PORT}/dripl`;

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', ...options });
}

function containerRunning(name) {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', name]).trim() === 'true';
  } catch {
    return false;
  }
}

async function waitFor(fn, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* keep polling */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

export async function ensureRedis() {
  if (!containerRunning(REDIS_CONTAINER)) {
    docker(['rm', '-f', REDIS_CONTAINER], { stdio: 'ignore' });
    docker(['run', '-d', '--name', REDIS_CONTAINER, '-p', `${REDIS_PORT}:6379`, 'redis:7-alpine']);
  }
  await waitFor(
    () => docker(['exec', REDIS_CONTAINER, 'redis-cli', 'PING']).trim() === 'PONG',
    30_000,
    'redis'
  );
}

export async function ensurePostgres() {
  if (!containerRunning(PG_CONTAINER)) {
    docker(['rm', '-f', PG_CONTAINER], { stdio: 'ignore' });
    docker([
      'run',
      '-d',
      '--name',
      PG_CONTAINER,
      '-e',
      'POSTGRES_USER=proof',
      '-e',
      'POSTGRES_PASSWORD=proof',
      '-e',
      'POSTGRES_DB=dripl',
      '-p',
      `${PG_PORT}:5432`,
      'postgres:16-alpine',
    ]);
  }
  await waitFor(
    () => {
      docker(['exec', PG_CONTAINER, 'pg_isready', '-U', 'proof', '-d', 'dripl']);
      return true;
    },
    40_000,
    'postgres'
  );
  // Apply migrations only when the schema is absent, so a rerun is fast.
  const hasTable = await (async () => {
    try {
      return (
        docker([
          'exec',
          PG_CONTAINER,
          'psql',
          '-U',
          'proof',
          '-d',
          'dripl',
          '-tAc',
          `select to_regclass('"File"') is not null`,
        ]).trim() === 't'
      );
    } catch {
      return false;
    }
  })();
  if (!hasTable) {
    execFileSync('pnpm', ['--filter', '@dripl/db', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: `${PG_URL}?schema=public` },
      stdio: 'inherit',
    });
  }
}

export function psql(sql) {
  return docker(['exec', PG_CONTAINER, 'psql', '-U', 'proof', '-d', 'dripl', '-tAc', sql]);
}

/**
 * Kill ws-servers left behind by an earlier aborted proof run. The port arrives
 * through the environment rather than argv, so the match has to read
 * `/proc/<pid>/environ`; scoping it to this app's entrypoint and these ports is
 * what keeps it from touching anything else on the machine.
 */
export async function killStaleWsServers(ports, entrypoint = 'src/index.ts') {
  const { readdirSync, readFileSync } = await import('node:fs');
  const killed = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let argv;
    let environ;
    try {
      argv = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').join(' ');
      environ = readFileSync(`/proc/${entry}/environ`, 'utf8');
    } catch {
      continue; // exited between readdir and read
    }
    if (!argv.includes(entrypoint)) continue;
    if (!ports.some(port => new RegExp(`\\bWS_PORT=${port}\\b`).test(environ))) continue;
    killed.push(entry);
    try {
      process.kill(Number(entry), 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  if (killed.length > 0) await new Promise(resolve => setTimeout(resolve, 700));
  return killed;
}

export async function tearDown() {
  docker(['rm', '-f', REDIS_CONTAINER], { stdio: 'ignore' });
  docker(['rm', '-f', PG_CONTAINER], { stdio: 'ignore' });
}
