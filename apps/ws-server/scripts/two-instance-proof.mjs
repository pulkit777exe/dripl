/**
 * Two-instance proof for ADR-002 (room ownership).
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * It boots **two real ws-server processes** against **one real Redis** (reached
 * through the Upstash-REST shim, because `@upstash/redis` only speaks REST) and
 * **one real Postgres**, then asserts the claims this change makes:
 *
 *   1. Exactly one instance serves a room. A second client that lands on the
 *      other instance is refused with code 4010 and that instance creates no
 *      `RoomState` — the refusal is observable on the wire and in `/metrics`.
 *   2. A scene mutation made on the owning instance is persisted through the
 *      existing fenced save path, so the durable authority is unchanged.
 *   3. Killing the owner hands the room over: the surviving instance acquires
 *      the lease after expiry, reloads the room from Postgres, and serves it.
 *      The handover is clean precisely because there was only ever one writer.
 *   4. The second instance never admitted a mutation for that room, so no
 *      divergent `RoomState` was ever produced (proved by the persisted scene).
 *
 * It does NOT prove: CRDT convergence (the protocol is still versioned JSON
 * deltas), zero-data-loss handover (see the `lostWindowMs` note in step 3), or
 * anything about http-server, which owns its own process-local ticket state and
 * is out of scope for this ADR.
 *
 * Prerequisites (all local, nothing touches production):
 *   docker run -d --name dripl-verify-redis -p 16379:6379 redis:7-alpine
 *   docker run -d --name dripl-verify-pg -e POSTGRES_USER=proof \
 *     -e POSTGRES_PASSWORD=proof -e POSTGRES_DB=dripl -p 15432:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://proof:proof@127.0.0.1:15432/dripl pnpm --filter @dripl/db \
 *     exec prisma migrate deploy
 *
 * Usage: node scripts/two-instance-proof.mjs [--keep]
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createUpstashRestShim } from './upstash-rest-shim.mjs';
import {
  PG_URL,
  REDIS_PORT,
  ensurePostgres,
  ensureRedis,
  killStaleWsServers,
  psql,
} from './local-proof-stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');

const SHIM_PORT = 18099;
const TICKET_PORT = 13999;
const INSTANCE_A_PORT = 13101;
const INSTANCE_B_PORT = 13102;
const CONTROL_A_PORT = 13103;
const CONTROL_B_PORT = 13104;
const OWNER_ID = 'proof-owner';
const ROOM_ID = `proof-room-${Date.now()}`;

const results = [];
const spawned = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stderr.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

/** On any abort, the instance logs and the shim's command log are the only evidence. */
let shimRef = null;
function dumpInstanceLogs() {
  for (const instance of spawned) {
    process.stderr.write(`\n----- instance ${instance.label} (port ${instance.port}) -----\n`);
    process.stderr.write(instance.logText().slice(-4000));
    process.stderr.write(`\n----- end ${instance.label} -----\n`);
  }
  if (shimRef) {
    process.stderr.write(`\n----- shim commands (${shimRef.commandLog.length}) -----\n`);
    for (const entry of shimRef.commandLog) {
      process.stderr.write(
        `  ${entry.done ? 'done ' : 'HUNG '} ${entry.source}: ${entry.args[0]}\n`
      );
    }
  }
}

function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

async function httpJson(url, init) {
  const response = await fetch(url, init);
  return response.json();
}

/**
 * Stub for http-server's `/internal/validate-ticket`. ws-server delegates every
 * ticket to http-server over HTTP, and http-server's own ticket store is the
 * other half of ADR-002 (not owned here). A stub keeps this proof about
 * ws-server without standing up a service this change does not touch.
 *
 * Every ticket resolves to the seeded room owner, because the proof needs two
 * clients in one room and the room has exactly one owner. Distinct users would
 * be denied by `authorizeRoomAccess`, and the same user twice in one room is
 * fine here precisely because the two clients live on different instances.
 */
async function startTicketStub() {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ kind: 'user', userId: OWNER_ID }));
    });
  });
  server.listen(TICKET_PORT, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function startInstance(label, port, extraEnv = {}) {
  const child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // The repo `.env` carries production credentials and NODE_ENV=production;
      // dotenv never overrides an already-set variable, so these win.
      DATABASE_URL: PG_URL,
      JWT_SECRET: 'proof-secret',
      INTERNAL_SECRET: 'proof-internal-secret',
      HTTP_SERVER_URL: `http://127.0.0.1:${TICKET_PORT}`,
      WS_PORT: String(port),
      PORT: String(port),
      FRONTEND_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${SHIM_PORT}`,
      UPSTASH_REDIS_REST_TOKEN: 'proof-token',
      // Short lease so the handover step does not take 20 seconds.
      WS_ROOM_LEASE_TTL_MS: '3000',
      WS_ROOM_LEASE_RENEW_MS: '800',
      PERIODIC_SAVE_INTERVAL_MS: '1000',
      SAVE_DEBOUNCE_MS: '500',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const collect = chunk => {
    const text = chunk.toString();
    logs.push(text);
    if (process.env.PROOF_VERBOSE === '1') process.stderr.write(`[${label}] ${text}`);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return {
    label,
    port,
    child,
    logs,
    logText: () => logs.join(''),
    hasLog: needle => logs.join('').includes(needle),
  };
}

async function stopInstance(instance, signal = 'SIGTERM') {
  if (instance.child.exitCode !== null) return;
  instance.child.kill(signal);
  await Promise.race([once(instance.child, 'exit'), new Promise(r => setTimeout(r, 8000))]);
  if (instance.child.exitCode === null) instance.child.kill('SIGKILL');
}

async function connect(port, ticket) {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  // Without an error listener `ws` re-emits as an unhandled 'error' event and
  // kills the proof process, which would hide the real failure.
  client.on('error', err => process.stderr.write(`[client:${port}] ${err.message}\n`));
  await Promise.race([
    once(client, 'open'),
    once(client, 'error').then(([err]) => {
      throw err;
    }),
  ]);
  const messages = [];
  const waiters = [];
  client.on('message', raw => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  const closed = new Promise(resolve =>
    client.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  );
  return {
    client,
    messages,
    closed,
    waitFor(predicate, timeoutMs = 8_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          // Include what the server *did* say: a silent timeout is otherwise
          // indistinguishable from a hang, and the usual cause is a refusal
          // message the proof was not looking for.
          reject(
            new Error(
              `timed out waiting for message; received: ${JSON.stringify(messages).slice(0, 300)}`
            )
          );
        }, timeoutMs).unref();
      });
    },
    join(roomId, displayName) {
      client.send(JSON.stringify({ type: 'join', roomId, displayName, color: '#123456' }));
    },
  };
}

const ELEMENT = {
  id: 'proof-element-1',
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 120,
  height: 80,
  version: 1,
  versionNonce: 42,
  fractionalIndex: 'a0',
};

async function main() {
  // A previous aborted run leaves `tsx src/index.ts` children holding the proof
  // ports. `waitForPort` would then pass against a *stale* server and every
  // later assertion would be measuring the wrong process.
  await ensureRedis();
  await ensurePostgres();
  const killed = await killStaleWsServers([
    INSTANCE_A_PORT,
    INSTANCE_B_PORT,
    CONTROL_A_PORT,
    CONTROL_B_PORT,
  ]);
  if (killed.length > 0)
    process.stderr.write(`killed stale proof instances: ${killed.join(', ')}\n`);

  const shim = createUpstashRestShim({
    redisHost: '127.0.0.1',
    redisPort: REDIS_PORT,
    httpPort: SHIM_PORT,
    // Off by default (it is noisy), but essential when a step fails: the shim
    // log is the only record of whether the server actually reached Redis.
    quiet: process.env.PROOF_VERBOSE !== '1',
  });
  shimRef = shim;
  await shim.listen();
  const ticketStub = await startTicketStub();

  // Seed one owner + one room so the access check passes. Raw SQL through the
  // container keeps this independent of the Prisma client's exports map, which
  // is not part of what this proof is about.
  psql(
    `insert into "User" (id, email, "createdAt", "updatedAt") values ('${OWNER_ID}', 'proof@example.com', now(), now()) on conflict (id) do nothing;`
  );
  psql(
    `insert into "File" (id, name, content, "userId", "createdAt", "updatedAt") values ('${ROOM_ID}', 'proof', '{"elements":[]}', '${OWNER_ID}', now(), now()) on conflict (id) do nothing;`
  );
  check('seeded one owner and one room in the proof database', true);

  const instanceA = startInstance('A', INSTANCE_A_PORT);
  const instanceB = startInstance('B', INSTANCE_B_PORT);
  spawned.push(instanceA, instanceB);
  try {
    await Promise.all([waitForPort(INSTANCE_A_PORT), waitForPort(INSTANCE_B_PORT)]);
    await Promise.all([waitForPort(SHIM_PORT), waitForPort(TICKET_PORT)]);
    check('both ws-server instances booted', true, `A=${INSTANCE_A_PORT} B=${INSTANCE_B_PORT}`);

    // --- Step 1: the first instance to be asked owns the room. ---
    const onA = await connect(INSTANCE_A_PORT, 'a1');
    onA.join(ROOM_ID, 'Editor A');
    const syncA = await onA.waitFor(m => m.type === 'sync_room_state');
    check('instance A serves the room', syncA.roomId === ROOM_ID);

    // --- Step 2: a second client landing on the other instance is refused. ---
    const onB = await connect(INSTANCE_B_PORT, 'b1');
    onB.join(ROOM_ID, 'Editor B');
    const refusal = await onB
      .waitFor(m => m.type === 'error' && m.code === 'room_served_by_another_instance', 8_000)
      .catch(() => null);
    const closeB = await Promise.race([
      onB.closed,
      new Promise(r => setTimeout(() => r({ code: -1 }), 4000)),
    ]);
    check('instance B refuses the join', refusal !== null, `code=${refusal?.code}`);
    check(
      'instance B closes the refused socket with 4010',
      closeB.code === 4010,
      `got ${closeB.code}`
    );

    // The refused instance must hold no scene at all. `/metrics` counts rooms.
    const metricsB = await httpJson(`http://127.0.0.1:${INSTANCE_B_PORT}/metrics`);
    const metricsA = await httpJson(`http://127.0.0.1:${INSTANCE_A_PORT}/metrics`);
    check(
      'instance B created no RoomState for the room',
      metricsB.activeRooms === 0,
      `B.activeRooms=${metricsB.activeRooms}`
    );
    check(
      'instance A created exactly one RoomState',
      metricsA.activeRooms === 1,
      `A.activeRooms=${metricsA.activeRooms}`
    );

    // --- Step 3: a mutation on the owner persists through the fenced save. ---
    onA.client.send(
      JSON.stringify({ type: 'scene-delta', added: [ELEMENT], clientMsgId: 'proof-msg-1' })
    );
    // Give the debounce + periodic tick time to persist.
    await new Promise(resolve => setTimeout(resolve, 2500));
    const sceneAfterMutation = await readStoredScene(ROOM_ID);
    check(
      'owner mutation reached the durable Postgres scene',
      sceneAfterMutation.elements?.some(el => el.id === ELEMENT.id) === true,
      JSON.stringify(sceneAfterMutation).slice(0, 120)
    );

    // --- Step 4: kill the owner; the survivor takes the room over. ---
    //
    // A is killed hard (SIGKILL), not gracefully, so this measures the crash
    // path a lease TTL exists for rather than the clean `shutdown()` release.
    const handoverStart = Date.now();
    instanceA.child.kill('SIGKILL');
    await Promise.race([once(instanceA.child, 'exit'), new Promise(r => setTimeout(r, 5000))]);
    check('owner was killed without a graceful release', instanceA.child.signalCode === 'SIGKILL');

    // Retry until the lease expires. Each attempt must be fully closed before
    // the next: the ticket stub resolves every ticket to the same user id, and a
    // second live connection for that user in one room is rejected as a
    // duplicate tab regardless of which instance holds the lease.
    let survivor = null;
    let syncB = null;
    let attempts = 0;
    const survivorJoinAt = Date.now();
    while (attempts < 12) {
      attempts += 1;
      const candidate = await connect(INSTANCE_B_PORT, `b${attempts}`);
      candidate.join(ROOM_ID, `Editor B${attempts}`);
      const result = await candidate
        .waitFor(
          m =>
            m.type === 'sync_room_state' ||
            (m.type === 'error' && m.code === 'room_served_by_another_instance'),
          1_500
        )
        .catch(() => null);
      if (result?.type === 'sync_room_state') {
        survivor = candidate;
        syncB = result;
        break;
      }
      candidate.client.close();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    check(
      'survivor takes the room over after lease expiry',
      syncB !== null,
      `after ${attempts} attempt(s), ${Date.now() - handoverStart}ms`
    );
    if (syncB) {
      check(
        'the new owner reloaded the persisted scene, not an empty room',
        syncB.elements?.some(el => el.id === ELEMENT.id) === true,
        `elements=${JSON.stringify(syncB.elements)?.slice(0, 120)}`
      );
      check(
        'handover waited for the lease to expire rather than happening instantly',
        Date.now() - survivorJoinAt >= 1_000,
        `${Date.now() - survivorJoinAt}ms (lease TTL is 3000ms; a graceful release would make this ~0)`
      );
    }

    // --- Step 5: the new owner can mutate, and nobody else is writing. ---
    if (syncB) {
      const ELEMENT2 = {
        ...ELEMENT,
        id: 'proof-element-2',
        x: 200,
        version: 1,
        versionNonce: 7,
        fractionalIndex: 'a1',
      };
      survivor.client.send(
        JSON.stringify({ type: 'scene-delta', added: [ELEMENT2], clientMsgId: 'proof-msg-2' })
      );
      await new Promise(resolve => setTimeout(resolve, 2500));
      const finalScene = await readStoredScene(ROOM_ID);
      check(
        'post-handover mutation persisted',
        finalScene.elements?.some(el => el.id === ELEMENT2.id) === true
      );
      check(
        'the pre-handover element survived the handover',
        finalScene.elements?.some(el => el.id === ELEMENT.id) === true
      );
    }

    await stopInstance(instanceB);
    // Run the control last: it leaves two instances deliberately unguarded, and
    // the main scenario's assertions must not be perturbed by them.
    await runControlScenario();
  } finally {
    await stopInstance(instanceA);
    await stopInstance(instanceB);
    shim.close();
    ticketStub.close();
  }
  if (process.argv.includes('--keep')) {
    process.stderr.write('\n--keep: local proof containers left running\n');
  }
}

/**
 * CONTROL: the same two instances with ownership switched off.
 *
 * This is the pre-ADR-002 condition, run on purpose. It exists so the refusals
 * above are attributable to the lease rather than to something incidental about
 * the harness: with `WS_ROOM_OWNERSHIP=off`, both instances serve the same
 * room, each with its own authoritative `RoomState`, which is exactly the
 * divergence ADR-002 describes.
 *
 * It deliberately does NOT claim to demonstrate a specific lost edit. Proving
 * that needs a write race with a precise interleaving, and asserting it here
 * would be asserting something this script has not actually shown.
 */
async function runControlScenario() {
  const controlRoom = `${ROOM_ID}-control`;
  psql(
    `insert into "File" (id, name, content, "userId", "createdAt", "updatedAt") values ('${controlRoom}', 'proof-control', '{"elements":[]}', '${OWNER_ID}', now(), now()) on conflict (id) do nothing;`
  );
  const a = startInstance('control-A', CONTROL_A_PORT, { WS_ROOM_OWNERSHIP: 'off' });
  const b = startInstance('control-B', CONTROL_B_PORT, { WS_ROOM_OWNERSHIP: 'off' });
  spawned.push(a, b);
  try {
    await Promise.all([waitForPort(CONTROL_A_PORT), waitForPort(CONTROL_B_PORT)]);
    const onA = await connect(CONTROL_A_PORT, 'ca');
    onA.join(controlRoom, 'Control A');
    const syncA = await onA.waitFor(m => m.type === 'sync_room_state', 8_000).catch(() => null);
    const onB = await connect(CONTROL_B_PORT, 'cb');
    onB.join(controlRoom, 'Control B');
    const syncB = await onB.waitFor(m => m.type === 'sync_room_state', 8_000).catch(() => null);
    check('CONTROL: with ownership off, instance A serves the room', syncA !== null);
    check(
      'CONTROL: with ownership off, instance B ALSO serves the same room',
      syncB !== null,
      'this is the two-authorities condition ADR-002 removes'
    );
    const metricsA = await httpJson(`http://127.0.0.1:${CONTROL_A_PORT}/metrics`);
    const metricsB = await httpJson(`http://127.0.0.1:${CONTROL_B_PORT}/metrics`);
    check(
      'CONTROL: both instances hold a RoomState for the same room',
      metricsA.activeRooms === 1 && metricsB.activeRooms === 1,
      `A=${metricsA.activeRooms} B=${metricsB.activeRooms}`
    );
    check(
      'CONTROL: neither instance recorded a room-ownership conflict',
      !a.hasLog('room_ownership_conflict') && !b.hasLog('room_ownership_conflict')
    );
  } finally {
    await stopInstance(a);
    await stopInstance(b);
  }
}

async function readStoredScene(roomId) {
  const output = psql(`select content from "File" where id = '${roomId}'`);
  try {
    return JSON.parse(output.trim());
  } catch {
    return { elements: [] };
  }
}

const failures = await main().then(
  () => results.filter(r => !r.pass),
  err => {
    process.stderr.write(`\nproof aborted: ${err?.stack ?? err}\n`);
    dumpInstanceLogs();
    return [{ name: 'proof completed without throwing', pass: false, detail: String(err) }];
  }
);

process.stderr.write(
  `\n${results.length - failures.length}/${results.length} two-instance checks passed\n`
);
if (failures.length > 0) {
  // A failed check is far harder to read without the server-side evidence.
  process.stderr.write('\n');
  dumpInstanceLogs();
}
process.exit(failures.length === 0 ? 0 : 1);
