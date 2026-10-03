/**
 * THE AUTHORISATION BOUNDARY OF THE FOLDER API, and the folder/file pair.
 *
 * `folders.ts` is where a hierarchy bug becomes a data-loss bug: the cascade
 * delete walks a tree and then deletes files. So these cases are written
 * against two principals with interleaved trees, not one user with a typo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDb } = await import('../test-utils/fakePrisma');
  return { db: fakeDb().db, initializeDb: vi.fn(async () => {}) };
});

import { db } from '@dripl/db';
import { foldersRouter } from '../../routes/folders';
import {
  buildApp,
  del,
  get,
  malformedCredentials,
  OWNER_ID,
  OUTSIDER_ID,
  patch,
  post,
  raw,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const app = buildApp([{ path: '/api/folders', router: foldersRouter }]);
const unguardedApp = buildApp([{ path: '/api/folders', router: foldersRouter }], {
  csrf: false,
  auth: false,
});

/**
 * Two trees that share a shape:
 *
 *   owner-root ── owner-child
 *   outsider-root ── outsider-child
 *
 * A cascade that forgets to scope its child lookup by `userId` will descend
 * into `outsider-child` only if the ids line up, so the ids are deliberately
 * parallel and the test asserts on both trees afterwards.
 */
function seedTwoTrees(): void {
  resetFakeDb();
  fakeDb().seed('folder', {
    id: 'owner-root',
    userId: OWNER_ID,
    name: 'Owner root',
    parentId: null,
  });
  fakeDb().seed('folder', {
    id: 'owner-child',
    userId: OWNER_ID,
    name: 'Owner child',
    parentId: 'owner-root',
  });
  fakeDb().seed('folder', {
    id: 'outsider-root',
    userId: OUTSIDER_ID,
    name: 'Outsider root',
    parentId: null,
  });
  fakeDb().seed('folder', {
    id: 'outsider-child',
    userId: OUTSIDER_ID,
    name: 'Outsider child',
    parentId: 'outsider-root',
  });
  fakeDb().seed('file', {
    id: 'owner-file',
    userId: OWNER_ID,
    name: 'Owner file',
    content: '[]',
    folderId: 'owner-child',
    preview: null,
    shareToken: null,
    sharePermission: null,
    shareExpiresAt: null,
  });
  fakeDb().seed('file', {
    id: 'outsider-file',
    userId: OUTSIDER_ID,
    name: 'Outsider file',
    content: '[]',
    folderId: 'outsider-child',
    preview: null,
    shareToken: null,
    sharePermission: null,
    shareExpiresAt: null,
  });
}

function rowOf(table: string, id: string): Record<string, unknown> | undefined {
  return fakeDb()
    .rows(table)
    .find(row => row.id === id);
}

describe('folders authorisation — outsider against owner resources', () => {
  beforeEach(seedTwoTrees);

  it('GET /api/folders — a list request never reaches the other principal rows', async () => {
    const response = await get(app, '/api/folders', OUTSIDER_ID);

    expect(response.status).toBe(200);
    expect(response.body.folders.map((folder: { id: string }) => folder.id).sort()).toEqual([
      'outsider-child',
      'outsider-root',
    ]);
    // The per-folder file count must also be scoped, or it leaks the owner's
    // activity to anyone who can guess a folder id.
    const outsiderChild = response.body.folders.find(
      (folder: { id: string }) => folder.id === 'outsider-child'
    );
    expect(outsiderChild.fileCount).toBe(1);
  });

  it('PATCH /api/folders/:id — outsider cannot rename the owner folder', async () => {
    const response = await patch(app, '/api/folders/owner-root', OUTSIDER_ID, { name: 'hijacked' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Folder not found',
      statusCode: 404,
    });
    expect(rowOf('folder', 'owner-root')?.name).toBe('Owner root');
  });

  it('PATCH /api/folders/:id — outsider cannot re-parent the owner folder', async () => {
    const response = await patch(app, '/api/folders/owner-root', OUTSIDER_ID, {
      parentId: 'outsider-root',
    });

    expect(response.status).toBe(404);
    expect(rowOf('folder', 'owner-root')?.parentId).toBeNull();
  });

  it('DELETE /api/folders/:id — outsider cannot cascade-delete the owner tree', async () => {
    const response = await del(app, '/api/folders/owner-root', OUTSIDER_ID);

    expect(response.status).toBe(404);
    // Nothing on either tree moved. A delete that reached past the ownership
    // check would empty both.
    expect(rowOf('folder', 'owner-root')).toBeDefined();
    expect(rowOf('folder', 'owner-child')).toBeDefined();
    expect(rowOf('file', 'owner-file')).toBeDefined();
  });

  it('POST /api/folders — outsider cannot nest a folder inside the owner folder', async () => {
    const response = await post(app, '/api/folders', OUTSIDER_ID, {
      name: 'planted',
      parentId: 'owner-root',
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Parent folder not found',
      statusCode: 404,
    });
    expect(
      fakeDb()
        .rows('folder')
        .some(folder => folder.name === 'planted')
    ).toBe(false);
  });

  it('PATCH /api/folders/:id — the owner cannot re-parent into the outsider folder', async () => {
    // The mirror of the case above: ownership of the folder being moved is not
    // ownership of the destination.
    const response = await patch(app, '/api/folders/owner-root', OWNER_ID, {
      parentId: 'outsider-root',
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Parent folder not found');
    expect(rowOf('folder', 'owner-root')?.parentId).toBeNull();
  });

  it('the cascade delete leaves the other principal tree and files untouched', async () => {
    // The control: the owner CAN delete their tree, and doing so must remove
    // exactly their own subtree. Without this, "every delete 404s" would satisfy
    // the suite while the feature was simply broken.
    const response = await del(app, '/api/folders/owner-root', OWNER_ID);

    expect(response.status).toBe(204);
    expect(rowOf('folder', 'owner-root')).toBeUndefined();
    expect(rowOf('folder', 'owner-child')).toBeUndefined();
    expect(rowOf('file', 'owner-file')).toBeUndefined();

    expect(rowOf('folder', 'outsider-root')).toBeDefined();
    expect(rowOf('folder', 'outsider-child')).toBeDefined();
    expect(rowOf('file', 'outsider-file')).toBeDefined();
  });
});

describe('folders authorisation — the cascade queries are scoped', () => {
  beforeEach(seedTwoTrees);

  it('scopes the root ownership probe to the caller', async () => {
    const findFirst = vi.spyOn(db.folder, 'findFirst');

    await del(app, '/api/folders/owner-root', OUTSIDER_ID);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'owner-root', userId: OUTSIDER_ID } })
    );
    findFirst.mockRestore();
  });

  it('scopes the descendant walk to the caller', async () => {
    // `where.parentId.in` is where an unscoped cascade would widen into the
    // other user's tree. This asserts the userId rides along with it.
    const findMany = vi.spyOn(db.folder, 'findMany');

    await del(app, '/api/folders/owner-root', OWNER_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parentId: { in: ['owner-root'] }, userId: OWNER_ID }),
      })
    );
    findMany.mockRestore();
  });

  it('scopes the file delete inside the cascade to the caller', async () => {
    const deleteFiles = vi.spyOn(db.file, 'deleteMany');
    const deleteFolders = vi.spyOn(db.folder, 'deleteMany');

    await del(app, '/api/folders/owner-root', OWNER_ID);

    expect(deleteFiles).toHaveBeenCalledWith({
      where: { userId: OWNER_ID, folderId: { in: expect.arrayContaining(['owner-root']) } },
    });
    expect(deleteFolders).toHaveBeenCalledWith({
      where: {
        userId: OWNER_ID,
        id: { in: expect.arrayContaining(['owner-root', 'owner-child']) },
      },
    });
    deleteFiles.mockRestore();
    deleteFolders.mockRestore();
  });

  it('scopes the parent-ownership probe to the caller', async () => {
    const findFirst = vi.spyOn(db.folder, 'findFirst');

    await post(app, '/api/folders', OUTSIDER_ID, { name: 'x', parentId: 'owner-root' });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'owner-root', userId: OUTSIDER_ID },
      select: { id: true },
    });
    findFirst.mockRestore();
  });
});

describe('folders authorisation — credential rejection', () => {
  beforeEach(seedTwoTrees);

  for (const credentials of malformedCredentials()) {
    it(`rejects ${credentials.label} on DELETE /api/folders/:id`, async () => {
      const response = await raw('delete', app, '/api/folders/owner-root', credentials);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHORIZED');
      expect(rowOf('folder', 'owner-root')).toBeDefined();
    });
  }

  it('the route carries its own guard, independent of the mount', async () => {
    const response = await get(unguardedApp, '/api/folders');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      statusCode: 401,
    });
  });

  it('a valid token for the wrong folder answers 404, never 403', async () => {
    const asOutsider = await patch(app, '/api/folders/owner-root', OUTSIDER_ID, { name: 'x' });
    const missing = await patch(app, '/api/folders/folder-does-not-exist', OUTSIDER_ID, {
      name: 'x',
    });

    expect(asOutsider.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(asOutsider.body).toEqual(missing.body);
  });
});
