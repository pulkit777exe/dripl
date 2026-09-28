import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

// Proves the save-pipeline wiring end-to-end (not just the tick logic covered
// in lifecycle.test.ts): with a short PERIODIC_SAVE_INTERVAL_MS, a mutation
// made through a real socket must reach the persistence layer without any
// explicit save call, and a clean room must not trigger further writes. Note
// the first assertion can be satisfied by either the debounced per-mutation
// save or the periodic sweep — both paths are exercised; the sweep-specific
// fence/TTL/GC decisions are pinned deterministically in lifecycle.test.ts.
const dbMock = {
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn(),
  file: {
    findFirst: vi.fn().mockImplementation(async (_args: unknown) => ({
      userId: 'ps-owner',
      teamId: null,
      sharedWith: [],
      team: { members: [{ userId: 'ps-owner' }] },
      sharePermission: null,
      shareExpiresAt: null,
    })),
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

function openClient(port: number, ticket: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  return once(client, 'open').then(() => client);
}

describe('periodic save wiring', () => {
  let port: number;
  let stopForTests: () => Promise<void>;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('PERIODIC_SAVE_INTERVAL_MS', '300');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('JWT_SECRET', 'ws-periodic-secret');
    vi.stubEnv('INTERNAL_SECRET', 'ws-periodic-internal-secret');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();
    const module = await import('../index');
    const server = module.server;
    stopForTests = module.stopForTests;
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('persists a socket mutation on the interval with no explicit save', async () => {
    const client = await openClient(port, 'ps-owner');
    const synced = new Promise<void>(resolve => {
      client.on('message', (raw: Buffer) => {
        try {
          if ((JSON.parse(raw.toString()) as { type?: string }).type === 'sync_room_state') {
            resolve();
          }
        } catch {
          // ignore non-JSON frames
        }
      });
    });
    client.send(JSON.stringify({ type: 'join', roomId: 'room-ps', displayName: 'A' }));
    await synced;
    client.send(
      JSON.stringify({
        type: 'add_element',
        element: {
          id: 'ps-1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          version: 1,
          versionNonce: 1,
        },
      })
    );

    await vi.waitFor(
      () => {
        expect(dbMock.file.updateManyAndReturn).toHaveBeenCalled();
      },
      { timeout: 10_000, interval: 200 }
    );
    const written = dbMock.file.updateManyAndReturn.mock.calls[0]?.[0] as {
      data: { content: string };
    };
    expect(written.data.content).toContain('ps-1');

    const callsAfterSave = dbMock.file.updateManyAndReturn.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 900));
    expect(dbMock.file.updateManyAndReturn.mock.calls.length).toBe(callsAfterSave);

    client.close();
  }, 30_000);
});
