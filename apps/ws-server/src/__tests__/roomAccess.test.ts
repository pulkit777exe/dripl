import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', () => ({
  db: {
    file: { findFirst: vi.fn() },
    canvasRoom: { findUnique: vi.fn() },
  },
}));

import { db } from '@dripl/db';
import { authorizeRoomAccess, authorizeShareRoomAccess } from '../roomAccess';

const fileFindFirst = vi.mocked(db.file.findFirst);
const roomFindUnique = vi.mocked(db.canvasRoom.findUnique);

describe('authorizeRoomAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileFindFirst.mockReset();
    roomFindUnique.mockReset();
  });

  it('allows the file owner to edit', async () => {
    fileFindFirst.mockResolvedValue({
      userId: 'owner',
      teamId: null,
      sharedWith: [],
      team: null,
    } as never);

    await expect(authorizeRoomAccess('owner', 'file-1')).resolves.toEqual({
      allowed: true,
      canEdit: true,
      recordType: 'file',
    });
  });

  it('keeps a shared file read-only', async () => {
    fileFindFirst.mockResolvedValue({
      userId: 'owner',
      teamId: null,
      sharedWith: [{ userId: 'viewer' }],
      team: null,
    } as never);

    await expect(authorizeRoomAccess('viewer', 'file-1')).resolves.toEqual({
      allowed: true,
      canEdit: false,
      recordType: 'file',
    });
  });

  it('allows public room viewers but only members to edit', async () => {
    roomFindUnique.mockResolvedValue({
      ownerId: 'owner',
      isPublic: true,
      members: [],
    } as never);

    await expect(authorizeRoomAccess('viewer', 'room-1')).resolves.toEqual({
      allowed: true,
      canEdit: false,
      recordType: 'canvasRoom',
    });
  });

  it('denies an unknown room', async () => {
    fileFindFirst.mockResolvedValue(null);
    roomFindUnique.mockResolvedValue(null);

    await expect(authorizeRoomAccess('viewer', 'missing')).resolves.toEqual({
      allowed: false,
      canEdit: false,
    });
  });

  it('denies a ticket after the share has been revoked', async () => {
    fileFindFirst.mockResolvedValue({
      sharePermission: null,
      shareExpiresAt: null,
    } as never);

    await expect(authorizeShareRoomAccess('file-1', 'file-1', 'view')).resolves.toEqual({
      allowed: false,
      canEdit: false,
    });
  });

  it('rejects a share ticket after the token is rotated', async () => {
    fileFindFirst.mockResolvedValue({
      shareToken: 'new-token',
      sharePermission: 'view',
      shareExpiresAt: null,
    } as never);

    await expect(
      authorizeShareRoomAccess('file-1', 'file-1', 'view', 'old-token')
    ).resolves.toEqual({ allowed: false, canEdit: false });
  });

  it('allows a share ticket only for its file and current permission', async () => {
    fileFindFirst.mockResolvedValue({
      sharePermission: 'edit',
      shareExpiresAt: null,
    } as never);

    await expect(authorizeShareRoomAccess('file-1', 'file-1', 'edit')).resolves.toEqual({
      allowed: true,
      canEdit: true,
      recordType: 'file',
    });
    await expect(authorizeShareRoomAccess('file-1', 'other-file', 'edit')).resolves.toEqual({
      allowed: false,
      canEdit: false,
    });
    await expect(authorizeShareRoomAccess('file-1', 'file-1', 'view')).resolves.toEqual({
      allowed: false,
      canEdit: false,
    });
  });
});
