/**
 * THE AUTHORISATION BOUNDARY OF THE FILE API.
 *
 * Every case here is written as a pair: a principal, a resource that belongs to
 * the *other* principal, and the answer that must come back. The resource pairs
 * are named in the test titles because "the 404 test" is not reviewable later;
 * "outsider reading owner's file" is.
 *
 * The fake database evaluates the `where` clause the service builds, so these
 * assertions are about the query that actually ran, not about a stub's canned
 * answer. See `test-utils/fakePrisma.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  // Dynamic import inside the factory: `vi.mock` is hoisted above the file's own
  // imports, so a top-level binding is not in scope yet. The factory and the test
  // share `fakeDb`'s singleton, which is what keeps the seeded rows and the code
  // under test looking at the same store -- and the production revocation
  // functions, bound to that same store.
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

import { db } from '@dripl/db';
import { filesRouter } from '../../routes/files';
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
  seedSessionUser,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const app = buildApp([{ path: '/api/files', router: filesRouter }]);
/**
 * The bare router, so the route's own `if (!req.userId)` guard is observable.
 * Without `auth: false` this app would answer 401 from the middleware and the
 * handler's guard line would never execute.
 */
const unguardedApp = buildApp([{ path: '/api/files', router: filesRouter }], {
  csrf: false,
  auth: false,
});

const OWNER_FILE = 'file-owner-1';
const OUTSIDER_FILE = 'file-outsider-1';
const OWNER_FOLDER = 'folder-owner-1';
const OUTSIDER_FOLDER = 'folder-outsider-1';

const OWNER_TOKEN = 'owner-share-token';
const STORED_CONTENT = JSON.stringify([
  { id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
]);

function seedTwoUsers(): void {
  resetFakeDb();
  // `authMiddleware` refuses a token whose subject has no stored generation, so
  // both principals need a `User` row for these cases to reach the routes at all.
  seedSessionUser(OWNER_ID);
  seedSessionUser(OUTSIDER_ID);
  fakeDb().seed('file', {
    id: OWNER_FILE,
    userId: OWNER_ID,
    name: 'Owner canvas',
    content: STORED_CONTENT,
    folderId: OWNER_FOLDER,
    preview: null,
    shareToken: OWNER_TOKEN,
    sharePermission: 'view',
    shareExpiresAt: null,
  });
  fakeDb().seed('file', {
    id: OUTSIDER_FILE,
    userId: OUTSIDER_ID,
    name: 'Outsider canvas',
    content: '[]',
    folderId: OUTSIDER_FOLDER,
    preview: null,
    shareToken: null,
    sharePermission: null,
    shareExpiresAt: null,
  });
  fakeDb().seed('folder', {
    id: OWNER_FOLDER,
    userId: OWNER_ID,
    name: 'Owner folder',
    parentId: null,
  });
  fakeDb().seed('folder', {
    id: OUTSIDER_FOLDER,
    userId: OUTSIDER_ID,
    name: 'Outsider folder',
    parentId: null,
  });
}

/** Every write the fake database accepted, oldest first. */
function rowOf(table: string, id: string): Record<string, unknown> | undefined {
  return fakeDb()
    .rows(table)
    .find(row => row.id === id);
}

describe('files authorisation — outsider against owner resources', () => {
  beforeEach(seedTwoUsers);

  it('GET /api/files/:id — outsider cannot read the owner file', async () => {
    const response = await get(app, `/api/files/${OWNER_FILE}`, OUTSIDER_ID);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'File not found',
      statusCode: 404,
    });
    // The owner's scene must not appear anywhere in the response.
    expect(JSON.stringify(response.body)).not.toContain('el-1');
    expect(JSON.stringify(response.body)).not.toContain('Owner canvas');
  });

  it('GET /api/files — a list request never reaches another principal rows', async () => {
    const response = await get(app, '/api/files', OUTSIDER_ID);

    expect(response.status).toBe(200);
    expect(response.body.files.map((file: { id: string }) => file.id)).toEqual([OUTSIDER_FILE]);
    expect(response.body.total).toBe(1);
  });

  it('GET /api/files?folderId=<owner folder> — the outsider folder filter leaks nothing', async () => {
    const response = await get(
      app,
      `/api/files?folderId=${encodeURIComponent(OWNER_FOLDER)}`,
      OUTSIDER_ID
    );

    expect(response.status).toBe(200);
    expect(response.body.files).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it('PATCH /api/files/:id — outsider cannot rename the owner file', async () => {
    const response = await patch(app, `/api/files/${OWNER_FILE}`, OUTSIDER_ID, {
      name: 'hijacked',
    });

    expect(response.status).toBe(404);
    expect(rowOf('file', OWNER_FILE)?.name).toBe('Owner canvas');
  });

  it('PATCH /api/files/:id — outsider cannot overwrite the owner scene', async () => {
    const response = await patch(app, `/api/files/${OWNER_FILE}`, OUTSIDER_ID, {
      content: [{ id: 'evil', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }],
    });

    expect(response.status).toBe(404);
    expect(String(rowOf('file', OWNER_FILE)?.content)).toBe(STORED_CONTENT);
  });

  it('DELETE /api/files/:id — outsider cannot delete the owner file', async () => {
    const response = await del(app, `/api/files/${OWNER_FILE}`, OUTSIDER_ID);

    expect(response.status).toBe(404);
    expect(rowOf('file', OWNER_FILE)).toBeDefined();
  });

  it('POST /api/files/:id/share — outsider cannot share the owner file', async () => {
    const response = await post(app, `/api/files/${OWNER_FILE}/share`, OUTSIDER_ID, {
      permission: 'view',
    });

    expect(response.status).toBe(404);
    // The owner's existing share state is untouched: a denied attempt must not
    // rotate or clear someone else's token.
    expect(rowOf('file', OWNER_FILE)?.shareToken).toBe(OWNER_TOKEN);
    expect(rowOf('file', OWNER_FILE)?.sharePermission).toBe('view');
  });

  it('DELETE /api/files/:id/share — outsider cannot revoke the owner share link', async () => {
    const response = await del(app, `/api/files/${OWNER_FILE}/share`, OUTSIDER_ID);

    expect(response.status).toBe(404);
    expect(rowOf('file', OWNER_FILE)?.shareToken).toBe(OWNER_TOKEN);
  });

  it('POST /api/files — outsider cannot create a file inside the owner folder', async () => {
    const response = await post(app, '/api/files', OUTSIDER_ID, {
      name: 'planted',
      folderId: OWNER_FOLDER,
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Folder not found',
      statusCode: 404,
    });
    expect(
      fakeDb()
        .rows('file')
        .some(row => row.name === 'planted')
    ).toBe(false);
  });

  it('PATCH /api/files/:id — the owner cannot move their file into the outsider folder', async () => {
    // The mirror image of the previous case, and the one a real hierarchy bug
    // produces: ownership of the FILE is not ownership of the FOLDER it is
    // being moved into.
    const response = await patch(app, `/api/files/${OWNER_FILE}`, OWNER_ID, {
      folderId: OUTSIDER_FOLDER,
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Folder not found');
    expect(rowOf('file', OWNER_FILE)?.folderId).toBe(OWNER_FOLDER);
  });

  it('POST /api/files — the owner can create inside their own folder', async () => {
    // The control for the two cases above. Without it, "404 for every folderId"
    // would satisfy the suite while file creation was simply broken.
    const response = await post(app, '/api/files', OWNER_ID, {
      name: 'legitimate',
      folderId: OWNER_FOLDER,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'legitimate',
    });
    expect(rowOf('file', response.body.id)?.userId).toBe(OWNER_ID);
    expect(rowOf('file', response.body.id)?.folderId).toBe(OWNER_FOLDER);
  });
});

describe('files authorisation — the query itself is scoped', () => {
  beforeEach(seedTwoUsers);

  it('scopes every per-file lookup to the caller, not just the row it returns', async () => {
    const findFirst = vi.spyOn(db.file, 'findFirst');

    await get(app, `/api/files/${OWNER_FILE}`, OUTSIDER_ID);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OWNER_FILE, userId: OUTSIDER_ID } })
    );
    findFirst.mockRestore();
  });

  it('scopes the list query to the caller', async () => {
    const findMany = vi.spyOn(db.file, 'findMany');

    await get(app, '/api/files', OUTSIDER_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: OUTSIDER_ID }) })
    );
    findMany.mockRestore();
  });

  it('scopes the folder ownership probe to the caller', async () => {
    const findFolder = vi.spyOn(db.folder, 'findFirst');

    await post(app, '/api/files', OUTSIDER_ID, { name: 'x', folderId: OWNER_FOLDER });

    expect(findFolder).toHaveBeenCalledWith({
      where: { id: OWNER_FOLDER, userId: OUTSIDER_ID },
      select: { id: true },
    });
    findFolder.mockRestore();
  });
});

describe('files authorisation — credential rejection', () => {
  beforeEach(seedTwoUsers);

  for (const credentials of malformedCredentials()) {
    it(`rejects ${credentials.label} on GET /api/files/:id`, async () => {
      const response = await raw('get', app, `/api/files/${OWNER_FILE}`, credentials);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });
  }

  it('rejects an unsigned token on a mutation', async () => {
    const response = await raw('delete', app, `/api/files/${OWNER_FILE}`, {
      header: 'Bearer aaa.bbb.ccc',
    });

    expect(response.status).toBe(401);
    expect(rowOf('file', OWNER_FILE)).toBeDefined();
  });

  it('the route carries its own guard, independent of the mount', async () => {
    // `app.ts` mounts `authMiddleware` in front of the router. The router also
    // checks `req.userId` itself; this asserts that second line is real by
    // mounting the router with nothing in front of it.
    const response = await get(unguardedApp, `/api/files/${OWNER_FILE}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      statusCode: 401,
    });
  });

  it('a valid token for the wrong resource answers 404, never 200 or 403', async () => {
    // The distinction matters: 403 would confirm the file exists, which is
    // itself a disclosure. This file API answers 404 for both "missing" and
    // "not yours".
    const asOutsider = await get(app, `/api/files/${OWNER_FILE}`, OUTSIDER_ID);
    const asOwner = await get(app, `/api/files/${OWNER_FILE}`, OWNER_ID);
    const missing = await get(app, '/api/files/file-does-not-exist', OUTSIDER_ID);

    expect(asOwner.status).toBe(200);
    expect(asOutsider.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(asOutsider.body).toEqual(missing.body);
  });
});
