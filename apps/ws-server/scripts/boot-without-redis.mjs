/**
 * Dist-free boot proof for the Redis-absent path.
 *
 * `pnpm dev` boots ws-server from source with every `dist/` deleted in the tree
 * and with `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` blanked. Blanking
 * them matters: `pnpm dev` runs `dotenv -e ../../.env`, and the repo `.env`
 * carries real Upstash credentials, so without an explicit empty value the
 * "no Redis" configuration cannot be reached at all.
 *
 * It then opens a real WebSocket, joins a real room, and asserts the room is
 * served — the requirement is not merely "the process starts", it is "rooms
 * still run in memory". `/health` is checked separately because that is the
 * endpoint an orchestrator uses to decide the instance is up.
 *
 * Usage: node scripts/boot-without-redis.mjs [wsPort]
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { ensurePostgres, psql } from './local-proof-stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');
const WS_PORT = Number(process.argv[2] ?? 13401);
const TICKET_PORT = Number(process.argv[3] ?? 13998);
const PG_URL = 'postgresql://proof:proof@127.0.0.1:15432/dripl';
const ROOM_ID = `boot-room-${Date.now()}`;
const USER_ID = 'boot-user';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  process.stderr.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

async function startTicketStub() {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ kind: 'user', userId: USER_ID }));
    });
  });
  server.listen(TICKET_PORT, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

await ensurePostgres();
// Redis is deliberately not started and not referenced here: this proof is
// about the configuration where it is absent.

const stub = await startTicketStub();
psql(
  `insert into "User" (id, email, "createdAt", "updatedAt") values ('${USER_ID}', '${USER_ID}@example.com', now(), now()) on conflict (id) do nothing;`
);
psql(
  `insert into "File" (id, name, content, "userId", "createdAt", "updatedAt") values ('${ROOM_ID}', 'boot', '{"elements":[]}', '${USER_ID}', now(), now()) on conflict (id) do nothing;`
);

const logs = [];
const dev = spawn('pnpm', ['dev'], {
  cwd: APP_DIR,
  env: {
    ...process.env,
    // The repo `.env` sets NODE_ENV=production, which makes `env.ts` demand
    // 32-character secrets. `dotenv` never overrides a key that is already
    // present, so this is what makes the development posture explicit.
    NODE_ENV: 'development',
    WS_PORT: String(WS_PORT),
    PORT: String(WS_PORT),
    DATABASE_URL: PG_URL,
    JWT_SECRET: 'boot-proof-secret-long-enough-for-dev-mode-0001',
    INTERNAL_SECRET: 'boot-proof-internal-secret-long-enough-0002',
    HTTP_SERVER_URL: `http://127.0.0.1:${TICKET_PORT}`,
    FRONTEND_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    // Set (to empty) rather than unset: `dotenv -e ../../.env` runs as part of
    // `pnpm dev` and would otherwise re-inject the repo's real credentials.
    // dotenv never overrides a key that is already present.
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    WS_ROOM_OWNERSHIP: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const collect = chunk => logs.push(chunk.toString());
dev.stdout.on('data', collect);
dev.stderr.on('data', collect);

let exitCode = 0;
try {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (logs.join('').includes('websocket_server_started')) break;
    if (Date.now() > deadline) throw new Error('server never logged websocket_server_started');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check('dist-free `pnpm dev` reached websocket_server_started', true);

  const health = await fetch(`http://127.0.0.1:${WS_PORT}/health`);
  const healthBody = await health.json();
  check('GET /health returns 200', health.status === 200, `status=${health.status}`);
  check('GET /health reports ok', healthBody?.status === 'ok', JSON.stringify(healthBody));

  const client = new WebSocket(`ws://127.0.0.1:${WS_PORT}/?ticket=boot`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  client.on('error', () => undefined);
  await once(client, 'open');
  const received = [];
  client.on('message', raw => received.push(JSON.parse(raw.toString())));
  client.send(
    JSON.stringify({ type: 'join', roomId: ROOM_ID, displayName: 'Boot', color: '#334455' })
  );

  const joined = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 10_000);
    const poll = setInterval(() => {
      const sync = received.find(message => message.type === 'sync_room_state');
      if (sync) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve(sync);
      }
    }, 100);
  });
  check(
    'a room is served from memory with no Redis configured',
    joined !== null,
    JSON.stringify(received).slice(0, 200)
  );

  // The decisive assertion for this configuration: ownership never engaged.
  const ownershipEvents = logs.join('').match(/room_ownership_[a-z_]+/g) ?? [];
  check(
    'no room-ownership lease was ever taken',
    ownershipEvents.length === 0,
    ownershipEvents.join(',')
  );

  const metrics = await (await fetch(`http://127.0.0.1:${WS_PORT}/metrics`)).json();
  check(
    'the room is held in the process',
    metrics?.activeRooms === 1,
    `activeRooms=${metrics?.activeRooms}`
  );
  client.close();
} catch (err) {
  check(`boot proof completed: ${err.message}`, false);
  process.stderr.write(logs.join('').slice(-2000));
} finally {
  dev.kill('SIGTERM');
  await Promise.race([once(dev, 'exit'), new Promise(r => setTimeout(r, 8000))]);
  stub.close();
}

const failures = results.filter(result => !result.pass);
process.stderr.write(
  `\n${results.length - failures.length}/${results.length} dist-free boot checks passed\n`
);
process.exit(failures.length === 0 ? 0 : exitCode || 1);
