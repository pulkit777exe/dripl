/**
 * The HTTP contract of the folder API: status codes, response envelopes, and
 * the `serviceResult` kind → status mapping.
 *
 * The authorisation cases live in `folders.authorization.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDb } = await import('../test-utils/fakePrisma');
  return { db: fakeDb().db, initializeDb: vi.fn(async () => {}) };
});

import { db } from '@dripl/db';
import { foldersRouter } from '../../routes/folders';
import { buildApp, del, get, OWNER_ID, patch, post } from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const app = buildApp([{ path: '/api/folders', router: foldersRouter }]);

const FOLDER_ID = 'folder-1';

function seedFolder(overrides: Record<string, unknown> = {}): void {
  fakeDb().seed('folder', {
    id: FOLDER_ID,
    userId: OWNER_ID,
    name: 'Design',
    parentId: null,
    ...overrides,
  });
}

function rowOf(id: string): Record<string, unknown> | undefined {
  return fakeDb()
    .rows('folder')
    .find(row => row.id === id);
}

describe('GET /api/folders', () => {
  beforeEach(() => {
    resetFakeDb();
    seedFolder();
    fakeDb().seed('file', {
      id: 'file-in-folder',
      userId: OWNER_ID,
      name: 'Inside',
      content: '[]',
      folderId: FOLDER_ID,
      preview: null,
    });
  });

  it('returns the folder list with per-folder file counts', async () => {
    const response = await get(app, '/api/folders', OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.folders).toHaveLength(1);
    expect(response.body.folders[0]).toMatchObject({
      id: FOLDER_ID,
      name: 'Design',
      parentId: null,
      fileCount: 1,
    });
  });

  it('answers 500 with the folder-specific message when the service throws', async () => {
    const findMany = vi.spyOn(db.folder, 'findMany').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/folders', OWNER_ID);

    // This route does not use `sendError`, so it hand-rolls the envelope. The
    // assertion pins that difference rather than normalising it away.
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to list folders',
      message: 'Failed to list folders',
      statusCode: 500,
    });
    findMany.mockRestore();
  });
});

describe('POST /api/folders', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  it('creates a root folder and answers 201', async () => {
    const response = await post(app, '/api/folders', OWNER_ID, { name: 'Research' });

    expect(response.status).toBe(201);
    expect(response.body.folder).toMatchObject({ name: 'Research', parentId: null });
    expect(rowOf(response.body.folder.id)?.userId).toBe(OWNER_ID);
  });

  it('creates a nested folder when the parent exists', async () => {
    seedFolder();

    const response = await post(app, '/api/folders', OWNER_ID, {
      name: 'Nested',
      parentId: FOLDER_ID,
    });

    expect(response.status).toBe(201);
    expect(response.body.folder.parentId).toBe(FOLDER_ID);
  });

  it('maps parent_not_found to 404', async () => {
    const response = await post(app, '/api/folders', OWNER_ID, {
      name: 'Orphan',
      parentId: 'folder-nope',
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Parent folder not found',
      statusCode: 404,
    });
  });

  it('answers 400 with zod details when name is missing', async () => {
    const response = await post(app, '/api/folders', OWNER_ID, {});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid create folder payload');
    expect(response.body.details.fieldErrors.name).toBeDefined();
  });

  it('answers 400 for a blank name', async () => {
    const response = await post(app, '/api/folders', OWNER_ID, { name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.details.fieldErrors.name).toBeDefined();
  });

  it('answers 500 when the service throws', async () => {
    const create = vi.spyOn(db.folder, 'create').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/folders', OWNER_ID, { name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to create folder');
    create.mockRestore();
  });
});

describe('PATCH /api/folders/:id', () => {
  beforeEach(() => {
    resetFakeDb();
    seedFolder();
  });

  it('renames the folder and answers 200', async () => {
    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, { name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body.folder).toMatchObject({ id: FOLDER_ID, name: 'Renamed' });
  });

  it('accepts an explicit null parentId to move the folder to the root', async () => {
    seedFolder({ parentId: 'some-parent' });

    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, { parentId: null });

    expect(response.status).toBe(200);
    expect(response.body.folder.parentId).toBeNull();
  });

  it('maps not_found to 404', async () => {
    const response = await patch(app, '/api/folders/folder-nope', OWNER_ID, { name: 'x' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Folder not found',
      statusCode: 404,
    });
  });

  it('maps self_parent to 400 CANNOT_RE_PARENT', async () => {
    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, {
      parentId: FOLDER_ID,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'CANNOT_RE_PARENT',
      message: 'Folder cannot be its own parent',
      statusCode: 400,
    });
    expect(rowOf(FOLDER_ID)?.parentId).toBeNull();
  });

  it('maps a cycle to 400 CANNOT_RE_PARENT and does not re-parent', async () => {
    // root ── child; re-parenting root under child would close the loop.
    fakeDb().seed('folder', {
      id: 'child',
      userId: OWNER_ID,
      name: 'Child',
      parentId: FOLDER_ID,
    });

    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, { parentId: 'child' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'CANNOT_RE_PARENT',
      message: 'Folder hierarchy cannot contain a cycle',
      statusCode: 400,
    });
    expect(rowOf(FOLDER_ID)?.parentId).toBeNull();
  });

  it('maps parent_not_found to 404', async () => {
    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, {
      parentId: 'folder-nope',
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Parent folder not found');
  });

  it('answers 400 with zod details for a malformed body', async () => {
    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, { name: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid update folder payload');
    expect(response.body.details.fieldErrors.name).toBeDefined();
  });

  it('answers 500 when the service throws', async () => {
    const update = vi.spyOn(db.folder, 'update').mockRejectedValueOnce(new Error('db down'));

    const response = await patch(app, `/api/folders/${FOLDER_ID}`, OWNER_ID, { name: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to update folder');
    update.mockRestore();
  });
});

describe('DELETE /api/folders/:id', () => {
  beforeEach(() => {
    resetFakeDb();
    seedFolder();
  });

  it('deletes the folder and answers 204', async () => {
    const response = await del(app, `/api/folders/${FOLDER_ID}`, OWNER_ID);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(rowOf(FOLDER_ID)).toBeUndefined();
  });

  it('maps not_found to 404', async () => {
    const response = await del(app, '/api/folders/folder-nope', OWNER_ID);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Folder not found',
      statusCode: 404,
    });
  });

  it('maps a too-deep hierarchy to 409 FOLDER_HIERARCHY_TOO_DEEP', async () => {
    // A chain longer than MAX_FOLDER_DEPTH: the guard exists so a corrupt or
    // adversarial tree cannot hold the request open indefinitely, and the
    // answer must be 409 rather than a 500 or a partial delete.
    const { MAX_FOLDER_DEPTH } = await import('../../services/folderService');
    fakeDb().seed('folder', {
      id: 'child',
      userId: OWNER_ID,
      name: 'Child',
      parentId: FOLDER_ID,
    });
    for (let depth = 0; depth <= MAX_FOLDER_DEPTH; depth += 1) {
      fakeDb().seed('folder', {
        id: `deep-${depth}`,
        userId: OWNER_ID,
        name: `Deep ${depth}`,
        parentId: depth === 0 ? 'child' : `deep-${depth - 1}`,
      });
    }

    const response = await del(app, `/api/folders/${FOLDER_ID}`, OWNER_ID);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'FOLDER_HIERARCHY_TOO_DEEP',
      // The route overrides `sendServiceError`'s default message with a
      // folder-specific one, so the wire text is this, not the table's.
      message: 'Folder hierarchy is too deep to delete safely',
      statusCode: 409,
    });
    // Nothing was deleted on the way out.
    expect(rowOf(FOLDER_ID)).toBeDefined();
    expect(fakeDb().rows('file')).toHaveLength(0);
  });

  it('answers 500 when the service throws', async () => {
    const transaction = vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('db down'));

    const response = await del(app, `/api/folders/${FOLDER_ID}`, OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to delete folder');
    transaction.mockRestore();
  });
});
