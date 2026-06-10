import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService } from '../../services/fileService';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    folder: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../lib/encrypt', () => ({
  parseStoredFileContent: vi.fn(),
  serializeStoredFileContent: vi.fn(),
  buildEncryptedShare: vi.fn(),
}));

vi.mock('../../routes/files', () => ({
  nanoidLike: vi.fn(() => 'mock-token-123'),
}));

describe('FileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureFolderOwnership', () => {
    it('returns true for null folderId', async () => {
      const result = await FileService.ensureFolderOwnership('user-1', null);
      expect(result).toBe(true);
    });

    it('returns true when folder exists', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.folder.findFirst).mockResolvedValue({ id: 'folder-1' } as any);

      const result = await FileService.ensureFolderOwnership('user-1', 'folder-1');
      expect(result).toBe(true);
    });

    it('returns false when folder not found', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);

      const result = await FileService.ensureFolderOwnership('user-1', 'other-folder');
      expect(result).toBe(false);
    });
  });

  describe('createFile', () => {
    it('rejects when file limit reached', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.count).mockResolvedValue(3);

      const result = await FileService.createFile({ userId: 'user-1' });
      expect('error' in result && result.error).toContain('Free plan limit reached');
    });

    it('rejects when folder not owned', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.count).mockResolvedValue(0);
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);

      const result = await FileService.createFile({
        userId: 'user-1',
        folderId: 'other-folder',
      });
      expect('error' in result && result.error).toBe('Folder not found');
    });
  });

  describe('deleteFile', () => {
    it('returns false for non-existent file', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue(null);

      const result = await FileService.deleteFile('user-1', 'file-1');
      expect(result).toBe(false);
    });

    it('deletes owned file', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue({ id: 'file-1' } as any);
      vi.mocked(db.file.delete).mockResolvedValue({} as any);

      const result = await FileService.deleteFile('user-1', 'file-1');
      expect(result).toBe(true);
      expect(db.file.delete).toHaveBeenCalledWith({ where: { id: 'file-1' } });
    });
  });

  describe('revokeShare', () => {
    it('returns false for non-existent file', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue(null);

      const result = await FileService.revokeShare('user-1', 'file-1');
      expect(result).toBe(false);
    });

    it('revokes share on owned file', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue({ id: 'file-1' } as any);
      vi.mocked(db.file.update).mockResolvedValue({} as any);

      const result = await FileService.revokeShare('user-1', 'file-1');
      expect(result).toBe(true);
      expect(db.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: {
          shareToken: null,
          sharePermission: null,
          shareExpiresAt: null,
        },
      });
    });
  });
});
