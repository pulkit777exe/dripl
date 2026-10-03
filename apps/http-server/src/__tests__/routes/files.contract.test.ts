/**
 * The HTTP contract of the file API: status codes, response envelopes, and the
 * `serviceResult` kind → status mapping.
 *
 * The authorisation cases live in `files.authorization.test.ts`. This file
 * covers everything else the route is responsible for, and asserts the full
 * response body rather than only the status, because the envelope is part of
 * what clients depend on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

import { MAX_FILE_CONTENT_BYTES } from '@dripl/common';
import { db } from '@dripl/db';
import { filesRouter } from '../../routes/files';
import {
  buildApp,
  del,
  get,
  OWNER_ID,
  OUTSIDER_ID,
  patch,
  post,
  seedSessionUser,
  VALID_ELEMENT,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const app = buildApp([{ path: '/api/files', router: filesRouter }]);

const FILE_ID = 'file-1';
const FILE_UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');

/**
 * Both principals as `User` rows.
 *
 * `authMiddleware` refuses a token whose subject has no stored token generation,
 * so every authenticated request in this file needs the account to exist. Called
 * from each `beforeEach` next to `resetFakeDb()` rather than folded into
 * `bearer()`, so a test that wants "no such account" can still say so.
 */
function seedSessionUsers(): void {
  seedSessionUser(OWNER_ID);
  seedSessionUser(OUTSIDER_ID);
}

function seedFile(overrides: Record<string, unknown> = {}): void {
  fakeDb().seed('file', {
    id: FILE_ID,
    userId: OWNER_ID,
    name: 'Canvas',
    content: JSON.stringify([VALID_ELEMENT]),
    folderId: null,
    preview: null,
    shareToken: null,
    sharePermission: null,
    shareExpiresAt: null,
    updatedAt: FILE_UPDATED_AT,
    ...overrides,
  });
}

function seedFolder(id: string, userId: string): void {
  fakeDb().seed('folder', { id, userId, name: id, parentId: null });
}

/**
 * A scene over the 2 MB byte cap but still under Express's 5 MB parser limit,
 * so the route's own size check is what answers. 250 text elements of 10k
 * characters each serialise to roughly 2.5 MB.
 */
function oversizedContent(): unknown {
  return Array.from({ length: 250 }, (_, index) => ({
    id: `t-${index}`,
    type: 'text',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    text: 'x'.repeat(10_000),
  }));
}

describe('GET /api/files', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile();
    fakeDb().seed('file', {
      id: 'file-2',
      userId: OWNER_ID,
      name: 'Second',
      content: '[]',
      folderId: null,
      preview: null,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    fakeDb().seed('file', {
      id: 'file-3',
      userId: OUTSIDER_ID,
      name: 'Not mine',
      content: '[]',
      folderId: null,
      preview: null,
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    });
  });

  it('returns the page envelope with a total for offset pagination', async () => {
    const response = await get(app, '/api/files', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      files: [
        expect.objectContaining({ id: 'file-2', name: 'Second' }),
        expect.objectContaining({ id: FILE_ID, name: 'Canvas' }),
      ],
      total: 2,
      page: 1,
      limit: 20,
      nextCursor: null,
    });
    expect(response.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{32}"$/);
  });

  it('honours page and limit', async () => {
    const response = await get(app, '/api/files?page=2&limit=1', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.files.map((file: { id: string }) => file.id)).toEqual([FILE_ID]);
    expect(response.body.page).toBe(2);
    expect(response.body.limit).toBe(1);
  });

  it('drops total and page in cursor mode and hands back a cursor', async () => {
    fakeDb().seed('file', {
      id: 'file-4',
      userId: OWNER_ID,
      name: 'Third',
      content: '[]',
      folderId: null,
      preview: null,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const response = await get(
      app,
      '/api/files?limit=2&cursor=' + encodeURIComponent('2026-03-01T00:00:00.000Z'),
      OWNER_ID
    );

    expect(response.status).toBe(200);
    // Ordered newest-first and truncated to `limit`, so the cursor is the
    // updatedAt of the LAST row in this page, not the newest overall.
    expect(response.body.files.map((file: { id: string }) => file.id)).toEqual([
      'file-4',
      'file-2',
    ]);
    expect(response.body).not.toHaveProperty('total');
    expect(response.body).not.toHaveProperty('page');
    expect(response.body.nextCursor).toBe('2026-01-02T00:00:00.000Z');
  });

  it('filters by search, case-insensitively', async () => {
    const response = await get(app, '/api/files?search=SECOND', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.files.map((file: { id: string }) => file.id)).toEqual(['file-2']);
  });

  it('answers 400 INVALID_QUERY with zod details for a bad page', async () => {
    const response = await get(app, '/api/files?page=0', OWNER_ID);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_QUERY');
    expect(response.body.statusCode).toBe(400);
    expect(response.body.details.fieldErrors.page).toBeDefined();
  });

  it('answers 400 INVALID_QUERY when limit exceeds the cap', async () => {
    const response = await get(app, '/api/files?limit=101', OWNER_ID);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_QUERY');
  });

  it('answers 304 with no body when the ETag matches', async () => {
    const first = await get(app, '/api/files', OWNER_ID);
    const second = await get(app, '/api/files', OWNER_ID, {
      'If-None-Match': first.headers.etag as string,
    });

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findMany = vi.spyOn(db.file, 'findMany').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/files', OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Failed to list files',
      statusCode: 500,
    });
    findMany.mockRestore();
  });
});

describe('GET /api/files/shared', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile();
    fakeDb().seed('sharedFile', {
      id: 'shared-1',
      fileId: FILE_ID,
      userId: OWNER_ID,
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
    });
  });

  it('returns the shares the caller made, with sharer attribution', async () => {
    const response = await get(app, '/api/files/shared', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.files[0]).toMatchObject({
      id: FILE_ID,
      sharedAt: '2026-01-05T00:00:00.000Z',
    });
  });

  it('answers 400 INVALID_QUERY for a malformed cursor', async () => {
    const response = await get(app, '/api/files/shared?limit=0', OWNER_ID);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_QUERY');
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findMany = vi
      .spyOn(db.sharedFile, 'findMany')
      .mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/files/shared', OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to list shared files');
    findMany.mockRestore();
  });
});

describe('POST /api/files', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
  });

  it('creates a file and returns 201 with just id and name', async () => {
    const response = await post(app, '/api/files', OWNER_ID, { name: 'Fresh' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: expect.any(String), name: 'Fresh' });
  });

  it('defaults the name and content when the body is empty', async () => {
    const response = await post(app, '/api/files', OWNER_ID, {});

    expect(response.status).toBe(201);
    const created = fakeDb()
      .rows('file')
      .find(row => row.id === response.body.id);
    expect(created?.name).toBe('Untitled file');
    // ADR-004: content is a serialized envelope, not a bare array. An absent
    // scene is an empty `elements` list inside it.
    expect(JSON.parse(String(created?.content))).toMatchObject({ elements: [] });
  });

  it('maps quota_exceeded to 403 FORBIDDEN with the live limit in the message', async () => {
    for (let index = 0; index < 3; index += 1) {
      fakeDb().seed('file', {
        id: `quota-${index}`,
        userId: OWNER_ID,
        name: `f${index}`,
        content: '[]',
        folderId: null,
        preview: null,
      });
    }

    const response = await post(app, '/api/files', OWNER_ID, { name: 'one too many' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'FORBIDDEN',
      message: 'Free plan limit reached (3 canvases). Delete one or upgrade to Premium.',
      statusCode: 403,
    });
  });

  it('maps folder_not_found to 404 with the folder message', async () => {
    seedFolder('folder-mine', OWNER_ID);

    const response = await post(app, '/api/files', OWNER_ID, { folderId: 'folder-missing' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Folder not found');
  });

  it('maps invalid_scene to 400 INVALID_SCENE', async () => {
    const response = await post(app, '/api/files', OWNER_ID, { content: [{ nope: true }] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_SCENE',
      message: 'Invalid scene content',
      statusCode: 400,
    });
  });

  it('answers 400 INVALID_PAYLOAD with zod details for a bad name', async () => {
    const response = await post(app, '/api/files', OWNER_ID, { name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details.fieldErrors.name).toBeDefined();
  });

  it('answers 413 PAYLOAD_TOO_LARGE before the service sees the content', async () => {
    const create = vi.spyOn(db.file, 'create');

    const response = await post(app, '/api/files', OWNER_ID, { content: oversizedContent() });

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.message).toContain(String(MAX_FILE_CONTENT_BYTES));
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const create = vi.spyOn(db.file, 'create').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/files', OWNER_ID, { name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to create file');
    create.mockRestore();
  });
});

describe('GET /api/files/:id', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile();
  });

  it('returns the parsed scene and share state', async () => {
    const response = await get(app, `/api/files/${FILE_ID}`, OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.file).toMatchObject({
      id: FILE_ID,
      name: 'Canvas',
      content: [VALID_ELEMENT],
      folderId: null,
      shareToken: null,
    });
  });

  it('answers 404 for a missing file', async () => {
    const response = await get(app, '/api/files/nope', OWNER_ID);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('File not found');
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findFirst = vi.spyOn(db.file, 'findFirst').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, `/api/files/${FILE_ID}`, OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to load file');
    findFirst.mockRestore();
  });
});

describe('PATCH /api/files/:id', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile();
  });

  it('renames the file and returns 200', async () => {
    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, { name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body.file).toMatchObject({ id: FILE_ID, name: 'Renamed' });
    expect(fakeDb().rows('file')[0]?.name).toBe('Renamed');
  });

  it('accepts a folder the caller owns', async () => {
    seedFolder('folder-mine', OWNER_ID);

    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, {
      folderId: 'folder-mine',
    });

    expect(response.status).toBe(200);
    expect(response.body.file.folderId).toBe('folder-mine');
  });

  it('accepts an explicit null folder to move the file to the root', async () => {
    seedFile({ folderId: 'folder-elsewhere' });

    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, { folderId: null });

    expect(response.status).toBe(200);
    expect(response.body.file.folderId).toBeNull();
  });

  it('answers 404 for a missing file', async () => {
    const response = await patch(app, '/api/files/nope', OWNER_ID, { name: 'x' });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('File not found');
  });

  it('maps the optimistic-concurrency fence to 409 CONFLICT', async () => {
    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, {
      name: 'stale write',
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'CONFLICT',
      message: 'File changed while saving',
      statusCode: 409,
    });
    expect(fakeDb().rows('file')[0]?.name).toBe('Canvas');
  });

  it('maps folder_not_found to 404', async () => {
    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, {
      folderId: 'folder-nope',
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Folder not found');
  });

  it('maps invalid_scene to 400 INVALID_SCENE', async () => {
    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, {
      content: [{ nope: true }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_SCENE');
  });

  it('answers 400 INVALID_PAYLOAD with zod details for an over-long name', async () => {
    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, {
      name: 'x'.repeat(201),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details.fieldErrors.name).toBeDefined();
  });

  it('answers 413 PAYLOAD_TOO_LARGE before the service sees the content', async () => {
    const update = vi.spyOn(db.file, 'updateManyAndReturn');

    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, {
      content: oversizedContent(),
    });

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('PAYLOAD_TOO_LARGE');
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findFirst = vi.spyOn(db.file, 'findFirst').mockRejectedValueOnce(new Error('db down'));

    const response = await patch(app, `/api/files/${FILE_ID}`, OWNER_ID, { name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to update file');
    findFirst.mockRestore();
  });
});

describe('DELETE /api/files/:id', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile();
  });

  it('deletes the file and answers 204 with an empty body', async () => {
    const response = await del(app, `/api/files/${FILE_ID}`, OWNER_ID);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(fakeDb().rows('file')).toHaveLength(0);
  });

  it('answers 404 for a missing file', async () => {
    const response = await del(app, '/api/files/nope', OWNER_ID);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('File not found');
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findFirst = vi.spyOn(db.file, 'findFirst').mockRejectedValueOnce(new Error('db down'));

    const response = await del(app, `/api/files/${FILE_ID}`, OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to delete file');
    findFirst.mockRestore();
  });
});

describe('POST /api/files/:id/share', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile();
  });

  it('creates a share link with the key in the URL fragment', async () => {
    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {});

    expect(response.status).toBe(201);
    expect(response.body.permission).toBe('view');
    expect(response.body.expiresAt).toBeNull();
    expect(response.body.token).toEqual(expect.any(String));
    // The decryption key must never travel to the server, so it lives in the
    // fragment — which is not sent in a request line.
    expect(response.body.shareUrl).toContain('#key=');
    expect(response.body.shareUrl.split('#')[0]).not.toContain('key=');
    expect(fakeDb().rows('file')[0]?.shareToken).toBe(response.body.token);
  });

  it('accepts an edit permission and an hours-based expiry', async () => {
    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {
      permission: 'edit',
      expiresInHours: 2,
    });

    expect(response.status).toBe(201);
    expect(response.body.permission).toBe('edit');
    expect(new Date(String(response.body.expiresAt)).getTime()).toBeGreaterThan(Date.now());
  });

  it('answers 400 INVALID_PAYLOAD for an unknown permission', async () => {
    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {
      permission: 'owner',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details.fieldErrors.permission).toBeDefined();
  });

  it('answers 400 INVALID_PAYLOAD for an expiry in the past', async () => {
    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details.fieldErrors.expiresAt).toBeDefined();
  });

  it('answers 400 INVALID_PAYLOAD for an expiry longer than a year', async () => {
    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {
      expiresInHours: 24 * 365 + 1,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
  });

  it('answers 404 for a missing file', async () => {
    const response = await post(app, '/api/files/nope/share', OWNER_ID, {});

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('File not found');
  });

  it('maps invalid_scene to 400 when the stored scene no longer parses', async () => {
    seedFile({ content: JSON.stringify([{ nope: true }]) });

    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_SCENE');
  });

  it('maps a concurrent write to 409 CONFLICT', async () => {
    const updateMany = vi.spyOn(db.file, 'updateMany').mockResolvedValueOnce({ count: 0 });

    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'CONFLICT',
      message: 'Share changed while creating; retry',
      statusCode: 409,
    });
    updateMany.mockRestore();
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findFirst = vi.spyOn(db.file, 'findFirst').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, `/api/files/${FILE_ID}/share`, OWNER_ID, {});

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to create share link');
    findFirst.mockRestore();
  });
});

describe('DELETE /api/files/:id/share', () => {
  beforeEach(() => {
    resetFakeDb();
    seedSessionUsers();
    seedFile({ shareToken: 'live-token', sharePermission: 'view' });
  });

  it('clears the share state and answers 204', async () => {
    const response = await del(app, `/api/files/${FILE_ID}/share`, OWNER_ID);

    expect(response.status).toBe(204);
    const row = fakeDb()
      .rows('file')
      .find(file => file.id === FILE_ID);
    expect(row?.shareToken).toBeNull();
    expect(row?.sharePermission).toBeNull();
    expect(row?.shareExpiresAt).toBeNull();
  });

  it('answers 404 for a missing file', async () => {
    const response = await del(app, '/api/files/nope/share', OWNER_ID);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('File not found');
  });

  it('answers 500 INTERNAL_ERROR when the service throws', async () => {
    const findFirst = vi.spyOn(db.file, 'findFirst').mockRejectedValueOnce(new Error('db down'));

    const response = await del(app, `/api/files/${FILE_ID}/share`, OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to revoke share link');
    findFirst.mockRestore();
  });
});
