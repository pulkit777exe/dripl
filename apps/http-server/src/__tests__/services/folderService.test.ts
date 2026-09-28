import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FolderService } from '../../services/folderService';
import { db } from '@dripl/db';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      deleteMany: vi.fn(),
    },
    folder: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const folder = (id: string, parentId: string | null = null) => ({ id, parentId });

describe('FolderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertParentFolder', () => {
    it('returns true when no parent is required', async () => {
      expect(await FolderService.assertParentFolder('u', null)).toBe(true);
      expect(await FolderService.assertParentFolder('u', undefined)).toBe(true);
      expect(db.folder.findFirst).not.toHaveBeenCalled();
    });

    it('returns true when the parent belongs to the user', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue({ id: 'p' } as never);
      expect(await FolderService.assertParentFolder('u', 'p')).toBe(true);
    });

    it('returns false when the parent is missing or owned by someone else', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);
      expect(await FolderService.assertParentFolder('u', 'p')).toBe(false);
    });
  });

  describe('wouldCreateFolderCycle', () => {
    it('returns true when the parent is the folder itself', async () => {
      expect(await FolderService.wouldCreateFolderCycle('u', 'a', 'a')).toBe(true);
      expect(db.folder.findFirst).not.toHaveBeenCalled();
    });

    it('returns true when an ancestor chain leads back to the folder', async () => {
      vi.mocked(db.folder.findFirst).mockImplementation((async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        if (id === 'parent') return folder('parent', 'a') as never;
        return null;
      }) as never);
      expect(await FolderService.wouldCreateFolderCycle('u', 'a', 'parent')).toBe(true);
    });

    it('returns false for an unrelated parent chain', async () => {
      vi.mocked(db.folder.findFirst).mockImplementation((async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        if (id === 'parent') return folder('parent', null) as never;
        return null;
      }) as never);
      expect(await FolderService.wouldCreateFolderCycle('u', 'a', 'parent')).toBe(false);
    });

    it('returns false when the parent does not exist', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);
      expect(await FolderService.wouldCreateFolderCycle('u', 'a', 'ghost')).toBe(false);
    });
  });

  describe('createFolder', () => {
    it('returns parent_not_found without creating', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);
      const result = await FolderService.createFolder({ userId: 'u', name: 'n', parentId: 'p' });
      expect(result).toEqual({ kind: 'parent_not_found' });
      expect(db.folder.create).not.toHaveBeenCalled();
    });

    it('creates at the root when parentId is null', async () => {
      vi.mocked(db.folder.create).mockResolvedValue(folder('n', null) as never);
      const result = await FolderService.createFolder({ userId: 'u', name: 'n', parentId: null });
      expect(result.kind).toBe('ok');
      expect(db.folder.create).toHaveBeenCalledOnce();
    });
  });

  describe('updateFolder', () => {
    it('returns not_found without updating', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);
      const result = await FolderService.updateFolder({ userId: 'u', id: 'a' });
      expect(result).toEqual({ kind: 'not_found' });
      expect(db.folder.update).not.toHaveBeenCalled();
    });

    it('rejects self-parenting', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue({ id: 'a' } as never);
      const result = await FolderService.updateFolder({ userId: 'u', id: 'a', parentId: 'a' });
      expect(result).toEqual({ kind: 'self_parent' });
    });

    it('rejects cycles', async () => {
      vi.mocked(db.folder.findFirst).mockImplementation((async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        if (id === 'a') return { id: 'a' } as never;
        if (id === 'parent') return folder('parent', 'a') as never;
        return null;
      }) as never);
      const result = await FolderService.updateFolder({ userId: 'u', id: 'a', parentId: 'parent' });
      expect(result).toEqual({ kind: 'cycle' });
      expect(db.folder.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteFolderCascade', () => {
    it('returns not_found without touching the database', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);
      const result = await FolderService.deleteFolderCascade('u', 'a');
      expect(result).toEqual({ kind: 'not_found' });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('deletes the folder, its descendants, and their files in one transaction', async () => {
      vi.mocked(db.folder.findFirst).mockResolvedValue({ id: 'root' } as never);
      vi.mocked(db.folder.findMany).mockImplementation((async (args: unknown) => {
        const ids = (args as { where: { parentId: { in: string[] } } }).where.parentId.in;
        if (ids.includes('root')) return [folder('child')] as never;
        return [] as never;
      }) as never);
      const result = await FolderService.deleteFolderCascade('u', 'root');
      expect(result).toEqual({ kind: 'ok' });
      expect(db.$transaction).toHaveBeenCalledOnce();
      const ops = vi.mocked(db.$transaction).mock.calls[0]?.[0];
      expect(ops).toHaveLength(2);
    });
  });
});
