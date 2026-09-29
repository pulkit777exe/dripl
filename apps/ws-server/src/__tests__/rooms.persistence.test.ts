import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: {
    findUnique: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
  canvasRoom: {
    findUnique: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import {
  getOrCreateRoom,
  rooms,
  saveRoomElements,
  persistRoom,
  awaitSettledPersist,
} from '../rooms';
import { deleteWithTombstone } from '../tombstones';

const element = {
  id: 'persisted-element',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
};

describe('room persistence fencing', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  it('preserves encrypted metadata and uses the loaded database timestamp', async () => {
    const previousUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    const nextUpdatedAt = new Date('2026-01-02T00:00:00.000Z');
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: nextUpdatedAt }]);

    const room = getOrCreateRoom('file-1');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = previousUpdatedAt;
    // Load-time envelope cache: loadRoomElements captures this from the stored
    // content, so the debounced save reuses it from memory.
    room.storedMetadata = {
      encryptedPayload: { iv: 'iv', data: 'ciphertext' },
      encryptedAt: '2026-01-01T00:00:00.000Z',
      appState: { zoom: 1 },
    };
    room.elements.set(element.id, element);

    await expect(saveRoomElements('file-1', room.elements)).resolves.toBe(true);
    // No read-before-write: one UPDATE per debounced save, not SELECT+UPDATE.
    expect(dbMock.file.findUnique).not.toHaveBeenCalled();
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'file-1', updatedAt: previousUpdatedAt },
      data: {
        content: expect.stringContaining('ciphertext'),
      },
      select: { updatedAt: true },
    });
    expect(room.lastPersistedUpdatedAt).toEqual(nextUpdatedAt);
  });

  it('persists a dirty scene after the final element is deleted', async () => {
    const previousUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    dbMock.file.findUnique.mockResolvedValue({ content: JSON.stringify({ elements: [element] }) });
    dbMock.file.updateManyAndReturn.mockResolvedValue([
      { updatedAt: new Date('2026-01-02T00:00:00.000Z') },
    ]);

    const room = getOrCreateRoom('file-1');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = previousUpdatedAt;

    await expect(saveRoomElements('file-1', room.elements)).resolves.toBe(true);
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { content: expect.stringContaining('"elements":[]') },
      })
    );
  });

  it('aborts a save when there is no room state', async () => {
    // Without in-memory state there is no load-time envelope to preserve, so
    // writing would risk erasing an encrypted share envelope. Production
    // rooms always load before mutating; an unknown id must not write.
    await expect(saveRoomElements('no-such-room', new Map())).resolves.toBe(false);
    expect(dbMock.file.findUnique).not.toHaveBeenCalled();
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a newer database scene', async () => {
    dbMock.file.findUnique.mockResolvedValue({ content: '[]' });
    dbMock.file.updateManyAndReturn.mockResolvedValue([]);

    const room = getOrCreateRoom('file-1');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    room.elements.set(element.id, element);

    await expect(saveRoomElements('file-1', room.elements)).resolves.toBe(false);
    expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('merges with the winning row on fence conflict instead of failing forever', async () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:01.000Z');
    const t2 = new Date('2026-01-01T00:00:02.000Z');
    const v = (id: string, version: number) => ({ ...element, id, version, versionNonce: version });

    // First write loses the fence; the merge re-read sees stored a@v1 plus
    // a stored-only b@v1; the retry against the fresh fence succeeds.
    dbMock.file.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ updatedAt: t2 }]);
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({ elements: [v('a', 1), v('b', 1)] }),
      updatedAt: t1,
    });

    const room = getOrCreateRoom('file-merge');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = t0;
    room.elements.set('a', v('a', 2) as never);
    const versionBefore = room.mutationVersion;

    await expect(saveRoomElements('file-merge', room.elements)).resolves.toBe(true);
    expect(room.lastPersistedUpdatedAt).toEqual(t2);
    // Memory's newer a@v2 won; stored-only b@v1 was adopted into memory.
    expect(room.elements.get('a')).toMatchObject({ version: 2 });
    expect(room.elements.get('b')).toMatchObject({ version: 1 });
    // Adoption changes the visible scene, so the room version advances like
    // any other mutation (the seam a future version-heartbeat builds on).
    expect(room.mutationVersion).toBe(versionBefore + 1);
    // The retry fenced on the re-read timestamp, not the stale one.
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(2);
    expect(dbMock.file.updateManyAndReturn.mock.calls[1]?.[0]).toEqual({
      where: { id: 'file-merge', updatedAt: t1 },
      data: { content: expect.stringContaining('"b"') },
      select: { updatedAt: true },
    });
  });

  it('keeps a merged delete deleted when the stored copy is older', async () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:01.000Z');
    const t2 = new Date('2026-01-01T00:00:02.000Z');
    const v = (id: string, version: number) => ({ ...element, id, version, versionNonce: version });

    dbMock.file.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ updatedAt: t2 }]);
    // Someone else concurrently saved a@v2 — but we deleted a@v2 locally,
    // so our tombstone is v3 and the stored copy must not come back.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({ elements: [v('a', 2)] }),
      updatedAt: t1,
    });

    const room = getOrCreateRoom('file-merge-delete');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = t0;
    room.elements.set('a', v('a', 2) as never);
    deleteWithTombstone(room, 'a');

    await expect(saveRoomElements('file-merge-delete', room.elements)).resolves.toBe(true);
    expect(room.elements.has('a')).toBe(false);
    expect(dbMock.file.updateManyAndReturn.mock.calls[1]?.[0].data.content).not.toContain('"a"');
  });
});

describe('persistRoom', () => {
  beforeEach(() => {
    rooms.clear();
    vi.resetAllMocks();
  });

  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const t1 = new Date('2026-01-01T00:00:01.000Z');

  function dirtyFileRoom(id: string) {
    const room = getOrCreateRoom(id);
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = t0;
    room.elements.set('x', { ...element, id: 'x' });
    room.dirty = true;
    return room;
  }

  it('saves and clears dirty when nothing changed mid-write', async () => {
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: t1 }]);
    const room = dirtyFileRoom('p-saved');

    await expect(persistRoom('p-saved')).resolves.toBe('saved');
    expect(room.dirty).toBe(false);
    expect(room.lastPersistedUpdatedAt).toEqual(t1);
  });

  it('keeps dirty when a mutation lands mid-write', async () => {
    dbMock.file.updateManyAndReturn.mockImplementation(async () => {
      // A concurrent mutation bumps the version while the write is in flight.
      const room = getOrCreateRoom('p-mid');
      room.elements.set('y', { ...element, id: 'y' });
      room.dirty = true;
      room.mutationVersion += 1;
      return [{ updatedAt: t1 }];
    });
    const room = dirtyFileRoom('p-mid');
    const versionAtStart = room.mutationVersion;

    await expect(persistRoom('p-mid')).resolves.toBe('saved');
    expect(room.mutationVersion).toBeGreaterThan(versionAtStart);
    expect(room.dirty).toBe(true);
  });

  it('returns clean without touching the database', async () => {
    const room = getOrCreateRoom('p-clean');
    room.recordType = 'file';

    await expect(persistRoom('p-clean')).resolves.toBe('clean');
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
    expect(room.saving).toBe(false);
  });

  it('returns busy instead of overlapping an in-flight write', async () => {
    const room = dirtyFileRoom('p-busy');
    room.saving = true;

    await expect(persistRoom('p-busy')).resolves.toBe('busy');
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(room.saving).toBe(true);
    expect(room.dirty).toBe(true);
  });

  it('returns gone for unknown rooms', async () => {
    await expect(persistRoom('no-such-room')).resolves.toBe('gone');
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns failed and keeps dirty when the write loses', async () => {
    // Fence lost and the winning row is gone too: nothing persisted.
    dbMock.file.updateManyAndReturn.mockResolvedValue([]);
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    const room = dirtyFileRoom('p-failed');

    await expect(persistRoom('p-failed')).resolves.toBe('failed');
    expect(room.dirty).toBe(true);
    expect(room.saving).toBe(false);
  });
});

describe('awaitSettledPersist', () => {
  beforeEach(() => {
    rooms.clear();
    vi.resetAllMocks();
  });

  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const t1 = new Date('2026-01-01T00:00:01.000Z');

  it('waits out an in-flight write, then saves', async () => {
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: t1 }]);
    const room = getOrCreateRoom('w-settle');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = t0;
    room.elements.set('x', { ...element, id: 'x' });
    room.dirty = true;
    room.saving = true; // a periodic write owns the room right now
    setTimeout(() => {
      room.saving = false;
    }, 5);

    await expect(awaitSettledPersist('w-settle', 2, 500)).resolves.toBe('saved');
    expect(room.dirty).toBe(false);
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting after the timeout cap instead of stalling', async () => {
    const room = getOrCreateRoom('w-stuck');
    room.recordType = 'file';
    room.dirty = true;
    room.saving = true; // hung database: never clears

    await expect(awaitSettledPersist('w-stuck', 2, 15)).resolves.toBe('busy');
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(room.saving).toBe(true);
  });
});

describe('unknown record type fallback', () => {
  beforeEach(() => {
    rooms.clear();
    vi.resetAllMocks();
  });

  const t1 = new Date('2026-01-01T00:00:01.000Z');
  const t2 = new Date('2026-01-01T00:00:02.000Z');

  it('probes and takes the fenced path when a row appeared concurrently', async () => {
    // No load ever completed, but a row exists now (re-created over HTTP
    // under the same id). The old code wrote it unfenced; the probe adopts
    // the row identity and re-enters the fenced write.
    dbMock.file.findUnique.mockResolvedValue({ content: '[]', updatedAt: t1 });
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: t2 }]);
    const room = getOrCreateRoom('file-probed');
    expect(room.recordType).toBeUndefined();
    room.elements.set('x', { ...element, id: 'x' });
    room.dirty = true;

    await expect(saveRoomElements('file-probed', room.elements)).resolves.toBe(true);
    expect(room.recordType).toBe('file');
    expect(room.lastPersistedUpdatedAt).toEqual(t2);
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'file-probed', updatedAt: t1 },
      data: { content: expect.any(String) },
      select: { updatedAt: true },
    });
  });

  it('stays dirty with no write when no row exists', async () => {
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    const room = getOrCreateRoom('file-gone');
    room.elements.set('x', { ...element, id: 'x' });
    room.dirty = true;

    await expect(saveRoomElements('file-gone', room.elements)).resolves.toBe(false);
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
    expect(room.dirty).toBe(true);
  });
});
