import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

// Scratch soak test (not for CI gating): hammers the real process with
// concurrent clients and mutations, then checks convergence. Delete or
// quarantine if it ever flakes; its value is the findings, kept as
// deterministic tests elsewhere.
const dbMock = {
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn(),
  file: {
    findFirst: vi.fn().mockImplementation(async (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      if (id === 'file-1') {
        return {
          userId: 'owner',
          teamId: null,
          sharedWith: [],
          team: { members: [] },
          sharePermission: null,
          shareExpiresAt: null,
        };
      }
      return {
        userId: 'soak-owner',
        teamId: null,
        sharedWith: [],
        team: {
          members: [
            { userId: 'soak-u0' },
            { userId: 'soak-u1' },
            { userId: 'soak-u2' },
            { userId: 'soak-u3' },
            { userId: 'soak-u4' },
          ],
        },
        sharePermission: null,
        shareExpiresAt: null,
      };
    }),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    updateManyAndReturn: vi.fn().mockResolvedValue([{ updatedAt: new Date() }]),
  },
  canvasRoom: {
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn().mockResolvedValue([{ updatedAt: new Date() }]),
  },
};

vi.mock('@dripl/db', () => ({
  db: dbMock,
  initializeDb: dbMock.initializeDb,
}));

const validateTicket = vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket }));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

const run = process.env.RUN_WS_SOAK === 'true';
const describeSoak = run ? describe : describe.skip;

function openClient(port: number, ticket: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  return once(client, 'open').then(() => client);
}

function waitFor(
  client: WebSocket,
  predicate: (m: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
  label = 'message'
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error(`soak timeout waiting for ${label}`));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (!predicate(m)) return;
      } catch {
        return;
      }
      clearTimeout(timer);
      client.off('message', onMessage);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    };
    client.on('message', onMessage);
  });
}

const N_CLIENTS = 5;
const N_ROUNDS = 40;

describeSoak('ws-server soak', () => {
  let port: number;
  let stopForTests: () => Promise<void>;
  let rooms: Map<string, { elements: Map<string, { id: string; version: number }> }>;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('JWT_SECRET', 'ws-soak-secret');
    vi.stubEnv('INTERNAL_SECRET', 'ws-soak-internal-secret');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();
    const module = await import('../index');
    const srv = module.server;
    stopForTests = module.stopForTests;
    if (!srv.listening) await once(srv, 'listening');
    port = (srv.address() as AddressInfo).port;
    rooms = (await import('../rooms')).rooms as never;
  }, 30_000);

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('converges under concurrent multi-client mutation load', async () => {
    const clients: WebSocket[] = [];
    const syncs: Promise<Record<string, unknown>>[] = [];
    for (let i = 0; i < N_CLIENTS; i++) {
      const c = await openClient(port, `soak-u${i}`);
      clients.push(c);
      // Attach the listener before sending: syncs can arrive immediately.
      syncs.push(waitFor(c, m => m.type === 'sync_room_state', 10_000, 'initial-sync'));
    }
    clients.forEach((c, i) => {
      c.send(JSON.stringify({ type: 'join', roomId: 'room-soak', displayName: `U${i}` }));
    });
    await Promise.all(syncs);

    // Every client rapidly adds, bumps, and deletes disjoint element sets,
    // paced under the 30 msg/s rate limit (one round per 150ms tick).
    await Promise.all(
      clients.map((c, ci) =>
        (async () => {
          for (let r = 0; r < N_ROUNDS; r++) {
            const id = `soak-${ci}-${r}`;
            c.send(
              JSON.stringify({
                type: 'add_element',
                element: {
                  id,
                  type: 'rectangle',
                  x: r,
                  y: ci,
                  width: 10,
                  height: 10,
                  version: 1,
                  versionNonce: r + 1,
                },
              })
            );
            c.send(
              JSON.stringify({
                type: 'update_element',
                element: {
                  id,
                  type: 'rectangle',
                  x: r + 1,
                  y: ci,
                  width: 10,
                  height: 10,
                  version: 2,
                  versionNonce: r + 1001,
                },
              })
            );
            if (r % 2 === 0) {
              c.send(JSON.stringify({ type: 'delete_element', elementId: id }));
            }
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        })()
      )
    );

    // Let the per-connection serialization queues drain.
    await new Promise(resolve => setTimeout(resolve, 3_000));

    const room = rooms.get('room-soak');
    expect(room).toBeDefined();
    // Odd rounds survive per client: N_ROUNDS/2 each.
    const expected = new Set<string>();
    for (let ci = 0; ci < N_CLIENTS; ci++) {
      for (let r = 0; r < N_ROUNDS; r++) {
        if (r % 2 === 1) expected.add(`soak-${ci}-${r}`);
      }
    }
    expect(new Set(room!.elements.keys())).toEqual(expected);
    for (const el of room!.elements.values()) {
      expect(el.version).toBe(2);
    }

    // Server still responsive after the storm.
    const pinger = clients[0]!;
    const pong = waitFor(pinger, m => m.type === 'pong', 5_000, 'post-storm-pong');
    pinger.send(JSON.stringify({ type: 'ping' }));
    await pong;

    for (const c of clients) c.close();
  }, 60_000);
});
