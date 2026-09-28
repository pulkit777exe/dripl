import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomService } from '../../services/roomService.js';
import { db } from '@dripl/db';

vi.mock('@dripl/db', () => ({
  db: {
    canvasRoom: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateManyAndReturn: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    canvasRoomMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    shareLink: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    file: {
      deleteMany: vi.fn(),
    },
  },
}));

describe('RoomService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRoom', () => {
    it('enforces the 10-rooms-per-day quota without creating', async () => {
      vi.mocked(db.canvasRoom.count).mockResolvedValue(10);
      const result = await RoomService.createRoom({ userId: 'u', name: 'n' });
      expect(result).toEqual({ kind: 'rate_limited' });
      expect(db.canvasRoom.create).not.toHaveBeenCalled();
    });

    it('retries slug collisions before creating', async () => {
      vi.mocked(db.canvasRoom.count).mockResolvedValue(0);
      vi.mocked(db.canvasRoom.findUnique)
        .mockResolvedValueOnce({ id: 'taken' } as never)
        .mockResolvedValueOnce({ id: 'taken' } as never)
        .mockResolvedValueOnce(null);
      vi.mocked(db.canvasRoom.create).mockImplementation((async (args: unknown) => ({
        id: 'new',
        ...(args as { data: object }).data,
      })) as never);
      const result = await RoomService.createRoom({ userId: 'u', name: 'n' });
      expect(result.kind).toBe('ok');
      expect(db.canvasRoom.findUnique).toHaveBeenCalledTimes(3);
      expect(db.canvasRoom.create).toHaveBeenCalledOnce();
    });
  });

  describe('getRoom', () => {
    it('returns not_found for a missing room', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue(null);
      expect(await RoomService.getRoom({ userId: 'u', slug: 's' })).toEqual({
        kind: 'not_found',
      });
    });

    it('forbids private rooms to strangers', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({
        ownerId: 'owner',
        isPublic: false,
        members: [],
      } as never);
      expect(await RoomService.getRoom({ userId: 'stranger', slug: 's' })).toEqual({
        kind: 'forbidden',
      });
    });

    it('admits members to private rooms', async () => {
      const room = { ownerId: 'owner', isPublic: false, members: [{ userId: 'u' }] };
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue(room as never);
      const result = await RoomService.getRoom({ userId: 'u', slug: 's' });
      expect(result.kind).toBe('ok');
    });
  });

  describe('updateRoom', () => {
    it('returns not_found without writing', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue(null);
      const result = await RoomService.updateRoom({ userId: 'u', slug: 's', name: 'n' });
      expect(result).toEqual({ kind: 'not_found' });
      expect(db.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('forbids non-owners', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({
        ownerId: 'owner',
        updatedAt: new Date(),
      } as never);
      const result = await RoomService.updateRoom({ userId: 'u', slug: 's', name: 'n' });
      expect(result).toEqual({ kind: 'forbidden' });
    });

    it('reports conflict when the fence loses', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({
        ownerId: 'u',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      } as never);
      vi.mocked(db.canvasRoom.updateManyAndReturn).mockResolvedValue([]);
      const result = await RoomService.updateRoom({ userId: 'u', slug: 's', name: 'n' });
      expect(result).toEqual({ kind: 'conflict' });
    });
  });

  describe('deleteRoom', () => {
    it('returns not_found without deleting', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue(null);
      const result = await RoomService.deleteRoom({ userId: 'u', slug: 's' });
      expect(result).toEqual({ kind: 'not_found' });
      expect(db.canvasRoom.delete).not.toHaveBeenCalled();
    });

    it('deletes members then the room', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({ id: 'r' } as never);
      const result = await RoomService.deleteRoom({ userId: 'u', slug: 's' });
      expect(result).toEqual({ kind: 'ok' });
      expect(db.canvasRoomMember.deleteMany).toHaveBeenCalledWith({ where: { roomId: 'r' } });
      expect(db.canvasRoom.delete).toHaveBeenCalledWith({ where: { slug: 's' } });
    });
  });

  describe('addMember', () => {
    it('reports conflict for existing members', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({ id: 'r' } as never);
      vi.mocked(db.canvasRoomMember.findUnique).mockResolvedValue({ id: 'm' } as never);
      const result = await RoomService.addMember({
        userId: 'u',
        slug: 's',
        memberUserId: 'v',
        role: 'EDITOR',
      });
      expect(result).toEqual({ kind: 'conflict' });
      expect(db.canvasRoomMember.create).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('refuses to remove the owner', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({ id: 'r', ownerId: 'u' } as never);
      const result = await RoomService.removeMember({ userId: 'u', slug: 's', memberUserId: 'u' });
      expect(result).toEqual({ kind: 'owner_self' });
      expect(db.canvasRoomMember.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('shareRoom', () => {
    it('forbids non-owners', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({ id: 'r', ownerId: 'o' } as never);
      const result = await RoomService.shareRoom({
        userId: 'u',
        slug: 's',
        permission: 'view',
        expiresInHours: 24,
      });
      expect(result).toEqual({ kind: 'forbidden' });
      expect(db.shareLink.create).not.toHaveBeenCalled();
    });

    it('issues an uppercase permission token', async () => {
      vi.mocked(db.canvasRoom.findUnique).mockResolvedValue({ id: 'r', ownerId: 'u' } as never);
      vi.mocked(db.shareLink.create).mockImplementation((async (args: unknown) => ({
        ...(args as { data: object }).data,
      })) as never);
      const result = await RoomService.shareRoom({
        userId: 'u',
        slug: 's',
        permission: 'edit',
        expiresInHours: 24,
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.permission).toBe('EDIT');
        expect(typeof result.token).toBe('string');
      }
    });
  });

  describe('getShareLink', () => {
    it('reports expired links', async () => {
      vi.mocked(db.shareLink.findUnique).mockResolvedValue({
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      } as never);
      expect(await RoomService.getShareLink('t')).toEqual({ kind: 'expired' });
    });
  });
});
