import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@dripl/db', () => ({
  db: {
    file: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { db, type Prisma } from '@dripl/db';
import { ShareService } from '../../services/shareService';

const mockFindFirst = vi.mocked(db.file.findFirst);
const mockUpdateMany = vi.mocked(db.file.updateMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe('ShareService.upsertShareToken', () => {
  const USER_ID = 'user-1';
  const FILE_ID = 'file-1';
  // Fixed so the optimistic-concurrency fence is assertable by value rather than
  // only by type. Must be a real Date: both mutating paths put it in `where`.
  const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');

  /**
   * Exactly the row `upsertShareToken`'s `findFirst` select returns. Deriving it
   * from the select (rather than from `db.file.findFirst`, whose generic erases
   * to the full 12-column `File` row) means widening or narrowing that select in
   * `shareService.ts` is a compile error here instead of a runtime `undefined`
   * handed to a column the service actually reads.
   */
  type UpsertShareFileRow = Prisma.FileGetPayload<{
    select: {
      id: true;
      userId: true;
      shareToken: true;
      sharePermission: true;
      shareExpiresAt: true;
      updatedAt: true;
    };
  }>;

  // Complete row: every selected column has a default, so nothing reaches the
  // service as `undefined` by accident.
  const fileMock = (overrides: Partial<UpsertShareFileRow> = {}): UpsertShareFileRow => ({
    id: FILE_ID,
    userId: USER_ID,
    shareToken: null,
    sharePermission: null,
    shareExpiresAt: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  });

  /**
   * `vi.mocked()` erases `findFirst`'s generic to its no-select constraint, so
   * `mockResolvedValue` still demands the full row. This is the single place that
   * gap is bridged: the cast widens the six selected columns back to the full
   * row, and the service only ever reads the six.
   */
  const givenFile = (row: UpsertShareFileRow | null): void => {
    mockFindFirst.mockResolvedValue(row as Awaited<ReturnType<typeof db.file.findFirst>>);
  };

  it('returns not_found when the file does not exist', async () => {
    givenFile(null);
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('returns forbidden when the user does not own the file', async () => {
    givenFile(fileMock({ userId: 'someone-else' }));
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');
    expect(result).toEqual({ kind: 'forbidden' });
  });

  it('generates a new token when the file has none', async () => {
    givenFile(fileMock({ shareToken: null }));
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'edit');
    expect(result?.kind).toBe('ok');
    if (result?.kind !== 'ok') throw new Error('expected ok');
    expect(result.token).not.toBeNull();
    expect(result.token!.length).toBeGreaterThanOrEqual(24);
    expect(result.token!).toMatch(/^[A-Za-z0-9_-]+$/);
    // The rotate path is fenced on the row it read.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FILE_ID, userId: USER_ID, updatedAt: UPDATED_AT }),
      })
    );
  });

  it('reuses an existing share token when the permission is unchanged', async () => {
    givenFile(fileMock({ shareToken: 'existing-token-abc', sharePermission: 'view' }));

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');

    expect(result).toEqual({ kind: 'ok', token: 'existing-token-abc' });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('rotates an expired token instead of reusing it', async () => {
    givenFile(
      fileMock({
        shareToken: 'expired-token',
        sharePermission: 'view',
        shareExpiresAt: new Date(Date.now() - 1_000),
      })
    );
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'view');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.token).not.toBe('expired-token');
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FILE_ID, userId: USER_ID, updatedAt: UPDATED_AT }),
        data: expect.objectContaining({ shareExpiresAt: null }),
      })
    );
  });

  it('rotates the token when the permission changes', async () => {
    givenFile(fileMock({ shareToken: 'old-view-token', sharePermission: 'view' }));
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'edit');

    expect(result).toEqual({ kind: 'ok', token: expect.any(String) });
    if (result?.kind !== 'ok') throw new Error('expected ok');
    expect(result.token).not.toBe('old-view-token');
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FILE_ID, userId: USER_ID, updatedAt: UPDATED_AT }),
        data: expect.objectContaining({
          sharePermission: 'edit',
          shareToken: result.token,
          shareExpiresAt: null,
        }),
      })
    );
  });

  it('clears the share token when called with a null permission', async () => {
    givenFile(fileMock({ shareToken: 'old-token', sharePermission: 'edit' }));
    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, null);

    expect(result).toEqual({ kind: 'ok', token: null });
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: FILE_ID, userId: USER_ID, updatedAt: UPDATED_AT }),
        data: expect.objectContaining({
          sharePermission: null,
          shareToken: null,
        }),
      })
    );
  });

  // The two tests below are the point of the `updatedAt` fence: if the guard
  // were dropped from `where`, these would still report success.
  it('reports not_found when the rotate fence loses the race', async () => {
    givenFile(fileMock({ shareToken: 'old-view-token', sharePermission: 'view' }));
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, 'edit');

    expect(result).toEqual({ kind: 'not_found' });
  });

  it('reports not_found when the revoke fence loses the race', async () => {
    givenFile(fileMock({ shareToken: 'old-token', sharePermission: 'edit' }));
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await ShareService.upsertShareToken(FILE_ID, USER_ID, null);

    expect(result).toEqual({ kind: 'not_found' });
  });
});
