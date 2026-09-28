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
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({
        elements: [],
        encryptedPayload: { iv: 'iv', data: 'ciphertext' },
        encryptedAt: '2026-01-01T00:00:00.000Z',
        appState: { zoom: 1 },
      }),
    });
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: nextUpdatedAt }]);

    const room = getOrCreateRoom('file-1');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = previousUpdatedAt;
    room.elements.set(element.id, element);

    await expect(saveRoomElements('file-1', room.elements)).resolves.toBe(true);
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

  it('aborts a save when stored metadata cannot be read', async () => {
    dbMock.file.findUnique.mockRejectedValue(new Error('temporary read failure'));
    const room = getOrCreateRoom('file-1');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    room.elements.set(element.id, element);

    await expect(saveRoomElements('file-1', room.elements)).resolves.toBe(false);
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
});
