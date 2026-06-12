import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
    },
  },
}));

import { db } from '@dripl/db';
import { ShareService } from '../src/services/shareService';

const mockFindFirst = vi.mocked(db.file.findFirst);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ShareService.resolveShare', () => {
  it('returns null when token not found', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await ShareService.resolveShare('invalid-token');
    expect(result).toBeNull();
  });

  it('returns file data with view permission', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'file-1',
      name: 'My Canvas',
      content: JSON.stringify([{ id: 'el1', type: 'rectangle' }]),
      sharePermission: 'view',
      shareExpiresAt: null,
      updatedAt: new Date('2025-01-01'),
    });

    const result = await ShareService.resolveShare('valid-token');
    expect(result).not.toBeNull();
    expect(result!.file.id).toBe('file-1');
    expect(result!.file.name).toBe('My Canvas');
    expect(result!.permission).toBe('view');
    expect(result!.expired).toBe(false);
    expect(result!.elements).toEqual([{ id: 'el1', type: 'rectangle' }]);
  });

  it('marks expired shares', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'file-2',
      name: 'Expired Canvas',
      content: '[]',
      sharePermission: 'view',
      shareExpiresAt: new Date('2020-01-01'),
      updatedAt: new Date('2025-01-01'),
    });

    const result = await ShareService.resolveShare('expired-token');
    expect(result).not.toBeNull();
    expect(result!.expired).toBe(true);
  });

  it('defaults permission to view when null', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'file-3',
      name: 'Canvas',
      content: '[]',
      sharePermission: null,
      shareExpiresAt: null,
      updatedAt: new Date('2025-01-01'),
    });

    const result = await ShareService.resolveShare('token');
    expect(result!.permission).toBe('view');
  });
});
