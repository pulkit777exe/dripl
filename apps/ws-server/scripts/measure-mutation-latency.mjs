/**
 * Hot-path measurement for the ADR-002 room-ownership change.
 *
 * THE QUESTION: room ownership must not cost anything per scene mutation. This
 * measures that rather than asserting it, across three configurations run
 * through the identical harness:
 *
 *   baseline   the pre-change ws-server from git HEAD, no Redis. The reference.
 *   no-redis   the current ws-server with no Redis configured. This is the
 *              production configuration, and it must be indistinguishable from
 *              `baseline` — that is the "single-instance path keeps working
 *              exactly as it does today" claim.
 *   ownership  the current ws-server with Redis configured and ownership on,
 *              holding a real lease. Must match `baseline` too, because the
 *              lease must not appear on the mutation path at all.
 *
 * WHAT IS MEASURED: per-message latency from "client 1 sends a scene-delta" to
 * "client 2 receives the relayed scene-delta". Two clients on the same instance
 * means that span is the server's admission work plus its local fan-out and
 * nothing else — no network, no other instance. `client 1` is excluded from the
 * broadcast, so the relay is a real server-side emit rather than an echo.
 *
 * WHAT ELSE IS COUNTED: how many commands reach Redis per mutation. The shim
 * logs every forwarded command, so "commands per mutation" is a count, not an
 * estimate. The number to watch is the *difference* between the `baseline` and
 * `ownership` runs.
 *
 * Rate limiting is respected rather than defeated: the burst size stays under
 * the 30 msgs/s budget and each burst is followed by a pause, so the server is
 * never the reason a measurement is fast or slow.
 *
 * Usage: node scripts/measure-mutation-latency.mjs
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
const CURRENT_APP = path.resolve(HERE, '..');
/**
 * Where the pre-change tree lives. It is materialised out of git rather than
 * run in place because three other agents are editing the same working tree, so
 * checking anything out here would be destructive to their work.
 *
 *   mkdir -p "$PROOF_BASELINE_DIR"
 *   cd "$REPO" && git archive HEAD apps/ws-server \
 *     | tar -x -C "$PROOF_BASELINE_DIR" --strip-components=2
 *   ln -sfn "$REPO/apps/ws-server/node_modules" "$PROOF_BASELINE_DIR/node_modules"
 *
 * Verified below rather than assumed: a missing or wrong baseline would
 * silently turn the `baseline` row into a second run of the current code and
 * make every delta meaningless.
 */
const BASELINE_APP = process.env.PROOF_BASELINE_DIR ?? '/tmp/opencode/baseline-ws';

const SHIM_PORT = 18099;
const TICKET_PORT = 13999;
const OWNER_ID = 'proof-owner';
const TEAM_ID = 'proof-team';

/**
 * Two clients must share one room to measure the relay, but the server rejects
 * a second live connection for the same user as a duplicate tab. Team
 * membership is the only multi-user edit path `authorizeRoomAccess` grants
 * (`canEdit = isOwner || isTeamMember`), so both proof users join one team and
 * the latency room is a team file.
 */
const USERS = [`${OWNER_ID}-1`, `${OWNER_ID}-2`];

// Keep the two clients on distinct users: the server rejects a second live
// connection for the same user in one room as a duplicate tab, which would end
// the measurement early.
// One `scene-delta` message carries a burst of elements, so there are two
// different denominators in play and conflating them would be misleading:
// message latency (what the table reports) and per-element element counts.
// BURST_PAUSE_MS keeps the burst under the 30 msgs/s rate-limit budget.
const ELEMENTS = 480;
const BURST = 20;
const BURST_PAUSE_MS = 700;
const MESSAGES = ELEMENTS / BURST;
const ROOM_PREFIX = 'latency-room';

/**
 * Interleaved repetitions per scenario. One measurement of a sub-millisecond
 * effect on a shared machine is not a measurement; the reported figure is the
 * median across rounds and the per-round p50s are printed so the noise floor is
 * visible next to the delta being claimed.
 */
const REPEATS = Number(process.env.PROOF_REPEATS ?? 3);

function waitForPort(port, timeoutMs = 25_000) {
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

function element(id, x, version) {
  return {
    id,
    type: 'rectangle',
    x,
    y: 20,
    width: 100,
    height: 60,
    version,
    versionNonce: version * 1000,
    fractionalIndex: `a${version}`,
  };
}

function startServer(label, appDir, port, env) {
  const child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
    cwd: appDir,
    env: { ...process.env, ...env, WS_PORT: String(port), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const collect = chunk => logs.push(chunk.toString());
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return { label, child, logs, logText: () => logs.join('') };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill('SIGKILL');
  await Promise.race([once(server.child, 'exit'), new Promise(r => setTimeout(r, 5000))]);
}

function connect(port, ticket) {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  client.on('error', err => process.stderr.write(`[client:${port}] ${err.message}\n`));
  return once(client, 'open').then(() => {
    const received = [];
    client.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'scene-delta' && Array.isArray(message.added)) {
        received.push({ at: performance.now(), ids: message.added.map(el => el.id) });
      }
    });
    return { client, received, close: () => client.close() };
  });
}

async function startTicketStub() {
  const { createServer } = await import('node:http');
  let counter = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      counter += 1;
      // Two distinct users, both team members, so the duplicate-tab guard does
      // not end the measurement and neither client is read-only.
      const userId = USERS[(counter - 1) % USERS.length];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ kind: 'user', userId }));
    });
  });
  server.listen(TICKET_PORT, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function seedTeam() {
  psql(
    `insert into "User" (id, email, "createdAt", "updatedAt") values ('${OWNER_ID}', 'proof@example.com', now(), now()) on conflict (id) do nothing;`
  );
  for (const userId of USERS) {
    if (userId === OWNER_ID) continue;
    psql(
      `insert into "User" (id, email, "createdAt", "updatedAt") values ('${userId}', '${userId}@example.com', now(), now()) on conflict (id) do nothing;`
    );
  }
  psql(
    `insert into "Team" (id, name, slug, "createdAt", "updatedAt") values ('${TEAM_ID}', 'Proof Team', 'proof-team', now(), now()) on conflict (id) do nothing;`
  );
  for (const userId of USERS) {
    psql(
      `insert into "TeamMember" (id, role, "userId", "teamId", "createdAt", "updatedAt") values ('proof-membership-${userId}', 'MEMBER', '${userId}', '${TEAM_ID}', now(), now()) on conflict ("userId", "teamId") do nothing;`
    );
  }
}

function seedRoom(roomId) {
  psql(
    `insert into "File" (id, name, content, "userId", "teamId", "createdAt", "updatedAt") values ('${roomId}', 'latency', '{"elements":[]}', '${OWNER_ID}', '${TEAM_ID}', now(), now()) on conflict (id) do nothing;`
  );
}

async function runScenario({ label, appDir, port, useRedis, ownershipOff, shim, roomId }) {
  const server = startServer(label, appDir, port, {
    NODE_ENV: 'development',
    DATABASE_URL: PG_URL,
    JWT_SECRET: 'proof-secret',
    INTERNAL_SECRET: 'proof-internal-secret',
    HTTP_SERVER_URL: `http://127.0.0.1:${TICKET_PORT}`,
    FRONTEND_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    UPSTASH_REDIS_REST_URL: useRedis ? `http://127.0.0.1:${SHIM_PORT}` : '',
    UPSTASH_REDIS_REST_TOKEN: useRedis ? 'proof-token' : '',
    WS_ROOM_OWNERSHIP: ownershipOff ? 'off' : '',
    WS_ROOM_LEASE_TTL_MS: '30000',
    WS_ROOM_LEASE_RENEW_MS: '2000',
    // Long enough that neither the debounce nor the periodic tick runs during
    // the measurement: this is about the mutation path, not the save path.
    PERIODIC_SAVE_INTERVAL_MS: '600000',
    ACCESS_RECHECK_THROTTLE_MS: '600000',
  });
  try {
    await waitForPort(port);
    const sender = await connect(port, `${label}-sender`);
    const observer = await connect(port, `${label}-observer`);
    const messages = [];
    for (const socket of [sender, observer]) {
      socket.client.on('message', raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'sync_room_state') messages.push(message);
      });
    }
    sender.client.send(
      JSON.stringify({ type: 'join', roomId, displayName: 'Sender', color: '#111111' })
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
    observer.client.send(
      JSON.stringify({ type: 'join', roomId, displayName: 'Observer', color: '#222222' })
    );
    await new Promise(resolve => setTimeout(resolve, 1200));
    if (messages.length !== 2) {
      throw new Error(
        `${label}: expected 2 sync_room_state, got ${messages.length}: ${JSON.stringify(messages).slice(0, 400)}`
      );
    }
    if (messages.some(m => m.readOnly)) {
      throw new Error(`${label}: a client was read-only; team seeding failed`);
    }

    shim?.resetCommandLog();
    const sentAt = new Map();
    let index = 0;
    for (let burst = 0; burst < MESSAGES; burst += 1) {
      const payload = [];
      for (let i = 0; i < BURST; i += 1) {
        index += 1;
        const id = `${roomId}-el-${index}`;
        payload.push(element(id, index, index));
      }
      const at = performance.now();
      sender.client.send(
        JSON.stringify({
          type: 'scene-delta',
          added: payload,
          clientMsgId: `${roomId}-burst-${burst}`,
        })
      );
      for (const el of payload) sentAt.set(el.id, at);
      await new Promise(resolve => setTimeout(resolve, BURST_PAUSE_MS));
    }
    // Let the last burst drain.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const samples = [];
    for (const { at, ids } of observer.received) {
      for (const id of ids) {
        const sent = sentAt.get(id);
        if (sent !== undefined) samples.push(at - sent);
      }
    }
    samples.sort((a, b) => a - b);
    const percentile = p =>
      samples.length === 0
        ? NaN
        : samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];

    const commands = shim ? shim.commandLog.length : 0;
    const byCommand = {};
    for (const entry of shim?.commandLog ?? []) {
      byCommand[entry.command] = (byCommand[entry.command] ?? 0) + 1;
    }
    return {
      label,
      delivered: samples.length,
      sent: ELEMENTS,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      mean: samples.reduce((sum, value) => sum + value, 0) / (samples.length || 1),
      redisCommands: commands,
      redisPerMutation: commands / MESSAGES,
      messages: MESSAGES,
      byCommand,
    };
  } finally {
    await stopServer(server);
  }
}

async function main() {
  // A stale or missing baseline is the one failure mode that would make every
  // number below wrong without looking wrong, so it is checked explicitly:
  // the pre-change tree must not contain room ownership at all.
  const { existsSync, readFileSync } = await import('node:fs');
  if (!existsSync(path.join(BASELINE_APP, 'src/index.ts'))) {
    throw new Error(
      `baseline tree missing at ${BASELINE_APP}. Materialise it with:\n` +
        '  mkdir -p "$PROOF_BASELINE_DIR"\n' +
        '  cd "$REPO" && git archive HEAD apps/ws-server \\\n' +
        '    | tar -x -C "$PROOF_BASELINE_DIR" --strip-components=2\n' +
        '  ln -sfn "$REPO/apps/ws-server/node_modules" "$PROOF_BASELINE_DIR/node_modules"'
    );
  }
  if (existsSync(path.join(BASELINE_APP, 'src/roomOwnership.ts'))) {
    throw new Error(
      `${BASELINE_APP} already contains src/roomOwnership.ts, so it is not the pre-change tree`
    );
  }
  const baselineIndex = readFileSync(path.join(BASELINE_APP, 'src/index.ts'), 'utf8');
  if (baselineIndex.includes('acquireRoom')) {
    throw new Error(`${BASELINE_APP}/src/index.ts already references acquireRoom`);
  }
  process.stderr.write(`baseline tree verified as pre-change: ${BASELINE_APP}\n`);

  await ensureRedis();
  await ensurePostgres();
  const killed = await killStaleWsServers([13201, 13202, 13203, 13204]);
  if (killed.length > 0)
    process.stderr.write(`killed stale measurement servers: ${killed.join(', ')}\n`);

  const shim = createUpstashRestShim({
    redisHost: '127.0.0.1',
    redisPort: REDIS_PORT,
    httpPort: SHIM_PORT,
    quiet: true,
  });
  await shim.listen();
  const ticketStub = await startTicketStub();
  seedTeam();

  const scenarios = [
    { label: 'baseline', appDir: BASELINE_APP, port: 13201, useRedis: false },
    { label: 'no-redis', appDir: CURRENT_APP, port: 13202, useRedis: false },
    // The isolating scenario. Turning Redis on also switches `rateLimiter.ts`
    // from its in-memory bucket to the Upstash limiter, which costs one HTTP
    // round-trip per message — a pre-existing cost, not this change's. So the
    // only fair way to price the lease is to compare Redis-on/ownership-on
    // against Redis-on/ownership-off.
    { label: 'redis-no-own', appDir: CURRENT_APP, port: 13204, useRedis: true, ownershipOff: true },
    { label: 'ownership', appDir: CURRENT_APP, port: 13203, useRedis: true },
  ];

  // Interleave the repetitions. Running each scenario once in sequence let a
  // slow patch on the machine land entirely on one configuration and show up as
  // a several-millisecond "effect"; alternating order makes that drift hit both
  // sides of every comparison, so a real per-mutation cost has to survive it.
  const runs = [];
  try {
    for (let round = 0; round < REPEATS; round += 1) {
      const order = round % 2 === 0 ? scenarios : [...scenarios].reverse();
      for (const scenario of order) {
        const roomId = `${ROOM_PREFIX}-${scenario.label}-${round}-${Date.now()}`;
        seedRoom(roomId);
        process.stderr.write(`\n--- round ${round + 1}/${REPEATS}: ${scenario.label} ---\n`);
        const result = await runScenario({ ...scenario, shim, roomId });
        runs.push({ ...result, round });
      }
    }
  } finally {
    shim.close();
    ticketStub.close();
  }
  report(runs);
}

/** Median across rounds, so one slow round cannot carry a conclusion. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function report(runs) {
  const labels = [...new Set(runs.map(run => run.label))];
  const summary = labels.map(label => {
    const forLabel = runs.filter(run => run.label === label);
    return {
      label,
      rounds: forLabel.length,
      delivered: forLabel.reduce((sum, run) => sum + run.delivered, 0),
      sent: forLabel.reduce((sum, run) => sum + run.sent, 0),
      p50: median(forLabel.map(run => run.p50)),
      p95: median(forLabel.map(run => run.p95)),
      p99: median(forLabel.map(run => run.p99)),
      p50s: forLabel.map(run => run.p50),
      redisCommands: forLabel[forLabel.length - 1].redisCommands,
      byCommand: forLabel[forLabel.length - 1].byCommand,
      messages: forLabel[forLabel.length - 1].messages,
    };
  });

  process.stderr.write(
    `\n=== scene-delta hot path: median of ${REPEATS} interleaved round(s) ===\n`
  );
  process.stderr.write(
    `each round sends ${ELEMENTS} elements in ${MESSAGES} scene-delta messages; latency is per element relayed to the observer\n`
  );
  process.stderr.write(
    `${'scenario'.padEnd(14)}${'delivered'.padStart(12)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'p99 ms'.padStart(9)}${'p50 spread'.padStart(18)}  commands/round\n`
  );
  for (const entry of summary) {
    process.stderr.write(
      `${entry.label.padEnd(14)}${String(`${entry.delivered}/${entry.sent}`).padStart(12)}${entry.p50.toFixed(3).padStart(9)}${entry.p95.toFixed(3).padStart(9)}${entry.p99.toFixed(3).padStart(9)}${entry.p50s
        .map(v => v.toFixed(1))
        .join('/')
        .padStart(18)}  ${JSON.stringify(entry.byCommand)}\n`
    );
  }

  const byLabel = Object.fromEntries(summary.map(entry => [entry.label, entry]));
  const baseline = byLabel.baseline;
  const noRedis = byLabel['no-redis'];
  const redisNoOwn = byLabel['redis-no-own'];
  const ownership = byLabel.ownership;
  process.stderr.write('\n=== deltas (median p50 / p95) ===\n');
  process.stderr.write(
    `no-redis      vs baseline  : p50 ${fmt(noRedis.p50 - baseline.p50)} ms, p95 ${fmt(noRedis.p95 - baseline.p95)} ms  <- the single-instance path\n`
  );
  process.stderr.write(
    `redis-no-own vs baseline  : p50 ${fmt(redisNoOwn.p50 - baseline.p50)} ms, p95 ${fmt(redisNoOwn.p95 - baseline.p95)} ms  <- pre-existing Redis rate limiter\n`
  );
  process.stderr.write(
    `ownership     vs redis-no-own: p50 ${fmt(ownership.p50 - redisNoOwn.p50)} ms, p95 ${fmt(ownership.p95 - redisNoOwn.p95)} ms  <- THE LEASE'S COST\n`
  );
  process.stderr.write(
    `ownership     vs baseline  : p50 ${fmt(ownership.p50 - baseline.p50)} ms, p95 ${fmt(ownership.p95 - baseline.p95)} ms\n`
  );
  const spread = Math.max(
    ...ownership.p50s.map((_, index) => Math.abs(ownership.p50s[index] - redisNoOwn.p50s[index]))
  );
  process.stderr.write(
    `\nRound-to-round |ownership - redis-no-own| p50 difference: up to ${spread.toFixed(3)} ms,\n` +
      'which is the noise floor against which the lease delta above has to be read.\n'
  );
  process.stderr.write(
    `Redis commands per round: ownership ${ownership.redisCommands}, redis-no-own ${redisNoOwn.redisCommands}, delta ${fmt(ownership.redisCommands - redisNoOwn.redisCommands)}\n` +
      'The delta is EVAL only, and is the lease renewal tick: one command per held room per\n' +
      'WS_ROOM_LEASE_RENEW_MS. It is a function of elapsed time, not of the mutation count.\n'
  );
}

function fmt(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

await main();
