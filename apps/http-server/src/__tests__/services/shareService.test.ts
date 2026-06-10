import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareService } from '../../services/shareService';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../lib/encrypt', () => ({
  parseStoredFileContent: vi.fn(),
}));

describe('ShareService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveShare', () => {
    it('returns null for non-existent token', async () => {
      const { db } = await import('@dripl/db');
      vi.mocked(db.file.findFirst).mockResolvedValue(null);

      const result = await ShareService.resolveShare('invalid-token');
      expect(result).toBeNull();
    });

    it('resolves a valid share token', async () => {
      const { db } = await import('@dripl/db');
      const { parseStoredFileContent } = await import('../../lib/encrypt');

      const mockFile = {
        id: 'file-1',
        name: 'Test File',
        content: '[]',
        sharePermission: 'view',
        shareExpiresAt: new Date(Date.now() + 86400000),
        updatedAt: new Date(),
      };

      vi.mocked(db.file.findFirst).mockResolvedValue(mockFile as any);
      vi.mocked(parseStoredFileContent).mockReturnValue({
        elements: [{ id: 'el-1' }],
        encryptedPayload: null,
        encryptedAt: null,
      });

      const result = await ShareService.resolveShare('valid-token');

      expect(result).not.toBeNull();
      expect(result?.file.id).toBe('file-1');
      expect(result?.permission).toBe('view');
      expect(result?.expired).toBe(false);
      expect(result?.elements).toEqual([{ id: 'el-1' }]);
    });

    it('marks expired shares correctly', async () => {
      const { db } = await import('@dripl/db');
      const { parseStoredFileContent } = await import('../../lib/encrypt');

      const mockFile = {
        id: 'file-2',
        name: 'Expired File',
        content: '[]',
        sharePermission: 'edit',
        shareExpiresAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(),
      };

      vi.mocked(db.file.findFirst).mockResolvedValue(mockFile as any);
      vi.mocked(parseStoredFileContent).mockReturnValue({
        elements: [],
        encryptedPayload: null,
        encryptedAt: null,
      });

      const result = await ShareService.resolveShare('expired-token');

      expect(result).not.toBeNull();
      expect(result?.expired).toBe(true);
    });

    it('returns null elements when encrypted', async () => {
      const { db } = await import('@dripl/db');
      const { parseStoredFileContent } = await import('../../lib/encrypt');

      const mockFile = {
        id: 'file-3',
        name: 'Encrypted File',
        content: '{}',
        sharePermission: 'view',
        shareExpiresAt: null,
        updatedAt: new Date(),
      };

      vi.mocked(db.file.findFirst).mockResolvedValue(mockFile as any);
      vi.mocked(parseStoredFileContent).mockReturnValue({
        elements: [],
        encryptedPayload: { iv: 'abc', data: 'def' },
        encryptedAt: '2024-01-01',
      });

      const result = await ShareService.resolveShare('encrypted-token');

      expect(result).not.toBeNull();
      expect(result?.elements).toBeNull();
      expect(result?.encryptedPayload).toEqual({ iv: 'abc', data: 'def' });
    });
  });
});
