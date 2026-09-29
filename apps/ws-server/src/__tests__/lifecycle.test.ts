import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const dbMock = vi.hoisted(() => ({
  file: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
  canvasRoom: {
    findUnique: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

const broadcastMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('../broadcast', () => ({
  broadcast: broadcastMock,
  send: sendMock,
}));

const unsubscribeMock = vi.hoisted(() => vi.fn());
vi.mock('../redis', async importOriginal => {
  const actual = await importOriginal<typeof import('../redis')>();
  return { ...actual, isRedisAvailable: () => false, unsubscribeFromRoom: unsubscribeMock };
});

import { rooms, roomLastEmptyAt, userToRoomMap, wsToRoomMap, getOrCreateRoom } from '../rooms';
import {
  runHeartbeatTick,
  runAuthorizationSweep,
  runPeriodicSave,
  runLockSweep,
  runReconciliation,
} from '../lifecycle';
import type { RoomState, UserConnection } from '../types';

function makeWs(overrides: object = {}): WebSocket {
  return {
    readyState: 1,
    ping: vi.fn(),
    terminate: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    ...overrides,
  } as unknown as WebSocket;
}

function makeUser(userId: string, ws: WebSocket): UserConnection {
  return {
    userId,
    displayName: userId,
    color: '#000000',
    ws,
    isAlive: true,
  };
}

const el = (id: string) => ({
  id,
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 1,
  versionNonce: 1,
});

describe('lifecycle sweeps', () => {
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

  describe('runLockSweep', () => {
    it('expires stale locks with an unlock broadcast and keeps fresh ones', () => {
      const room = getOrCreateRoom('locks');
      room.elementLocks.set('stale', { userId: 'u1', lastHeartbeat: Date.now() - 60_000 });
      room.elementLocks.set('fresh', { userId: 'u1', lastHeartbeat: Date.now() });
      runLockSweep();
      expect(room.elementLocks.has('stale')).toBe(false);
      expect(room.elementLocks.has('fresh')).toBe(true);
      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(
        room,
        expect.objectContaining({ type: 'element-unlock', elementId: 'stale' })
      );
    });

    it('does nothing when no locks exist', () => {
      getOrCreateRoom('empty-locks');
      runLockSweep();
      expect(broadcastMock).not.toHaveBeenCalled();
    });
  });

  describe('runHeartbeatTick', () => {
    it('reaps a dead socket: broadcasts leave, cleans maps, terminates', () => {
      const ws = makeWs();
      const room = getOrCreateRoom('hb');
      room.users.set('u1', { ...makeUser('u1', ws), isAlive: false });
      (ws as unknown as { __user?: UserConnection }).__user = room.users.get('u1');
      wsToRoomMap.set(ws, 'hb');
      userToRoomMap.set('u1', 'hb');
      runHeartbeatTick([ws]);
      expect(broadcastMock).toHaveBeenCalledWith(
        room,
        expect.objectContaining({ type: 'user-leave', userId: 'u1' })
      );
      expect(room.users.has('u1')).toBe(false);
      expect(wsToRoomMap.has(ws)).toBe(false);
      expect(userToRoomMap.has('u1')).toBe(false);
      expect(ws.terminate).toHaveBeenCalled();
      expect(roomLastEmptyAt.get('hb')).toBeDefined();
    });

    it('marks a live socket unalive and pings instead of reaping', () => {
      const ws = makeWs();
      const room = getOrCreateRoom('hb-live');
      room.users.set('u1', makeUser('u1', ws));
      (ws as unknown as { __user?: UserConnection }).__user = room.users.get('u1');
      runHeartbeatTick([ws]);
      expect(room.users.has('u1')).toBe(true);
      expect(ws.terminate).not.toHaveBeenCalled();
      expect(ws.ping).toHaveBeenCalled();
      expect(room.users.get('u1')?.isAlive).toBe(false);
    });

    it('ignores sockets with no user attached', () => {
      const ws = makeWs();
      runHeartbeatTick([ws]);
      expect(broadcastMock).not.toHaveBeenCalled();
      expect(ws.terminate).not.toHaveBeenCalled();
    });
  });

  describe('runAuthorizationSweep', () => {
    it('closes connections whose access was revoked', async () => {
      const ws = makeWs();
      const room = getOrCreateRoom('authz');
      room.users.set('u1', {
        ...makeUser('u1', ws),
        revalidate: async () => false,
      });
      runAuthorizationSweep();
      await vi.waitFor(() => {
        expect(ws.close).toHaveBeenCalledWith(4003, 'Room access revoked');
      });
    });

    it('leaves valid and revalidate-less users alone', async () => {
      const wsOk = makeWs();
      const wsPlain = makeWs();
      const room = getOrCreateRoom('authz-ok');
      room.users.set('ok', { ...makeUser('ok', wsOk), revalidate: async () => true });
      room.users.set('plain', makeUser('plain', wsPlain));
      runAuthorizationSweep();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(wsOk.close).not.toHaveBeenCalled();
      expect(wsPlain.close).not.toHaveBeenCalled();
    });
  });

  describe('runPeriodicSave', () => {
    it('saves dirty rooms with users and clears the flag on version match', async () => {
      const room = getOrCreateRoom('save-me');
      room.users.set('u1', makeUser('u1', makeWs()));
      room.elements.set('a', el('a') as never);
      room.dirty = true;
      // Saves are fenced: a room needs its loaded identity (record type +
      // fence timestamp) or the write probes for it. A hand-built room with
      // neither refuses rather than writing unfenced.
      room.recordType = 'file';
      room.lastPersistedUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
      await runPeriodicSave();
      expect(dbMock.file.updateManyAndReturn).toHaveBeenCalled();
      expect(room.dirty).toBe(false);
      expect(room.saving).toBe(false);
    });

    it('skips clean rooms', async () => {
      const room = getOrCreateRoom('clean');
      room.users.set('u1', makeUser('u1', makeWs()));
      room.dirty = false;
      await runPeriodicSave();
      expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
      expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('stamps empty rooms on first pass and GCs them after the TTL', async () => {
      const room = getOrCreateRoom('gone');
      room.dirty = false;
      await runPeriodicSave();
      expect(rooms.has('gone')).toBe(true);
      expect(roomLastEmptyAt.get('gone')).toBeDefined();
      roomLastEmptyAt.set('gone', Date.now() - 10 * 60 * 1000);
      await runPeriodicSave();
      expect(rooms.has('gone')).toBe(false);
      expect(roomLastEmptyAt.has('gone')).toBe(false);
    });

    it('does not GC a room that became dirty again', async () => {
      const room = getOrCreateRoom('busy');
      roomLastEmptyAt.set('busy', Date.now() - 10 * 60 * 1000);
      room.elements.set('a', el('a') as never);
      room.dirty = true;
      room.saving = true;
      await runPeriodicSave();
      expect(rooms.has('busy')).toBe(true);
    });
  });

  describe('runReconciliation', () => {
    it('saves when memory and storage diverge', async () => {
      const room = getOrCreateRoom('diverged') as RoomState;
      room.users.set('u1', makeUser('u1', makeWs()));
      room.recordType = 'file';
      room.elements.set('mem-only', el('mem-only') as never);
      room.dirty = false;
      dbMock.file.findUnique.mockResolvedValue({
        content: JSON.stringify({ elements: [] }),
      });
      await runReconciliation();
      expect(dbMock.file.updateManyAndReturn).toHaveBeenCalled();
    });

    it('does nothing when memory matches storage', async () => {
      const room = getOrCreateRoom('in-sync') as RoomState;
      room.users.set('u1', makeUser('u1', makeWs()));
      room.recordType = 'file';
      room.elements.set('a', el('a') as never);
      dbMock.file.findUnique.mockResolvedValue({
        content: JSON.stringify({ elements: [el('a')] }),
      });
      await runReconciliation();
      expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('skips rooms nobody is watching', async () => {
      getOrCreateRoom('unwatched');
      await runReconciliation();
      expect(dbMock.file.findUnique).not.toHaveBeenCalled();
      expect(dbMock.canvasRoom.findUnique).not.toHaveBeenCalled();
    });
  });
});
