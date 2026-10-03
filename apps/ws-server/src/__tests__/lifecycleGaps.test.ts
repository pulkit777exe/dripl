/**
 * The sweep branches that only run once a room has already survived a failure —
 * a reconciliation write that still failed, and a room collected while Redis is
 * configured.
 *
 * Both were unreachable from `lifecycle.test.ts`, which mocks `isRedisAvailable`
 * to `false` and only asserts that a write was *attempted*.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const dbMock = vi.hoisted(() => ({
  file: { findFirst: vi.fn(), findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

const broadcastMock = vi.hoisted(() => vi.fn());
vi.mock('../broadcast', () => ({ broadcast: broadcastMock, send: vi.fn() }));

const unsubscribeMock = vi.hoisted(() => vi.fn());
vi.mock('../redis', async importOriginal => {
  const actual = await importOriginal<typeof import('../redis')>();
  return { ...actual, isRedisAvailable: () => true, unsubscribeFromRoom: unsubscribeMock };
});

import { rooms, roomLastEmptyAt, getOrCreateRoom, MAX_EMPTY_ROOM_TTL_MS } from '../rooms';
import { runPeriodicSave, runReconciliation } from '../lifecycle';
import { releaseRoom } from '../roomOwnership';

const el = (id: string) =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
  }) as never;

const T0 = new Date('2026-01-01T00:00:00.000Z');

function watched(roomId: string, dirty = true) {
  const room = getOrCreateRoom(roomId);
  room.recordType = 'file';
  room.lastPersistedUpdatedAt = T0;
  room.dirty = dirty;
  room.users.set('watcher', {
    userId: 'watcher',
    displayName: 'w',
    color: '#000',
    ws: {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket,
    isAlive: true,
  });
  return room;
}

describe('sweep recovery branches', () => {
  beforeEach(() => {
    rooms.clear();
    roomLastEmptyAt.clear();
    vi.clearAllMocks();
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: new Date() }]);
    dbMock.canvasRoom.updateManyAndReturn.mockResolvedValue([{ updatedAt: new Date() }]);
  });

  it('keeps a diverged room for the next tick when its repair write also fails', async () => {
    // Reconciliation found divergence and tried to repair it; the repair failed.
    // The room must stay dirty and stay in memory — dropping it here would lose
    // the divergence permanently, because nothing else holds the knowledge that
    // memory and the row disagree.
    const room = watched('recon-still-failing');
    room.elements.set('mine', el('mine'));
    dbMock.file.findUnique.mockResolvedValue({ content: JSON.stringify({ elements: [] }) });
    // Fence lost, and the winning row is gone too, so the merge cannot run.
    dbMock.file.updateManyAndReturn.mockResolvedValue([]);
    dbMock.file.findUnique.mockResolvedValueOnce({
      content: JSON.stringify({ elements: [] }),
      updatedAt: new Date('2026-01-01T00:00:02.000Z'),
    });

    await runReconciliation();

    expect(rooms.has('recon-still-failing')).toBe(true);
    expect(room.dirty).toBe(true);
    expect(room.saving).toBe(false);
  });

  it('unsubscribes from the fan-out channel of a room it collects', async () => {
    // A collected room must stop receiving fan-out. Left subscribed, a mutation
    // published for that room would find a registered handler against a room
    // this process no longer serves.
    const releaseSpy = vi.spyOn(await import('../roomOwnership'), 'releaseRoom');
    const room = getOrCreateRoom('gc-with-redis');
    room.dirty = false;
    roomLastEmptyAt.set('gc-with-redis', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);

    await runPeriodicSave();

    expect(rooms.has('gc-with-redis')).toBe(false);
    expect(unsubscribeMock).toHaveBeenCalledWith('gc-with-redis');
    expect(releaseSpy).toHaveBeenCalledWith('gc-with-redis');
    releaseSpy.mockRestore();
  });

  it('does not release a lease it never acquired', async () => {
    const releaseSpy = vi.spyOn(await import('../roomOwnership'), 'releaseRoom');
    await runPeriodicSave();
    // Nothing was collected, so nothing may be handed back.
    expect(releaseSpy).not.toHaveBeenCalled();
    releaseSpy.mockRestore();
    // And the exported helper is a no-op rather than a delete, which is what
    // makes it safe to call from the GC for every room.
    await expect(releaseRoom('gc-with-redis')).resolves.toBeUndefined();
  });
});
