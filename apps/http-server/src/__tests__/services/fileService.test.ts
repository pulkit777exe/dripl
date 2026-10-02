import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService, FREE_PLAN_FILE_LIMIT } from '../../services/fileService';
import { db } from '@dripl/db';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      updateManyAndReturn: vi.fn(),
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

describe('FileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.file.updateManyAndReturn).mockResolvedValue([
      {
        id: 'file-1',
        name: 'File',
        preview: null,
        folderId: null,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ] as never);
  });

  describe('ensureFolderOwnership', () => {
    it('returns true for null folderId', async () => {
      const result = await FileService.ensureFolderOwnership('user-1', null);
      expect(result).toBe(true);
    });

    it('returns true when folder exists', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.folder.findFirst).mockResolvedValue({ id: 'folder-1' } as never);

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
      expect(result).toEqual({ kind: 'quota_exceeded', limit: FREE_PLAN_FILE_LIMIT });
    });

    it('rejects when folder not owned', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.count).mockResolvedValue(0);
      vi.mocked(db.folder.findFirst).mockResolvedValue(null);

      const result = await FileService.createFile({
        userId: 'user-1',
        folderId: 'other-folder',
      });
      expect(result).toEqual({ kind: 'folder_not_found' });
    });

    it('rejects invalid scene content', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.count).mockResolvedValue(0);

      const result = await FileService.createFile({
        userId: 'user-1',
        content: [{ nope: true }],
      });
      expect(result).toEqual({ kind: 'invalid_scene' });
    });
  });

  describe('updateFile', () => {
    it('preserves an issued encrypted share snapshot when the owner edits', async () => {
      const { db } = await import('@dripl/db');
      const { parseStoredFileContent, serializeStoredFileContent } =
        await import('../../lib/encrypt');
      const encryptedPayload = { iv: 'iv', data: 'ciphertext' };
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        content: 'stored',
        folderId: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        name: 'File',
        preview: null,
      } as never);
      vi.mocked(parseStoredFileContent).mockImplementation(raw =>
        raw === 'stored'
          ? {
              elements: [
                { id: 'old-element', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
              ],
              encryptedPayload,
              encryptedAt: '2026-01-01T00:00:00.000Z',
              appState: { zoom: 1 },
            }
          : {
              elements: [
                { id: 'new-element', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
              ],
              encryptedPayload: null,
              encryptedAt: null,
              appState: { zoom: 2 },
            }
      );
      vi.mocked(serializeStoredFileContent).mockReturnValue('serialized');
      vi.mocked(db.file.updateManyAndReturn).mockResolvedValue([
        {
          id: 'file-1',
          name: 'File',
          preview: null,
          folderId: null,
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ] as never);

      const result = await FileService.updateFile({
        userId: 'user-1',
        fileId: 'file-1',
        content: [{ id: 'new-element', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
      });

      expect(result && 'file' in result ? result.file?.updatedAt : undefined).toEqual(
        new Date('2026-01-02T00:00:00.000Z')
      );
      expect(serializeStoredFileContent).toHaveBeenCalledWith(
        expect.objectContaining({
          encryptedPayload,
          encryptedAt: '2026-01-01T00:00:00.000Z',
        })
      );
    });

    it('rejects a stale owner save instead of overwriting a newer scene', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        content: 'stored',
        folderId: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        name: 'File',
        preview: null,
      } as never);
      vi.mocked(db.file.updateManyAndReturn).mockResolvedValue([] as never);

      const result = await FileService.updateFile({
        userId: 'user-1',
        fileId: 'file-1',
        content: [{ id: 'new', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
      });

      expect(result).toEqual({ kind: 'conflict' });
    });

    it('rejects invalid scene content before touching storage', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        content: 'stored',
        folderId: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        name: 'File',
        preview: null,
      } as never);

      const result = await FileService.updateFile({
        userId: 'user-1',
        fileId: 'file-1',
        content: [{ nope: true }],
      });

      expect(result).toEqual({ kind: 'invalid_scene' });
      expect(db.file.updateManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('createShare', () => {
    const storedFile = {
      id: 'file-1',
      userId: 'user-1',
      content: 'stored',
      folderId: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      name: 'File',
      preview: null,
    } as never;

    it('rejects invalid stored scene content', async () => {
      const { db } = await import('@dripl/db');
      const { parseStoredFileContent } = await import('../../lib/encrypt');
      vi.mocked(db.file.findFirst).mockResolvedValue(storedFile);
      vi.mocked(parseStoredFileContent).mockReturnValue({ elements: [{ nope: true }] } as never);

      const result = await FileService.createShare({
        userId: 'user-1',
        fileId: 'file-1',
        permission: 'view',
      });

      expect(result).toEqual({ kind: 'invalid_scene' });
    });

    it('reports a concurrent share write as a conflict', async () => {
      const { db } = await import('@dripl/db');
      const { parseStoredFileContent, buildEncryptedShare } = await import('../../lib/encrypt');
      vi.mocked(db.file.findFirst).mockResolvedValue(storedFile);
      vi.mocked(parseStoredFileContent).mockReturnValue({
        elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
        appState: null,
      } as never);
      vi.mocked(buildEncryptedShare).mockResolvedValue({
        shareUrl: 'http://localhost:3000/share/t',
        encryptedPayload: { iv: 'iv', data: 'ciphertext' },
      } as never);
      vi.mocked(db.file.updateMany).mockResolvedValue({ count: 0 } as never);

      const result = await FileService.createShare({
        userId: 'user-1',
        fileId: 'file-1',
        permission: 'view',
      });

      expect(result).toEqual({ kind: 'conflict' });
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
      vi.mocked(db.file.findFirst).mockResolvedValue({ id: 'file-1' } as never);
      vi.mocked(db.file.delete).mockResolvedValue({} as never);

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
      vi.mocked(db.file.findFirst).mockResolvedValue({ id: 'file-1' } as never);
      vi.mocked(db.file.update).mockResolvedValue({} as never);

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
