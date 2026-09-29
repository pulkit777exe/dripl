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

import { getOrCreateRoom, rooms, saveRoomElements } from '../rooms';
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
