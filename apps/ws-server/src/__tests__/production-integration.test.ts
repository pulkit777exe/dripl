import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

const dbMock = {
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn(),
  file: {
    findFirst: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  canvasRoom: {
    findUnique: vi.fn().mockResolvedValue(null),
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

async function waitForMessage(
  client: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 3_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.off('message', onMessage);
      resolve(message);
    };
    client.on('message', onMessage);
  });
}

function openClient(port: number, ticket: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=${ticket}`, {
    headers: { Origin: 'http://localhost:3000' },
  });
  return once(client, 'open').then(() => client);
}

/**
 * Answer access queries per room. Test 1 stubs the file-1 record directly;
 * every other room resolves to a file owned by `ownerId` with `memberIds` as
 * team members (team membership grants edit, mirroring the real filtered
 * query in `authorizeRoomAccess`). Without this, the file-1 stub leaks into
 * fresh rooms and makes every client read-only there.
 */
function stubFileAccess(ownerId: string, memberIds: string[] = []): void {
  dbMock.file.findFirst.mockImplementation(async (args: unknown) => {
    const id = (args as { where: { id: string } }).where.id;
    if (id === 'file-1') {
      return {
        userId: 'owner',
        teamId: null,
        sharedWith: [{ userId: 'viewer' }],
        team: null,
        sharePermission: null,
        shareExpiresAt: null,
      };
    }
    return {
      userId: ownerId,
      teamId: null,
      sharedWith: [],
      team: memberIds.length > 0 ? { members: memberIds.map(userId => ({ userId })) } : null,
      sharePermission: null,
      shareExpiresAt: null,
    };
  });
}

describe('production WebSocket process', () => {
  let server: import('node:http').Server;
  let stopForTests: () => Promise<void>;
  let port: number;

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('JWT_SECRET', 'ws-integration-secret');
    vi.stubEnv('INTERNAL_SECRET', 'ws-integration-internal-secret');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();

    const module = await import('../index');
    server = module.server;
    stopForTests = module.stopForTests;
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('syncs two real clients, applies a delta, and rejects viewer mutations', async () => {
    dbMock.file.findFirst.mockResolvedValue({
      userId: 'owner',
      teamId: null,
      sharedWith: [{ userId: 'viewer' }],
      team: null,
      sharePermission: null,
      shareExpiresAt: null,
    });

    const first = await openClient(port, 'owner');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    first.send(
      JSON.stringify({
        type: 'join',
        roomId: 'file-1',
        displayName: 'Owner',
        color: '#123456',
      })
    );
    expect((await firstSync).readOnly).toBe(false);

    const second = await openClient(port, 'viewer');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    second.send(
      JSON.stringify({
        type: 'join',
        roomId: 'file-1',
        displayName: 'Viewer',
        color: '#654321',
      })
    );
    expect((await secondSync).readOnly).toBe(true);

    const receivedDelta = waitForMessage(second, message => message.type === 'scene-delta');
    first.send(
      JSON.stringify({
        type: 'scene-delta',
        added: [
          {
            id: 'real-element',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 100,
            height: 80,
            version: 1,
            versionNonce: 1,
          },
        ],
      })
    );
    expect((await receivedDelta).added).toHaveLength(1);

    const viewerError = waitForMessage(second, message => message.type === 'error');
    second.send(
      JSON.stringify({
        type: 'add_element',
        element: {
          id: 'viewer-element',
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
    expect((await viewerError).message).toMatch(/view-only/i);

    first.close();
    second.close();
  });

  it('broadcasts user-leave on explicit leave', async () => {
    stubFileAccess('leave-a', ['leave-b']);
    const first = await openClient(port, 'leave-a');
    const second = await openClient(port, 'leave-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-leave', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-leave', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const left = waitForMessage(
      first,
      message => message.type === 'user-leave' && message.userId === 'leave-b'
    );
    second.send(JSON.stringify({ type: 'leave' }));
    expect(await left).toMatchObject({ roomId: 'room-leave' });

    first.close();
    second.close();
  });

  it('broadcasts user-leave on abrupt close', async () => {
    stubFileAccess('close-a', ['close-b']);
    const first = await openClient(port, 'close-a');
    const second = await openClient(port, 'close-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-close', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-close', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const left = waitForMessage(
      first,
      message => message.type === 'user-leave' && message.userId === 'close-b'
    );
    second.terminate();
    expect(await left).toMatchObject({ roomId: 'room-close' });

    first.close();
  });

  it('fans add, update, and delete out to room members', async () => {
    stubFileAccess('elem-a', ['elem-b']);
    const first = await openClient(port, 'elem-a');
    const second = await openClient(port, 'elem-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-elem', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-elem', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const added = waitForMessage(
      second,
      message =>
        message.type === 'add_element' && (message.element as { id?: string })?.id === 'live-1'
    );
    first.send(
      JSON.stringify({
        type: 'add_element',
        element: {
          id: 'live-1',
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
    expect(await added).toBeDefined();

    const updated = waitForMessage(
      second,
      message =>
        message.type === 'update_element' && (message.element as { id?: string })?.id === 'live-1'
    );
    first.send(
      JSON.stringify({
        type: 'update_element',
        element: {
          id: 'live-1',
          type: 'rectangle',
          x: 5,
          y: 5,
          width: 10,
          height: 10,
          version: 2,
          versionNonce: 2,
        },
      })
    );
    expect(await updated).toBeDefined();

    const deleted = waitForMessage(
      second,
      message => message.type === 'delete_element' && message.elementId === 'live-1'
    );
    first.send(JSON.stringify({ type: 'delete_element', elementId: 'live-1' }));
    expect(await deleted).toBeDefined();

    first.close();
    second.close();
  });

  it('relays scene-update with the accepted elements', async () => {
    stubFileAccess('scene-a', ['scene-b']);
    const first = await openClient(port, 'scene-a');
    const second = await openClient(port, 'scene-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-scene', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-scene', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const relayed = waitForMessage(second, message => message.type === 'scene-update');
    first.send(
      JSON.stringify({
        type: 'scene-update',
        subtype: 'update',
        elements: [
          {
            id: 's-1',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            version: 1,
            versionNonce: 1,
          },
          {
            id: 's-2',
            type: 'ellipse',
            x: 20,
            y: 20,
            width: 10,
            height: 10,
            version: 1,
            versionNonce: 1,
          },
        ],
      })
    );
    const received = (await relayed) as { elements: Array<{ id: string }> };
    expect(received.elements.map(e => e.id).sort()).toEqual(['s-1', 's-2']);

    first.close();
    second.close();
  });

  it('relays element-update array and single branches', async () => {
    stubFileAccess('eu-a', ['eu-b']);
    const first = await openClient(port, 'eu-a');
    const second = await openClient(port, 'eu-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-eu', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-eu', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const batch = waitForMessage(
      second,
      message =>
        message.type === 'element-update' &&
        Array.isArray((message as { elements?: unknown }).elements)
    );
    first.send(
      JSON.stringify({
        type: 'element-update',
        elements: [
          {
            id: 'eu-1',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            version: 1,
            versionNonce: 1,
          },
        ],
      })
    );
    const batchReceived = (await batch) as { elements: Array<{ id: string }> };
    expect(batchReceived.elements.map(e => e.id)).toEqual(['eu-1']);

    const single = waitForMessage(
      second,
      message =>
        message.type === 'element-update' &&
        (message as { element?: { id?: string } }).element?.id === 'eu-1'
    );
    first.send(
      JSON.stringify({
        type: 'element-update',
        element: {
          id: 'eu-1',
          type: 'rectangle',
          x: 1,
          y: 1,
          width: 10,
          height: 10,
          version: 2,
          versionNonce: 2,
        },
      })
    );
    expect(await single).toBeDefined();

    first.close();
    second.close();
  });

  it('fans out cursor moves in both spellings', async () => {
    stubFileAccess('cursor-a', ['cursor-b']);
    const first = await openClient(port, 'cursor-a');
    const second = await openClient(port, 'cursor-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-cursor', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-cursor', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const snake = waitForMessage(
      second,
      message => message.type === 'cursor_move' && message.userId === 'cursor-a'
    );
    first.send(JSON.stringify({ type: 'cursor_move', x: 11, y: 22 }));
    expect(await snake).toMatchObject({ x: 11, y: 22 });

    const kebab = waitForMessage(
      second,
      message => message.type === 'cursor_move' && (message as { x?: number }).x === 33
    );
    first.send(JSON.stringify({ type: 'cursor-move', x: 33, y: 44 }));
    expect(await kebab).toMatchObject({ x: 33, y: 44 });

    first.close();
    second.close();
  });

  it('answers ping with pong', async () => {
    stubFileAccess('ping-a');
    const client = await openClient(port, 'ping-a');
    const sync = waitForMessage(client, message => message.type === 'sync_room_state');
    client.send(JSON.stringify({ type: 'join', roomId: 'room-ping', displayName: 'A' }));
    await sync;

    const pong = waitForMessage(client, message => message.type === 'pong');
    client.send(JSON.stringify({ type: 'ping' }));
    expect(await pong).toBeDefined();

    client.close();
  });

  it('notifies existing members when a user joins', async () => {
    stubFileAccess('join-a', ['join-b']);
    const first = await openClient(port, 'join-a');
    const second = await openClient(port, 'join-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-join', displayName: 'A' }));
    await firstSync;

    const joined = waitForMessage(
      first,
      message => message.type === 'user-join' && message.userId === 'join-b'
    );
    second.send(JSON.stringify({ type: 'join', roomId: 'room-join', displayName: 'B' }));
    await secondSync;
    expect(await joined).toMatchObject({ roomId: 'room-join' });

    first.close();
    second.close();
  });

  it('reconnects cleanly after an abrupt close', async () => {
    stubFileAccess('re-a', ['re-a']);
    const first = await openClient(port, 're-a');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-reconnect', displayName: 'A' }));
    await firstSync;
    first.terminate();
    // Let the server-side close handler release the registration; rejoining
    // before that lands would (correctly) hit the duplicate-connection guard.
    await new Promise(resolve => setTimeout(resolve, 300));

    const second = await openClient(port, 're-a');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    second.send(JSON.stringify({ type: 'join', roomId: 'room-reconnect', displayName: 'A' }));
    const sync = await secondSync;
    expect(sync).toMatchObject({ roomId: 'room-reconnect', yourUserId: 're-a' });

    second.close();
  });

  it('denies rejoin after access is revoked', async () => {
    stubFileAccess('rev-a', ['rev-a']);
    const first = await openClient(port, 'rev-a');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-revoke', displayName: 'A' }));
    await firstSync;
    first.terminate();
    await new Promise(resolve => setTimeout(resolve, 300));

    // Access disappears between sessions: no file, no room, no membership.
    dbMock.file.findFirst.mockResolvedValue(null);
    const second = await openClient(port, 'rev-a');
    const denied = new Promise<number>(resolve => {
      second.on('close', (code: number) => resolve(code));
    });
    second.send(JSON.stringify({ type: 'join', roomId: 'room-revoke', displayName: 'A' }));
    expect(await denied).toBe(4003);

    // Restore the per-room stub for later tests (mocks persist in this file).
    stubFileAccess('rev-a', ['rev-a']);
  });

  it('rejects connections with invalid tickets', async () => {
    validateTicket.mockImplementationOnce(
      async () => null as unknown as { kind: 'user'; userId: string }
    );
    const client = new WebSocket(`ws://127.0.0.1:${port}/?ticket=bogus`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    const code = await new Promise<number>(resolve => {
      client.on('close', (closeCode: number) => resolve(closeCode));
    });
    expect(code).toBe(4001);
  });

  it('serves a mutation burst from the join-time access decision', async () => {
    // The per-message access check is throttled per connection (revocation is
    // enforced by the 15s sweep instead): 5 rapid mutations must relay fully
    // while costing ~zero steady-state database reads.
    stubFileAccess('throttle-a', ['throttle-b']);
    const editor = await openClient(port, 'throttle-a');
    const editorSync = waitForMessage(editor, message => message.type === 'sync_room_state');
    editor.send(JSON.stringify({ type: 'join', roomId: 'room-throttle', displayName: 'A' }));
    expect((await editorSync).readOnly).toBe(false);

    const viewer = await openClient(port, 'throttle-b');
    const viewerSync = waitForMessage(viewer, message => message.type === 'sync_room_state');
    viewer.send(JSON.stringify({ type: 'join', roomId: 'room-throttle', displayName: 'B' }));
    await viewerSync;

    dbMock.file.findFirst.mockClear();
    const relayed: Record<string, unknown>[] = [];
    const allRelayed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for deltas')), 5_000);
      const onMessage = (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (message.type !== 'scene-delta') return;
        relayed.push(message);
        if (relayed.length === 5) {
          clearTimeout(timer);
          viewer.off('message', onMessage);
          resolve();
        }
      };
      viewer.on('message', onMessage);
    });
    for (let i = 0; i < 5; i++) {
      editor.send(
        JSON.stringify({
          type: 'scene-delta',
          added: [
            {
              id: `throttle-${i}`,
              type: 'rectangle',
              x: i * 10,
              y: 0,
              width: 100,
              height: 80,
              version: 1,
              versionNonce: 1,
            },
          ],
        })
      );
    }
    await allRelayed;
    expect(relayed).toHaveLength(5);
    // At most one steady-state access read (a 15s sweep tick landing in the
    // window); without the throttle this would be 5+, one per mutation.
    expect(dbMock.file.findFirst.mock.calls.length).toBeLessThanOrEqual(1);

    editor.close();
    viewer.close();
  });

  it('holds a delete against stale edits but accepts newer ones', async () => {
    // Tombstone convergence over the real socket: A deletes X, B's edit
    // made against the pre-delete state must not resurrect it for a fresh
    // joiner, while a genuinely newer edit still lands.
    stubFileAccess('res-a', ['res-b', 'res-c', 'res-d']);
    const shape = (version: number) => ({
      id: 'res-x',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      version,
      versionNonce: version,
    });

    const first = await openClient(port, 'res-a');
    const second = await openClient(port, 'res-b');
    const firstSync = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSync = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-res', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-res', displayName: 'B' }));
    await firstSync;
    await secondSync;

    const addedOnSecond = waitForMessage(
      second,
      message => message.type === 'scene-delta' && JSON.stringify(message).includes('res-x')
    );
    first.send(JSON.stringify({ type: 'scene-delta', added: [shape(1)] }));
    await addedOnSecond;

    const deletedOnSecond = waitForMessage(
      second,
      message =>
        message.type === 'scene-delta' &&
        Array.isArray(message.deleted) &&
        (message.deleted as string[]).includes('res-x')
    );
    first.send(JSON.stringify({ type: 'scene-delta', deleted: ['res-x'] }));
    await deletedOnSecond;

    // Stale edit against the pre-delete state: dropped, never broadcast.
    second.send(JSON.stringify({ type: 'update_element', element: shape(1) }));
    const third = await openClient(port, 'res-c');
    const thirdSync = waitForMessage(third, message => message.type === 'sync_room_state');
    third.send(JSON.stringify({ type: 'join', roomId: 'room-res', displayName: 'C' }));
    const thirdElements = ((await thirdSync).elements ?? []) as Array<{ id: string }>;
    expect(thirdElements.map(element => element.id)).not.toContain('res-x');

    // Genuinely newer edit: accepted and relayed verbatim (same contract as
    // the live-update test above: update_element relays as update_element).
    const revivedOnFirst = waitForMessage(
      first,
      message =>
        message.type === 'update_element' &&
        (message.element as { id?: string } | undefined)?.id === 'res-x'
    );
    second.send(JSON.stringify({ type: 'update_element', element: shape(5) }));
    await revivedOnFirst;

    const fourth = await openClient(port, 'res-d');
    const fourthSync = waitForMessage(fourth, message => message.type === 'sync_room_state');
    fourth.send(JSON.stringify({ type: 'join', roomId: 'room-res', displayName: 'D' }));
    const fourthElements = ((await fourthSync).elements ?? []) as Array<{
      id: string;
      version: number;
    }>;
    expect(fourthElements.find(element => element.id === 'res-x')?.version).toBe(5);

    first.close();
    second.close();
    third.close();
    fourth.close();
  });

  it('exposes a scene version that advances with mutations', async () => {
    // Backend seam for a future version-heartbeat/resync protocol: the join
    // sync carries the room's monotonic mutation counter, so a client can
    // later tell whether the server moved on without it. Additive field —
    // old clients ignore it, no wire behavior changes.
    stubFileAccess('ver-a', ['ver-b', 'ver-c']);
    const shape = {
      id: 'ver-x',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      version: 1,
      versionNonce: 1,
    };

    const first = await openClient(port, 'ver-a');
    const second = await openClient(port, 'ver-b');
    const firstSyncP = waitForMessage(first, message => message.type === 'sync_room_state');
    const secondSyncP = waitForMessage(second, message => message.type === 'sync_room_state');
    first.send(JSON.stringify({ type: 'join', roomId: 'room-ver', displayName: 'A' }));
    second.send(JSON.stringify({ type: 'join', roomId: 'room-ver', displayName: 'B' }));
    const firstSync = await firstSyncP;
    await secondSyncP;
    expect(typeof firstSync.sceneVersion).toBe('number');

    // A mutation is applied (second sees the delta), then a later joiner
    // observes a strictly newer version and the mutated scene.
    const appliedOnSecond = waitForMessage(
      second,
      message => message.type === 'scene-delta' && JSON.stringify(message).includes('ver-x')
    );
    first.send(JSON.stringify({ type: 'scene-delta', added: [shape] }));
    await appliedOnSecond;

    const third = await openClient(port, 'ver-c');
    const thirdSyncP = waitForMessage(third, message => message.type === 'sync_room_state');
    third.send(JSON.stringify({ type: 'join', roomId: 'room-ver', displayName: 'C' }));
    const thirdSync = await thirdSyncP;
    expect(thirdSync.sceneVersion as number).toBeGreaterThan(firstSync.sceneVersion as number);
    expect(JSON.stringify(thirdSync.elements)).toContain('ver-x');

    first.close();
    second.close();
    third.close();
  });
});
