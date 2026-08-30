import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from '@dripl/db';
import { ShareService } from '../src/services/shareService';

const mockFindFirst = vi.mocked(db.file.findFirst);
const mockUpdate = vi.mocked(db.file.update);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ShareService.upsertShareToken', () => {
  const USER_ID = 'user-1';
  const FILE_ID = 'file-1';

  // The File model has many columns; tests only exercise the ones
  // the service reads, so cast to a partial for the mock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileMock = (overrides: Record<string, unknown>): any => ({
    id: FILE_ID,
    userId: USER_ID,
    shareToken: null,
    sharePermission: null,
    ...overrides,
  });

  it('returns not_found when the file does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('returns forbidden when the user does not own the file', async () => {
    mockFindFirst.mockResolvedValue(fileMock({ userId: 'someone-else' }));
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');
    expect(result).toEqual({ kind: 'forbidden' });
  });

  it('generates a new token when the file has none', async () => {
    mockFindFirst.mockResolvedValue(fileMock({ shareToken: null }));
    mockUpdate.mockResolvedValue({ id: FILE_ID });

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'edit');
    expect(result?.kind).toBe('ok');
    if (result?.kind !== 'ok') throw new Error('expected ok');
    expect(result.token).not.toBeNull();
    expect(result.token.length).toBeGreaterThanOrEqual(24);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reuses an existing share token when the permission is unchanged', async () => {
    mockFindFirst.mockResolvedValue(
      fileMock({ shareToken: 'existing-token-abc', sharePermission: 'view' })
    );

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');

    expect(result).toEqual({ kind: 'ok', token: 'existing-token-abc' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rotates the token when the permission changes', async () => {
    mockFindFirst.mockResolvedValue(
      fileMock({ shareToken: 'old-view-token', sharePermission: 'view' })
    );
    mockUpdate.mockResolvedValue({ id: FILE_ID });

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'edit');

    expect(result).toEqual({ kind: 'ok', token: expect.any(String) });
    if (result?.kind !== 'ok') throw new Error('expected ok');
    expect(result.token).not.toBe('old-view-token');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FILE_ID },
        data: expect.objectContaining({
          sharePermission: 'edit',
          shareToken: result.token,
        }),
      })
    );
  });

  it('clears the share token when called with a null permission', async () => {
    mockFindFirst.mockResolvedValue(
      fileMock({ shareToken: 'old-token', sharePermission: 'edit' })
    );
    mockUpdate.mockResolvedValue({ id: FILE_ID });

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, null);

    expect(result).toEqual({ kind: 'ok', token: null });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FILE_ID },
        data: expect.objectContaining({
          sharePermission: null,
          shareToken: null,
        }),
      })
    );
  });
});
