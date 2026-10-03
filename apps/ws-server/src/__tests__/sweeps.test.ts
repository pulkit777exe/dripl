/**
 * The sweep bodies' failure and boundary paths.
 *
 * `lifecycle.test.ts` covers the happy path of each tick. What it does not cover
 * is what happens when the tick itself meets trouble, and that is where the
 * damage is: a sweep runs from an `unref()`ed interval, so a throw or a rejected
 * promise there is an unhandled rejection — process death, and with it every
 * in-memory `RoomState` in the process.
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
  return { ...actual, isRedisAvailable: () => false, unsubscribeFromRoom: unsubscribeMock };
});

import {
  rooms,
  roomLastEmptyAt,
  userToRoomMap,
  wsToRoomMap,
  getOrCreateRoom,
  MAX_EMPTY_ROOM_TTL_MS,
} from '../rooms';
import { runAuthorizationSweep, runPeriodicSave, runReconciliation } from '../lifecycle';
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

function makeWs(): WebSocket {
  return {
    readyState: 1,
    ping: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-01-01T00:00:01.000Z');
const T2 = new Date('2026-01-01T00:00:02.000Z');

/**
 * A room mid-session: identified row, pending writes, and at least one watcher.
 * Reconciliation only inspects rooms people are in, so an unwatched room is
 * skipped before any database read.
 */
function fencedRoom(roomId: string, dirty = true, watched = true) {
  const room = getOrCreateRoom(roomId);
  room.recordType = 'file';
  room.lastPersistedUpdatedAt = T0;
  room.dirty = dirty;
  if (watched) {
    room.users.set('watcher', {
      userId: 'watcher',
      displayName: 'w',
      color: '#000',
      ws: makeWs(),
      isAlive: true,
    });
  }
  return room;
}

describe('sweep failure paths', () => {
  beforeEach(() => {
    rooms.clear();
    roomLastEmptyAt.clear();
    userToRoomMap.clear();
    wsToRoomMap.clear();
    vi.clearAllMocks();
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: new Date() }]);
    dbMock.canvasRoom.updateManyAndReturn.mockResolvedValue([{ updatedAt: new Date() }]);
  });

  describe('runAuthorizationSweep', () => {
    it('keeps sweeping after one connection revalidation rejects', async () => {
      // Revocation enforcement: each revalidation is caught independently, so
      // one failure cannot mask a real revocation on another socket.
      const broken = makeWs();
      const revoked = makeWs();
      const stillValid = makeWs();
      const room = getOrCreateRoom('sweep-authz');
      room.users.set('broken', {
        userId: 'broken',
        displayName: 'b',
        color: '#000',
        ws: broken,
        isAlive: true,
        revalidate: async () => {
          throw new Error('database unreachable');
        },
      });
      room.users.set('revoked', {
        userId: 'revoked',
        displayName: 'r',
        color: '#000',
        ws: revoked,
        isAlive: true,
        revalidate: async () => false,
      });
      room.users.set('valid', {
        userId: 'valid',
        displayName: 'v',
        color: '#000',
        ws: stillValid,
        isAlive: true,
        revalidate: async () => true,
      });

      runAuthorizationSweep();

      await vi.waitFor(() => {
        expect(revoked.close).toHaveBeenCalledWith(4003, 'Room access revoked');
      });
      expect(stillValid.close).not.toHaveBeenCalled();

      // A revalidation that *threw* is treated as not-allowed, so its socket is
      // closed too. That is the opposite of `roomOwnership.ts`, where a failed
      // round-trip is explicitly not treated as proof of loss and the healthy
      // room is kept. Two modules, two policies for the same class of transient
      // failure; pinned here so the divergence is visible rather than
      // incidental. See the task report — this is the one place in ws-server
      // where a momentary Postgres blip drops live collaborators.
      expect(broken.close).toHaveBeenCalledWith(4003, 'Room access revoked');
    });

    it('does not close a socket that is already closing', async () => {
      // `ws.close` on a closing socket is a no-op, but on some states it
      // throws; the guard exists so a revocation arriving during a handover
      // cannot turn into an exception on the sweep.
      const closing = {
        readyState: 2,
        close: vi.fn(),
        terminate: vi.fn(),
        ping: vi.fn(),
      } as unknown as WebSocket;
      const room = getOrCreateRoom('sweep-authz-closing');
      room.users.set('u', {
        userId: 'u',
        displayName: 'u',
        color: '#000',
        ws: closing,
        isAlive: true,
        revalidate: async () => false,
      });
      runAuthorizationSweep();
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(closing.close).not.toHaveBeenCalled();
    });
  });

  describe('runPeriodicSave', () => {
    it('persists an expired idle room before collecting it', async () => {
      // The last chance to write. GC'ing first would drop the room with its
      // pending edits still only in memory, and the debounce handle is gone.
      const room = fencedRoom('expired-dirty', true, false);
      room.elements.set('x', el('x'));
      roomLastEmptyAt.set('expired-dirty', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);

      await runPeriodicSave();

      expect(dbMock.file.updateManyAndReturn).toHaveBeenCalled();
      expect(room.dirty).toBe(false);
      expect(rooms.has('expired-dirty')).toBe(false);
    });

    it('keeps an expired room whose final save failed, for a later retry', async () => {
      // The room stays in memory and stays dirty. Losing it here is losing the
      // edits: nothing else holds them.
      dbMock.file.updateManyAndReturn.mockResolvedValue([]);
      dbMock.file.findUnique.mockResolvedValue(null);
      dbMock.canvasRoom.findUnique.mockResolvedValue(null);
      const room = fencedRoom('expired-failed', true, false);
      room.elements.set('x', el('x'));
      roomLastEmptyAt.set('expired-failed', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);

      await runPeriodicSave();

      expect(rooms.has('expired-failed')).toBe(true);
      expect(room.dirty).toBe(true);
    });

    it('leaves an expired room alone while a write is in flight', async () => {
      // Collecting the room out from under `saving` would let the next join for
      // that id build a second `RoomState` for a room the first write is still
      // persisting — two copies, one row.
      const room = fencedRoom('expired-busy', true, false);
      room.saving = true;
      roomLastEmptyAt.set('expired-busy', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);

      await runPeriodicSave();

      expect(rooms.has('expired-busy')).toBe(true);
    });

    it('leaves an expired room that someone rejoined mid-tick', async () => {
      const room = fencedRoom('expired-rejoined', true, false);
      roomLastEmptyAt.set('expired-rejoined', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);
      room.users.set('back', {
        userId: 'back',
        displayName: 'b',
        color: '#000',
        ws: makeWs(),
        isAlive: true,
      });

      await runPeriodicSave();

      expect(rooms.has('expired-rejoined')).toBe(true);
      expect(roomLastEmptyAt.has('expired-rejoined')).toBe(false);
    });

    it('does not release a lease for a room it did not collect', async () => {
      // Handing the lease back for a room that is still in memory lets a peer
      // acquire it, reload from Postgres, and serve — while this process still
      // holds a copy and can still answer a join from it.
      const releaseSpy = vi.spyOn(await import('../roomOwnership'), 'releaseRoom');
      const room = fencedRoom('gc-release', false, false);
      room.saving = true;
      roomLastEmptyAt.set('gc-release', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);

      await runPeriodicSave();

      expect(rooms.has('gc-release')).toBe(true);
      expect(room.saving).toBe(true);
      expect(releaseSpy).not.toHaveBeenCalled();
      releaseSpy.mockRestore();
    });

    it('hands the lease back when it does collect the room', async () => {
      // The room is clean and persisted, so pinning it to this process for the
      // rest of the lease TTL only delays the next process from serving it.
      const releaseSpy = vi.spyOn(await import('../roomOwnership'), 'releaseRoom');
      const room = fencedRoom('gc-released', false, false);
      roomLastEmptyAt.set('gc-released', Date.now() - MAX_EMPTY_ROOM_TTL_MS - 1_000);

      await runPeriodicSave();

      expect(rooms.has('gc-released')).toBe(false);
      // Everything the room held went with it, so nothing is left to be served
      // from memory under a lease that is no longer ours.
      expect(room.users.size).toBe(0);
      expect(room.dirty).toBe(false);
      expect(roomLastEmptyAt.has('gc-released')).toBe(false);
      expect(releaseSpy).toHaveBeenCalledWith('gc-released');
      releaseSpy.mockRestore();
    });
  });

  describe('runReconciliation', () => {
    it('verifies a canvas room through its own table', async () => {
      // `recordType` decides which row is read. Reading a canvas room from
      // `file` compares against a row that does not exist, reports divergence
      // on every tick, and writes to the wrong place.
      const room = fencedRoom('recon-canvas');
      room.recordType = 'canvasRoom';
      room.elements.set('mine', el('mine'));
      dbMock.canvasRoom.findUnique.mockResolvedValue({ content: JSON.stringify({ elements: [] }) });

      await runReconciliation();

      expect(dbMock.canvasRoom.findUnique).toHaveBeenCalled();
      expect(dbMock.file.findUnique).not.toHaveBeenCalled();
      expect(dbMock.canvasRoom.updateManyAndReturn).toHaveBeenCalled();
    });

    it('adopts a database element memory has never seen instead of deleting it', async () => {
      // The subtle one. Reconciliation's repair is a plain `persistRoom` of
      // memory, which would delete the peer's element outright. What saves it is
      // the fence: the row cannot contain something memory does not while still
      // carrying the `updatedAt` this room loaded, so the write matches zero
      // rows and falls into the merge, which adopts the peer's element. Pinned
      // because the safety of this call depends entirely on a fence three files
      // away — remove the fence and this becomes silent deletion of the other
      // writer's work, with the room marked clean afterwards so nothing retries.
      const room = fencedRoom('recon-only-db');
      room.elements.set('mine', el('mine'));
      dbMock.file.findUnique.mockResolvedValue({
        content: JSON.stringify({ elements: [el('mine'), el('theirs')] }),
        updatedAt: T1,
      });
      dbMock.file.updateManyAndReturn
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ updatedAt: T2 }]);

      await runReconciliation();

      // Fence lost, so the merge re-read and re-wrote.
      expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(2);
      expect(room.elements.has('theirs')).toBe(true);
      expect(room.elements.has('mine')).toBe(true);
      // Adoption changes the visible scene, so the room is dirty again and the
      // merged scene is what a later save persists.
      expect(room.dirty).toBe(true);
    });

    it('repairs a memory-only divergence with one write and no read', async () => {
      // Our own write failed and the row is behind: the fence still matches, so
      // this is a straight rewrite. Paying a read here would double the cost of
      // the once-a-minute recovery path.
      const room = fencedRoom('recon-only-mem');
      room.elements.set('mine', el('mine'));
      dbMock.file.findUnique.mockResolvedValue({
        content: JSON.stringify({ elements: [] }),
      });

      await runReconciliation();

      expect(dbMock.file.findUnique).toHaveBeenCalledTimes(1);
      expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(1);
      expect(room.dirty).toBe(false);
    });

    it('does nothing when the row no longer exists', async () => {
      // A deleted file is not divergence to be repaired by writing. Persisting
      // here would recreate the row the owner just removed.
      const room = fencedRoom('recon-gone');
      room.elements.set('mine', el('mine'));
      dbMock.file.findUnique.mockResolvedValue(null);

      await runReconciliation();

      expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('keeps the room when the verification query itself fails', async () => {
      // The tick runs from an interval, so a throw here is an unhandled
      // rejection and process death. One failed read must cost nothing but a
      // retry on the next minute.
      dbMock.file.findUnique.mockRejectedValue(new Error('connection reset'));
      const room = fencedRoom('recon-throw');
      room.elements.set('mine', el('mine'));

      await expect(runReconciliation()).resolves.toBeUndefined();

      expect(rooms.has('recon-throw')).toBe(true);
      expect(room.dirty).toBe(true);
    });

    it('skips a room that is still being written', async () => {
      const room = fencedRoom('recon-writing');
      room.saving = true;
      await runReconciliation();
      expect(dbMock.file.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('releaseRoom', () => {
    it('is a no-op for a room this process never held', async () => {
      await expect(releaseRoom('never-owned')).resolves.toBeUndefined();
    });
  });
});
