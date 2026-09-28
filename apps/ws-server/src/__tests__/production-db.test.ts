/**
 * Two-client collaboration against a real, migrated PostgreSQL database.
 *
 * `production-integration.test.ts` proves the protocol coordinator works, but it
 * mocks `@dripl/db`, so every query it touches is a stub: nothing here has ever
 * executed the real Prisma calls that decide access and persist a scene. This
 * file closes that gap.
 *
 * What is real here: the database, the seven migrations, Prisma, the room
 * authorization queries, the optimistic-concurrency fence on save, and two real
 * WebSocket clients speaking the wire protocol.
 *
 * What is still stubbed: the ticket exchange with the HTTP server. That is a
 * separate seam covered by the HTTP suite, and stubbing it keeps this file
 * pointed at persistence and authorization. It is named in the describe block so
 * nobody mistakes this for full end-to-end coverage.
 *
 * Opt-in, because it needs a disposable migrated database:
 *
 *   docker run -d --name dripl-pg-test -e POSTGRES_PASSWORD=dripl \
 *     -e POSTGRES_USER=dripl -e POSTGRES_DB=dripl_test -p 55432:5432 postgres:latest
 *   (cd packages/db && DATABASE_URL=... pnpm exec prisma migrate deploy)
 *   RUN_WS_DB_INTEGRATION=true DATABASE_URL=... pnpm --filter ws-server test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { db, initializeDb } from '@dripl/db';

// The ticket exchange is the one seam left stubbed; see the file header.
const validateTicket = vi.fn(async (ticket: string) => ({ kind: 'user' as const, userId: ticket }));
vi.mock('../auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../auth')>();
  return { ...actual, validateTicket };
});

const run = process.env.RUN_WS_DB_INTEGRATION === 'true';
const describeDb = run ? describe : describe.skip;

const SAVE_DEBOUNCE_MS = 2_000;

/**
 * Tests that wait for a real debounced write to PostgreSQL need longer than
 * Vitest's 5 s default. The budget covers the 2 s save debounce plus the time
 * to poll the column back.
 */
const SLOW_TEST_TIMEOUT_MS = 20_000;

type Message = Record<string, unknown>;

function nextMessage(
  client: WebSocket,
  predicate: (message: Message) => boolean,
  timeoutMs = 5_000
): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Message;
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.off('message', onMessage);
      resolve(message);
    };
    client.on('message', onMessage);
  });
}

/**
 * Wait for the debounced save to land by reading the column back. Polling the
 * database rather than sleeping a fixed time is what makes the persistence
 * assertions real: they observe the write, they do not assume it happened.
 */
async function waitForStoredElement(
  fileId: string,
  elementId: string,
  timeoutMs = SAVE_DEBOUNCE_MS * 4
): Promise<Message | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const file = await db.file.findUnique({ where: { id: fileId }, select: { content: true } });
    const parsed = JSON.parse(file?.content ?? '{}') as {
      elements?: Message[];
    };
    const found = parsed.elements?.find(element => element.id === elementId);
    if (found) return found;
    if (Date.now() > deadline) return undefined;
    await new Promise(done => setTimeout(done, 150));
  }
}

/** How many times an element id appears in the stored scene. */
async function storedElementCount(fileId: string, elementId: string): Promise<number> {
  const file = await db.file.findUnique({ where: { id: fileId }, select: { content: true } });
  const parsed = JSON.parse(file?.content ?? '{}') as { elements?: Message[] };
  return parsed.elements?.filter(element => element.id === elementId).length ?? 0;
}

function rectangle(id: string, x: number, version = 1) {
  return { id, type: 'rectangle', x, y: 0, width: 100, height: 80, version, versionNonce: version };
}

/**
 * A denied join is not an error message; the server closes the socket with 4003.
 * Asserting on the close is what distinguishes "denied" from "the server never
 * answered", so a hang here fails loudly instead of passing vacuously.
 */
function waitForClose(client: WebSocket, timeoutMs = 5_000): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeoutMs);
    client.once('close', code => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
}

describeDb('collaboration against a real PostgreSQL database', () => {
  let server: import('node:http').Server;
  let stopForTests: () => Promise<void>;
  let port: number;
  const seededUserIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_DB_INTEGRATION', 'true');
    // `index.ts` only calls `server.listen()` when NODE_ENV is not 'test' or
    // RUN_WS_INTEGRATION is set. Without this the socket never listens and the
    // `listening` await below hangs until the hook timeout. This is the flag the
    // module already exposes; reusing it keeps the startup gate unchanged.
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('JWT_SECRET', 'ws-db-integration-secret');
    vi.stubEnv('INTERNAL_SECRET', 'ws-db-integration-internal-secret');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

    // Deliberately no `vi.resetModules()` here. Resetting would hand the server
    // a *second* copy of `@dripl/db`, and the copy this test asserts through
    // would be the first — two Prisma clients, one of them uninitialised. The
    // dynamic import below is already the first load of the server module, so
    // env is stubbed by the time `env.ts` parses it.
    await initializeDb();

    const module = await import('../index');
    server = module.server;
    stopForTests = module.stopForTests;
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await stopForTests?.();
    for (const userId of seededUserIds) {
      await db.sharedFile.deleteMany({ where: { file: { userId } } });
      await db.file.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  /**
   * Each test gets its own file, and so its own room. Rooms are keyed by id and
   * live in process memory for the whole file, so sharing one room would let
   * one test's room state leak into the next.
   */
  async function seedFile(options: { shareWithViewer?: boolean } = {}) {
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const fileId = randomUUID();
    seededUserIds.push(ownerId, viewerId);

    await db.user.createMany({
      data: [
        { id: ownerId, email: `owner-${ownerId}@example.test`, emailVerified: true },
        { id: viewerId, email: `viewer-${viewerId}@example.test`, emailVerified: true },
      ],
    });
    await db.file.create({
      data: {
        id: fileId,
        userId: ownerId,
        name: 'DB Integration Canvas',
        content: JSON.stringify({ elements: [rectangle('seeded', 5)] }),
      },
    });
    if (options.shareWithViewer) {
      await db.sharedFile.create({ data: { fileId, userId: viewerId } });
    }
    return { ownerId, viewerId, fileId };
  }

  async function openClient(ticket: string) {
    const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    await once(client, 'open');
    return client;
  }

  async function joinRoom(client: WebSocket, roomId: string, displayName: string) {
    const sync = nextMessage(client, message => message.type === 'sync_room_state');
    client.send(JSON.stringify({ type: 'join', roomId, displayName, color: '#123456' }));
    return sync;
  }

  let open: WebSocket[] = [];
  beforeEach(() => {
    open = [];
  });
  afterAll(() => {
    for (const client of open) client.close();
  });

  it('loads a real stored scene into a joining client', async () => {
    const { ownerId, fileId } = await seedFile();
    const client = await openClient(ownerId);
    open.push(client);

    const sync = await joinRoom(client, fileId, 'Owner');
    const elements = sync.elements as Message[];
    expect(elements).toHaveLength(1);
    expect(elements[0]?.id).toBe('seeded');
    expect(sync.readOnly).toBe(false);
  });

  it(
    'persists a delta to the file row and a later client reads it back',
    async () => {
      const { ownerId, viewerId, fileId } = await seedFile({ shareWithViewer: true });
      const client = await openClient(ownerId);
      open.push(client);
      await joinRoom(client, fileId, 'Owner');

      client.send(JSON.stringify({ type: 'add_element', element: rectangle('persisted', 40) }));

      // The write itself: read the column back rather than trusting a log line.
      const stored = await waitForStoredElement(fileId, 'persisted');
      expect(stored).toBeDefined();
      expect(stored?.x).toBe(40);

      // A second, independent participant must receive the element that was just
      // written. The reader is the shared viewer rather than a second socket for
      // the owner on purpose: a room tracks one socket per user id, so reusing the
      // owner's ticket would displace the writer instead of adding a reader.
      const reader = await openClient(viewerId);
      open.push(reader);
      const sync = await joinRoom(reader, fileId, 'Viewer');
      expect((sync.elements as Message[]).map(element => element.id)).toContain('persisted');
    },
    SLOW_TEST_TIMEOUT_MS
  );

  it(
    'keeps a room alive and consistent when a client disconnects mid-scene',
    async () => {
      const { ownerId, viewerId, fileId } = await seedFile({ shareWithViewer: true });
      const owner = await openClient(ownerId);
      open.push(owner);
      await joinRoom(owner, fileId, 'Owner');

      const viewer = await openClient(viewerId);
      await joinRoom(viewer, fileId, 'Viewer');
      viewer.close();
      // The room must survive losing a participant rather than resetting to the
      // last database write.
      owner.send(JSON.stringify({ type: 'add_element', element: rectangle('after-leave', 60) }));
      const stored = await waitForStoredElement(fileId, 'after-leave');
      expect(stored).toBeDefined();
    },
    SLOW_TEST_TIMEOUT_MS
  );

  it(
    'denies write access to a shared viewer and ignores the mutation',
    async () => {
      const { ownerId, viewerId, fileId } = await seedFile({ shareWithViewer: true });
      const owner = await openClient(ownerId);
      open.push(owner);
      await joinRoom(owner, fileId, 'Owner');

      const viewer = await openClient(viewerId);
      open.push(viewer);
      expect((await joinRoom(viewer, fileId, 'Viewer')).readOnly).toBe(true);

      const rejection = nextMessage(viewer, message => message.type === 'error');
      viewer.send(JSON.stringify({ type: 'add_element', element: rectangle('viewer-write', 80) }));
      expect((await rejection).message).toMatch(/view-only/i);

      owner.send(JSON.stringify({ type: 'add_element', element: rectangle('owner-write', 90) }));
      await waitForStoredElement(fileId, 'owner-write');
      expect(await storedElementCount(fileId, 'viewer-write')).toBe(0);
    },
    SLOW_TEST_TIMEOUT_MS
  );

  it('denies a user with no relationship to the file at all', async () => {
    const { fileId } = await seedFile();
    const stranger = randomUUID();
    seededUserIds.push(stranger);
    await db.user.create({
      data: { id: stranger, email: `stranger-${stranger}@example.test`, emailVerified: true },
    });

    const client = await openClient(stranger);
    open.push(client);
    const closed = waitForClose(client);
    client.send(JSON.stringify({ type: 'join', roomId: fileId, displayName: 'Stranger' }));
    expect((await closed).code).toBe(4003);
  });

  it(
    'rejects a replayed element version and stores only the winner',
    async () => {
      const { ownerId, fileId } = await seedFile();
      const client = await openClient(ownerId);
      open.push(client);
      await joinRoom(client, fileId, 'Owner');

      client.send(JSON.stringify({ type: 'add_element', element: rectangle('contested', 10, 2) }));
      // Same id, same version: a replay, which must not overwrite or duplicate.
      client.send(JSON.stringify({ type: 'add_element', element: rectangle('contested', 999, 2) }));
      client.send(JSON.stringify({ type: 'add_element', element: rectangle('settle', 1) }));

      const stored = await waitForStoredElement(fileId, 'contested');
      expect(stored?.x).toBe(10);
      expect(await storedElementCount(fileId, 'contested')).toBe(1);
    },
    SLOW_TEST_TIMEOUT_MS
  );

  it(
    'applies a newer version over an older one',
    async () => {
      const { ownerId, fileId } = await seedFile();
      const client = await openClient(ownerId);
      open.push(client);
      await joinRoom(client, fileId, 'Owner');

      client.send(JSON.stringify({ type: 'add_element', element: rectangle('bumped', 10, 1) }));
      await waitForStoredElement(fileId, 'bumped');
      client.send(
        JSON.stringify({ type: 'update_element', element: { ...rectangle('bumped', 500, 7) } })
      );

      const deadline = Date.now() + SAVE_DEBOUNCE_MS * 4;
      let x: unknown;
      for (;;) {
        const file = await db.file.findUnique({ where: { id: fileId }, select: { content: true } });
        const parsed = JSON.parse(file?.content ?? '{}') as { elements?: Message[] };
        x = parsed.elements?.find(element => element.id === 'bumped')?.x;
        if (x === 500 || Date.now() > deadline) break;
        await new Promise(done => setTimeout(done, 150));
      }
      expect(x).toBe(500);
    },
    SLOW_TEST_TIMEOUT_MS
  );

  it(
    'does not write when the database row moved under the room',
    async () => {
      const { ownerId, fileId } = await seedFile();
      const client = await openClient(ownerId);
      open.push(client);
      await joinRoom(client, fileId, 'Owner');

      // A concurrent writer bumps the row, invalidating the room's optimistic
      // `updatedAt` fence. The room's save must lose rather than clobber it.
      await db.file.update({
        where: { id: fileId },
        data: { content: JSON.stringify({ elements: [rectangle('concurrent', 1)] }) },
      });
      client.send(JSON.stringify({ type: 'add_element', element: rectangle('fenced', 20) }));
      await new Promise(done => setTimeout(done, SAVE_DEBOUNCE_MS * 2));

      const file = await db.file.findUnique({ where: { id: fileId }, select: { content: true } });
      const ids = (JSON.parse(file?.content ?? '{}') as { elements?: Message[] }).elements?.map(
        element => element.id
      );
      expect(ids).toContain('concurrent');
    },
    SLOW_TEST_TIMEOUT_MS
  );

  it('revokes access once the share row is deleted', async () => {
    const { viewerId, fileId } = await seedFile({ shareWithViewer: true });
    const first = await openClient(viewerId);
    expect((await joinRoom(first, fileId, 'Viewer')).readOnly).toBe(true);
    first.close();

    await db.sharedFile.deleteMany({ where: { fileId, userId: viewerId } });

    const second = await openClient(viewerId);
    open.push(second);
    const closed = waitForClose(second);
    second.send(JSON.stringify({ type: 'join', roomId: fileId, displayName: 'Viewer' }));
    expect((await closed).code).toBe(4003);
  });
});
