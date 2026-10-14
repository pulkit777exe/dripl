import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  paginatedQuery,
  ERROR_CODES,
  ErrorCodeSchema,
  FileSummarySchema,
  FolderSummarySchema,
  RoomSummarySchema,
  type Page,
  type FileListPage,
  type FileSummary,
} from './contract';
// Barrel precedence: './schemas' and './contract' both provide these names;
// the explicit re-export block in index.ts must win so they stay importable.
import { CreateFileSchema, FileSchema } from './index';

describe('paginatedQuery', () => {
  it('applies page/limit defaults on empty input', () => {
    const result = paginatedQuery().safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ page: 1, limit: 20 });
  });

  it('coerces string page/limit like Express req.query', () => {
    const result = paginatedQuery().safeParse({ search: 'board', page: '2', limit: '50' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ search: 'board', page: 2, limit: 50 });
  });

  it('passes cursor through and accepts undefined optionals', () => {
    const result = paginatedQuery().safeParse({ cursor: '2026-01-01T00:00:00.000Z' });
    expect(result.success).toBe(true);
    expect(result.data?.cursor).toBe('2026-01-01T00:00:00.000Z');
  });

  it('merges route-specific extra fields', () => {
    const schema = paginatedQuery({
      folderId: z.string().trim().min(1).max(100).optional(),
    });
    const ok = schema.safeParse({ folderId: 'f1', limit: '10' });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ folderId: 'f1', limit: 10, page: 1 });
    expect(schema.safeParse({ folderId: '' }).success).toBe(false);
  });

  it('rejects non-positive/non-integer/out-of-range pagination', () => {
    const schema = paginatedQuery();
    for (const query of [
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { page: 'abc' },
      { limit: '0' },
      { limit: '101' },
      { limit: 'abc' },
    ]) {
      expect(schema.safeParse(query).success).toBe(false);
    }
  });

  it('rejects empty search and overlong cursor', () => {
    const schema = paginatedQuery();
    expect(schema.safeParse({ search: '   ' }).success).toBe(false);
    expect(schema.safeParse({ search: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('Page', () => {
  it('holds items with required limit and optional paging fields', () => {
    const page: Page<FileSummary> = {
      items: [
        {
          id: 'f1',
          name: 'Board',
          preview: null,
          folderId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      nextCursor: '2026-01-01T00:00:00.000Z',
    };
    expect(page.items).toHaveLength(1);
    expect(page.limit).toBe(20);

    const minimal: Page<string> = { items: [], limit: 20 };
    expect(minimal.items).toEqual([]);
  });
});

describe('FileListPage — the stable shape the list endpoints send', () => {
  // DECISION PIN: `GET /files` and `GET /files/shared` keep `{ files, total,
  // page, limit, nextCursor }` (inside the `{ data }` envelope) rather than
  // migrating to `Page<T>`'s `items`. Every key is always present — `total`
  // and `page` are NOT dropped in cursor mode — and `nextCursor` is
  // `string | null`, null when the page is not full.
  it('has every key always present, with nextCursor null when the page is not full', () => {
    const full: FileListPage<FileSummary> = {
      files: [],
      total: 0,
      page: 1,
      limit: 20,
      nextCursor: null,
    };
    expect(Object.keys(full).sort()).toEqual(['files', 'limit', 'nextCursor', 'page', 'total']);

    const paged: FileListPage<FileSummary> = {
      files: [
        {
          id: 'f1',
          name: 'Board',
          preview: null,
          folderId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      total: 3,
      page: 1,
      limit: 2,
      nextCursor: '2026-01-02T00:00:00.000Z',
    };
    expect(paged.files).toHaveLength(1);
    expect(paged.total).toBe(3);
    expect(typeof paged.nextCursor).toBe('string');
  });
});

describe('ErrorCode', () => {
  // Every code in the KIND_TO_HTTP table
  // (apps/http-server/src/lib/serviceResult.ts) plus the literal codes sent
  // inline by routes/middleware must be covered.
  const requiredCodes = [
    // KIND_TO_HTTP mapped codes
    'NOT_FOUND',
    'FORBIDDEN',
    'CONFLICT',
    'EXPIRED',
    'RATE_LIMITED',
    'INVALID_SCENE',
    'CANNOT_RE_PARENT',
    'FOLDER_HIERARCHY_TOO_DEEP',
    'INVALID_PAYLOAD',
    // Inline route/middleware codes
    'UNAUTHORIZED',
    'INVALID_QUERY',
    'PAYLOAD_TOO_LARGE',
    'INTERNAL_ERROR',
  ] as const;

  it('covers all mapped and inline error codes', () => {
    for (const code of requiredCodes) {
      expect(ERROR_CODES).toContain(code);
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('rejects unknown codes and has no duplicates', () => {
    expect(ErrorCodeSchema.safeParse('NOPE').success).toBe(false);
    expect(ErrorCodeSchema.safeParse('Failed to list folders').success).toBe(false);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('summary DTO schemas', () => {
  it('FileSummarySchema matches the current file list wire shape', () => {
    const result = FileSummarySchema.safeParse({
      id: 'f1',
      name: 'Board',
      preview: null,
      folderId: 'd1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    expect(FileSummarySchema.safeParse({ name: 'Board' }).success).toBe(false);
  });

  it('FolderSummarySchema matches the current folder list wire shape', () => {
    const result = FolderSummarySchema.safeParse({
      id: 'd1',
      name: 'Docs',
      parentId: null,
      fileCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    expect(FolderSummarySchema.safeParse({ id: 'd1', fileCount: -1 }).success).toBe(false);
  });

  it('RoomSummarySchema matches the current room list wire shape', () => {
    const base = {
      id: 'r1',
      slug: 'abc12345',
      name: 'Room',
      isPublic: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    expect(RoomSummarySchema.safeParse(base).success).toBe(true);
    // The wire also selects ownerId, which frontend lists omit.
    expect(RoomSummarySchema.safeParse({ ...base, ownerId: 'u1' }).success).toBe(true);
    expect(RoomSummarySchema.safeParse({ ...base, slug: undefined }).success).toBe(false);
  });

  it('barrel still resolves re-exported schema DTOs', () => {
    expect(CreateFileSchema.safeParse({ name: 'Board' }).success).toBe(true);
    expect(
      FileSchema.safeParse({
        id: 'f1',
        name: 'Board',
        content: '{}',
        preview: null,
        folderId: null,
        teamId: null,
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).success
    ).toBe(true);
  });
});
