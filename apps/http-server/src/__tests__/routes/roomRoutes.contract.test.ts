/**
 * THE HTTP + AUTHORISATION CONTRACT OF THE ROOM API.
 *
 * `roomRoutes.ts` is the widest surface in this server -- nine routes, five of them
 * mutating -- and until now it was the least covered file in it. What makes it worth
 * testing is not its status codes but two things it has to get right:
 *
 *  1. **Ownership.** Every membership mutation is gated on `ownerId`. The queries
 *     live in `roomService`, and `fakeDb` evaluates the `where` clause they build,
 *     so a query that stops carrying the caller's id returns nothing here rather
 *     than passing because a stub answered what the test wanted.
 *  2. **The existence oracle.** A route that answers 403 for "not yours" and 404 for
 *     "does not exist" lets an unauthenticated-to-the-resource stranger enumerate
 *     slugs. `DELETE /:slug`, `POST /:slug/members` and `DELETE /:slug/members/:id`
 *     all fold ownership into the lookup and therefore cannot tell the two apart;
 *     those cases are asserted as byte-identical responses.
 *
 * Mounted exactly as `app.ts` mounts it -- CSRF, no outer `authMiddleware`, because
 * `roomRoutes` brings its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dripl/db', async () => {
  const { fakeDbModule } = await import('../test-utils/fakeDbModule');
  return fakeDbModule();
});

import { MAX_FILE_CONTENT_BYTES } from '@dripl/common';
import roomRoutes from '../../routes/roomRoutes';
import { RoomService, MAX_ROOMS_PER_DAY } from '../../services/roomService';
import {
  buildApp,
  del,
  get,
  OWNER_ID,
  OUTSIDER_ID,
  post,
  put,
  seedSessionUser,
} from '../test-utils/authenticatedRequest';
import { fakeDb, resetFakeDb } from '../test-utils/fakePrisma';

const app = buildApp([{ path: '/api/rooms', router: roomRoutes, auth: false }]);

const OWNER_ROOM = 'owner-room';
const OUTSIDER_ROOM = 'outsider-room';
/** A third principal: authenticated, but holding nothing and a member of nothing. */
const STRANGER_ID = 'user-stranger';

function seedUser(id: string): void {
  seedSessionUser(id);
}

function seedRoom(id: string, ownerId: string, overrides: Record<string, unknown> = {}): void {
  fakeDb().seed('canvasRoom', {
    id,
    slug: id,
    name: id,
    ownerId,
    content: '[]',
    isPublic: false,
    // `createRoom`'s quota window is `createdAt >= now - 24h`, so the default
    // fixture epoch would sit outside it and a seeded room would not count
    // toward the quota these tests are about.
    createdAt: new Date(),
    ...overrides,
  });
}

function seedMember(roomId: string, userId: string, role = 'EDITOR'): void {
  fakeDb().seed('canvasRoomMember', { id: `m-${roomId}-${userId}`, roomId, userId, role });
}

function rows(table: string): Array<Record<string, unknown>> {
  return fakeDb().rows(table);
}

function rowOf(table: string, id: string): Record<string, unknown> | undefined {
  return rows(table).find(row => row.id === id);
}

/**
 * One owner room with one member who is not the owner, plus a stranger's room.
 *
 * Both principals need a `User` row: `authMiddleware` resolves the token's stored
 * generation, and a token with no row is refused before any of this runs.
 */
function seed(): void {
  resetFakeDb();
  seedUser(OWNER_ID);
  seedUser(OUTSIDER_ID);
  seedUser(STRANGER_ID);
  seedRoom(OWNER_ROOM, OWNER_ID);
  seedRoom(OUTSIDER_ROOM, OUTSIDER_ID, { isPublic: false });
  seedMember(OWNER_ROOM, OUTSIDER_ID);
}

/**
 * A scene serialising to exactly `target` UTF-8 bytes.
 *
 * The room routes check size before they check semantics, so the boundary case
 * ("exactly at the cap") can only be proven with a payload that would otherwise
 * pass, which means a *valid* scene at exactly 2,000,000 bytes. Built
 * arithmetically rather than by search, because the search version would
 * serialise 2 MB ten thousand times.
 *
 * Every element carries the same text except the last few, which absorb the
 * overshoot; the `expect` inside is a guard on this arithmetic, not on the route.
 */
function sceneOfExactlyBytes(target: number): string {
  const TEXT = 9_000;
  const element = (index: number, textLength: number): Record<string, unknown> => ({
    id: String(index).padStart(4, '0'),
    type: 'text',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    text: 'x'.repeat(textLength),
  });
  const overhead = Buffer.byteLength(JSON.stringify([element(0, 0)]), 'utf8') - 2;
  const unit = overhead + TEXT + 1;
  const count = Math.ceil((target - 1) / unit);
  const texts = Array.from({ length: count }, () => TEXT);
  let overshoot = 1 + count * unit - target;
  for (let index = count - 1; index >= 0 && overshoot > 0; index -= 1) {
    const take = Math.min(TEXT, overshoot);
    texts[index] = TEXT - take;
    overshoot -= take;
  }
  const serialised = JSON.stringify(texts.map((text, index) => element(index, text)));
  expect(Buffer.byteLength(serialised, 'utf8')).toBe(target);
  return serialised;
}

describe('GET /api/rooms', () => {
  beforeEach(seed);

  // Regression: `listRooms` dropping `userId` from its `where` would answer 200
  // with another principal's rooms. The fake evaluates the clause, so this fails.
  it('lists the rooms the caller owns and the rooms it is a member of, and nobody else’s', async () => {
    const response = await get(app, '/api/rooms', OUTSIDER_ID);

    expect(response.status).toBe(200);
    expect(response.body.rooms.map((room: { slug: string }) => room.slug)).toEqual([
      // `OUTSIDER_ID` owns `outsider-room` and is a member of `owner-room`.
      OWNER_ROOM,
      OUTSIDER_ROOM,
    ]);
    // The membership is what admits a non-owner, and the projection carries no
    // scene: a list response that leaked `content` would hand out rooms wholesale.
    expect(Object.keys(response.body.rooms[0]).sort()).toEqual([
      'createdAt',
      'id',
      'isPublic',
      'name',
      'ownerId',
      'slug',
      'updatedAt',
    ]);
  });

  it('answers 500 rather than a partial list when the query throws', async () => {
    const boom = vi.spyOn(RoomService, 'listRooms').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/rooms', OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
      statusCode: 500,
    });
    boom.mockRestore();
  });
});

describe('GET /api/rooms/shared', () => {
  beforeEach(seed);

  it('answers with the caller’s memberships only', async () => {
    const response = await get(app, '/api/rooms/shared', OUTSIDER_ID);

    expect(response.status).toBe(200);
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0].room.slug).toBe(OWNER_ROOM);
    // Regression: the membership query losing `userId` returns every membership
    // in the table, which is a directory of who collaborates on what.
    expect(response.body.rooms.map((entry: { userId: string }) => entry.userId)).toEqual([
      OUTSIDER_ID,
    ]);
  });

  it('answers 500 when the query throws', async () => {
    const boom = vi
      .spyOn(RoomService, 'listSharedRooms')
      .mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/rooms/shared', OWNER_ID);

    expect(response.status).toBe(500);
    boom.mockRestore();
  });
});

describe('POST /api/rooms', () => {
  beforeEach(seed);

  it('creates a room owned by the caller and answers 201', async () => {
    const response = await post(app, '/api/rooms', OWNER_ID, { name: 'Sketch' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('room created');
    expect(response.body.room).toMatchObject({
      name: 'Sketch',
      ownerId: OWNER_ID,
      isPublic: false,
    });
  });

  /**
   * The quota boundary, both sides of it.
   *
   * The service refuses at `count >= MAX_ROOMS_PER_DAY`, so `limit - 1` must be
   * allowed and `limit` must not. Asserting only the refusal would pass for a
   * limit of `MAX_ROOMS_PER_DAY - 1` as well, i.e. for an off-by-one that costs a
   * user a room per day.
   */
  it('allows the last free room of the day and refuses the one past the cap', async () => {
    // `seed()` already gave OWNER_ID one room, so this tops the account up to
    // exactly `MAX_ROOMS_PER_DAY - 1` before the request under test.
    for (let index = 0; index < MAX_ROOMS_PER_DAY - 2; index += 1) {
      seedRoom(`filler-${index}`, OWNER_ID);
    }

    const allowed = await post(app, '/api/rooms', OWNER_ID, { name: 'Last free one' });
    expect(allowed.status).toBe(201);

    // The fake stamps rows it creates with a fixed epoch (see `fakePrisma`'s
    // `EPOCH`), which is months behind wall time, so a room created one line
    // above falls *outside* the rolling 24h window the quota counts. Re-stamped
    // into the window so the second request is refused for the reason under test
    // -- the count reaching the cap -- and not because the harness's clock is
    // stale. Without this the boundary case would pass for the wrong reason.
    const created = rows('canvasRoom').find(row => row.name === 'Last free one');
    expect(created).toBeDefined();
    if (created) fakeDb().seed('canvasRoom', { ...created, createdAt: new Date() });

    const refused = await post(app, '/api/rooms', OWNER_ID, { name: 'One too many' });
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({
      error: 'RATE_LIMITED',
      message: 'Room creation limit reached. You can create up to 10 rooms per day.',
      statusCode: 429,
    });
    // Refused means refused: no row was written behind the 429.
    expect(rowOf('canvasRoom', refused.body.room?.id)).toBeUndefined();
    expect(rows('canvasRoom').filter(row => row.name === 'One too many')).toEqual([]);
  });

  it('does not count another principal’s rooms against the quota', async () => {
    for (let index = 0; index < MAX_ROOMS_PER_DAY; index += 1) {
      seedRoom(`theirs-${index}`, OUTSIDER_ID);
    }

    const response = await post(app, '/api/rooms', OWNER_ID, { name: 'Mine' });

    expect(response.status).toBe(201);
  });

  it('answers 400 INVALID_PAYLOAD for a body the schema rejects', async () => {
    const response = await post(app, '/api/rooms', OWNER_ID, { name: 'x'.repeat(201) });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.message).toBe('Invalid payload');
    expect(rows('canvasRoom')).toHaveLength(2);
  });

  it('answers 400 for a scene that is syntactically JSON but not a scene', async () => {
    const response = await post(app, '/api/rooms', OWNER_ID, {
      content: JSON.stringify([{ nothing: 'useful' }]),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(rows('canvasRoom')).toHaveLength(2);
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'createRoom').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, '/api/rooms', OWNER_ID, { name: 'Sketch' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    boom.mockRestore();
  });
});

describe('POST /api/rooms — the 2 MB content boundary', () => {
  beforeEach(seed);

  /**
   * `rejectOversizedContent` answers 413 *before* Zod runs, and the schema then
   * answers 400 for a scene it does not like. Swapping the two would turn a
   * size rejection into a schema rejection for every oversized body, and the
   * client could no longer tell "too big to store" from "malformed".
   */
  it('accepts a valid scene at exactly the byte cap and refuses one byte more', async () => {
    const atCap = await post(app, '/api/rooms', OWNER_ID, {
      content: sceneOfExactlyBytes(MAX_FILE_CONTENT_BYTES),
    });
    expect(atCap.status).toBe(201);

    const overCap = await post(app, '/api/rooms', OWNER_ID, {
      content: 'x'.repeat(MAX_FILE_CONTENT_BYTES + 1),
    });
    expect(overCap.status).toBe(413);
    expect(overCap.body).toEqual({
      error: 'PAYLOAD_TOO_LARGE',
      message: `Room content too large (${MAX_FILE_CONTENT_BYTES + 1} bytes, max ${MAX_FILE_CONTENT_BYTES})`,
      statusCode: 413,
    });
  });

  it('measures a multibyte scene in UTF-8 bytes, not UTF-16 units', async () => {
    // 'é' is one UTF-16 unit and two UTF-8 bytes, so a string of them is
    // comfortably inside a `.max()` unit check and twice as large in bytes.
    const overBytes = 'é'.repeat(MAX_FILE_CONTENT_BYTES - 1);
    expect(overBytes.length).toBeLessThan(MAX_FILE_CONTENT_BYTES);

    const response = await post(app, '/api/rooms', OWNER_ID, { content: overBytes });

    expect(response.status).toBe(413);
  });
});

describe('GET /api/rooms/:slug', () => {
  beforeEach(seed);

  it('admits the owner, and maps member roles to the wire vocabulary', async () => {
    const response = await get(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body.room.slug).toBe(OWNER_ROOM);
    expect(response.body.room.members.map((m: { role: string }) => m.role)).toEqual(['edit']);
  });

  // Regression: `getRoom` dropping the `members.some(userId)` check would answer
  // 404 to a legitimate collaborator on a private room.
  it('admits a member of a private room', async () => {
    const response = await get(app, `/api/rooms/${OWNER_ROOM}`, OUTSIDER_ID);

    expect(response.status).toBe(200);
    expect(response.body.room.slug).toBe(OWNER_ROOM);
  });

  it('refuses a stranger on a private room and answers 404 for a slug that does not exist', async () => {
    const stranger = await get(app, `/api/rooms/${OWNER_ROOM}`, STRANGER_ID);
    const missing = await get(app, '/api/rooms/no-such-room', STRANGER_ID);

    expect(stranger.status).toBe(403);
    expect(stranger.body).toEqual({
      error: 'FORBIDDEN',
      message: 'Access denied',
      statusCode: 403,
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Room not found',
      statusCode: 404,
    });
  });

  it('admits anyone to a public room', async () => {
    seedRoom('open-room', OWNER_ID, { isPublic: true });

    const response = await get(app, '/api/rooms/open-room', STRANGER_ID);

    expect(response.status).toBe(200);
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'getRoom').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    boom.mockRestore();
  });
});

describe('PUT /api/rooms/:slug', () => {
  beforeEach(seed);

  it('renames a room the caller owns', async () => {
    const response = await put(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID, { name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'room updated' });
    expect(rowOf('canvasRoom', OWNER_ROOM)?.name).toBe('Renamed');
  });

  /**
   * The optimistic-concurrency fence. Two collaborators saving the same room
   * race, and the loser must be told rather than silently overwriting the
   * winner's scene: `updateRoom` matches on `updatedAt` and answers `conflict`
   * when nothing matched.
   */
  it('answers 409 when the caller’s expectedUpdatedAt is stale, and writes nothing', async () => {
    const response = await put(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID, {
      name: 'Based on stale state',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'CONFLICT',
      message: 'Room changed while saving',
      statusCode: 409,
    });
    expect(rowOf('canvasRoom', OWNER_ROOM)?.name).toBe(OWNER_ROOM);
  });

  it('answers 400 INVALID_PAYLOAD for a body the schema rejects', async () => {
    const response = await put(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID, { name: '' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid update payload');
    expect(rowOf('canvasRoom', OWNER_ROOM)?.name).toBe(OWNER_ROOM);
  });

  it('answers 413 before the schema for oversized content', async () => {
    const response = await put(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID, {
      name: 'Renamed',
      content: 'x'.repeat(MAX_FILE_CONTENT_BYTES + 1),
    });

    expect(response.status).toBe(413);
    // The size check ran first, so the name never reached the service.
    expect(rowOf('canvasRoom', OWNER_ROOM)?.name).toBe(OWNER_ROOM);
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'updateRoom').mockRejectedValueOnce(new Error('db down'));

    const response = await put(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID, { name: 'Renamed' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    boom.mockRestore();
  });
});

describe('DELETE /api/rooms/:slug', () => {
  beforeEach(seed);

  it('deletes a room the caller owns, along with its membership rows', async () => {
    const response = await del(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'room deleted' });
    expect(rowOf('canvasRoom', OWNER_ROOM)).toBeUndefined();
    // Regression: dropping the `canvasRoomMember.deleteMany` leaves membership rows
    // pointing at a room that no longer exists, which `listRooms` would keep
    // matching through the `members: { some: { userId } }` clause.
    expect(rows('canvasRoomMember')).toEqual([]);
  });

  /**
   * No existence oracle on a delete.
   *
   * `deleteRoom` looks the room up by `{ slug, ownerId }`, so "not yours" and
   * "not there" produce the same empty result and therefore the same answer. The
   * assertion is byte equality, not just the status: a message that named the
   * owner's situation ("you do not have permission") would restore the oracle
   * while the status stayed 404.
   */
  it('answers identically for a room the caller does not own and for one that does not exist', async () => {
    const notMine = await del(app, `/api/rooms/${OWNER_ROOM}`, OUTSIDER_ID);
    const missing = await del(app, '/api/rooms/no-such-room', OUTSIDER_ID);

    expect(notMine.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(notMine.body).toEqual(missing.body);
    expect(notMine.body.message).toBe('Room not found or you do not have permission');
    // Neither attempt touched anything.
    expect(rowOf('canvasRoom', OWNER_ROOM)).toBeDefined();
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'deleteRoom').mockRejectedValueOnce(new Error('db down'));

    const response = await del(app, `/api/rooms/${OWNER_ROOM}`, OWNER_ID);

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    boom.mockRestore();
  });
});

describe('POST /api/rooms/:slug/members', () => {
  beforeEach(seed);

  // Regression: `addMember` looking the room up by `slug` alone would hand
  // membership of somebody else's room to any authenticated caller.
  it('answers identically for a room the caller does not own and for one that does not exist', async () => {
    const notMine = await post(app, `/api/rooms/${OWNER_ROOM}/members`, OUTSIDER_ID, {
      userId: 'user-recruit',
    });
    const missing = await post(app, '/api/rooms/no-such-room/members', OUTSIDER_ID, {
      userId: 'user-recruit',
    });

    expect(notMine.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(notMine.body).toEqual(missing.body);
    expect(rows('canvasRoomMember')).toHaveLength(1);
  });

  it('answers 409 for a user who is already a member, without a second row', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/members`, OWNER_ID, {
      userId: OUTSIDER_ID,
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'CONFLICT',
      message: 'User is already a member of this room',
      statusCode: 409,
    });
    expect(rows('canvasRoomMember')).toHaveLength(1);
  });

  it('answers 400 for a member id the schema rejects', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/members`, OWNER_ID, { userId: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(rows('canvasRoomMember')).toHaveLength(1);
  });

  it('adds a member with a role the wire vocabulary accepts', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/members`, OWNER_ID, {
      userId: 'user-recruit',
      role: 'view',
    });

    expect(response.status).toBe(201);
    expect(response.body.member).toMatchObject({ userId: 'user-recruit', role: 'view' });
    // The wire answer is lowercase; the row keeps the DB enum. Asserted on the
    // stored row rather than the response, because the response alone cannot tell
    // a stored `VIEWER` from a response-layer rename.
    expect(rows('canvasRoomMember').find(row => row.userId === 'user-recruit')).toMatchObject({
      roomId: OWNER_ROOM,
      role: 'VIEWER',
    });
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'addMember').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, `/api/rooms/${OWNER_ROOM}/members`, OWNER_ID, {
      userId: 'user-recruit',
    });

    expect(response.status).toBe(500);
    boom.mockRestore();
  });
});

describe('DELETE /api/rooms/:slug/members/:userId', () => {
  beforeEach(seed);

  it('removes a member and leaves the room and the other members alone', async () => {
    const response = await del(app, `/api/rooms/${OWNER_ROOM}/members/${OUTSIDER_ID}`, OWNER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'member removed' });
    expect(rows('canvasRoomMember')).toEqual([]);
    expect(rowOf('canvasRoom', OWNER_ROOM)).toBeDefined();
  });

  /**
   * An owner removing themselves is refused, because the room has one owner and
   * no way to transfer it. Allowing it would leave a room with no owner: `getRoom`
   * admits nobody, `updateRoom` and `deleteRoom` admit nobody, and the room is
   * unreachable forever with no error anywhere.
   */
  it('refuses to let the owner remove themselves', async () => {
    const response = await del(app, `/api/rooms/${OWNER_ROOM}/members/${OWNER_ID}`, OWNER_ID);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'INVALID_PAYLOAD',
      message: 'Owner cannot remove themselves from the room',
      statusCode: 400,
    });
    expect(rowOf('canvasRoom', OWNER_ROOM)).toBeDefined();
  });

  it('answers identically for a room the caller does not own and for one that does not exist', async () => {
    const notMine = await del(app, `/api/rooms/${OWNER_ROOM}/members/${OWNER_ID}`, OUTSIDER_ID);
    const missing = await del(app, '/api/rooms/no-such-room/members/whoever', OUTSIDER_ID);

    expect(notMine.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(notMine.body).toEqual(missing.body);
    expect(rows('canvasRoomMember')).toHaveLength(1);
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'removeMember').mockRejectedValueOnce(new Error('db down'));

    const response = await del(app, `/api/rooms/${OWNER_ROOM}/members/${OUTSIDER_ID}`, OWNER_ID);

    expect(response.status).toBe(500);
    boom.mockRestore();
  });
});

describe('POST /api/rooms/:slug/share', () => {
  beforeEach(seed);

  it('issues a share link for a room the caller owns', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'edit',
      expiresIn: 48,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'share link created', permission: 'EDIT' });
    expect(response.body.token).toEqual(expect.any(String));
    // The URL is what the client navigates to; a wrong host sends a shared canvas
    // to a page that does not exist.
    expect(response.body.url).toBe(
      `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/board/${response.body.token}`
    );
  });

  it('stores the permission the caller asked for, not the default', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'view',
      expiresIn: 1,
    });

    expect(response.status).toBe(201);
    const link = rows('shareLink').find(row => row.token === response.body.token);
    expect(link).toMatchObject({ roomId: OWNER_ROOM, permission: 'VIEW', createdById: OWNER_ID });
  });

  // Regression: `shareRoom` dropping its ownerId check would hand out a public
  // capability URL for somebody else's canvas, which needs no credential to read.
  it('refuses to share a room the caller does not own', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OUTSIDER_ID, {
      permission: 'view',
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'FORBIDDEN',
      message: 'Only the owner can share this room',
      statusCode: 403,
    });
    expect(rows('shareLink')).toEqual([]);
  });

  it('answers 404 for a room that does not exist', async () => {
    const response = await post(app, '/api/rooms/no-such-room/share', OWNER_ID, {
      permission: 'view',
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Room not found');
  });

  // The expiry ceiling is the difference between "a link somebody can hand on"
  // and "a permanent unauthenticated read of the canvas". Asserted at both edges
  // of the schema, because `max(720)` is the only thing holding it.
  it('bounds the share expiry at both edges of the schema', async () => {
    const tooLong = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'view',
      expiresIn: 721,
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe('INVALID_PAYLOAD');

    const zero = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'view',
      expiresIn: 0,
    });
    expect(zero.status).toBe(400);

    const atCeiling = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'view',
      expiresIn: 720,
    });
    expect(atCeiling.status).toBe(201);
  });

  it('rejects a permission outside view/edit rather than defaulting it', async () => {
    const response = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'admin',
    });

    expect(response.status).toBe(400);
    expect(rows('shareLink')).toEqual([]);
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'shareRoom').mockRejectedValueOnce(new Error('db down'));

    const response = await post(app, `/api/rooms/${OWNER_ROOM}/share`, OWNER_ID, {
      permission: 'view',
    });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    boom.mockRestore();
  });
});

describe('GET /api/rooms/share/:token', () => {
  beforeEach(seed);

  it('serves the capability link without a session and marks it uncacheable', async () => {
    fakeDb().seed('shareLink', {
      id: 'link-1',
      token: 'tok-1',
      roomId: OWNER_ROOM,
      permission: 'VIEW',
      expiresAt: new Date(Date.now() + 60_000),
      createdById: OWNER_ID,
    });

    const response = await get(app, '/api/rooms/share/tok-1');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ permission: 'VIEW' });
    // The scene is parsed on the way out and re-serialised, so a malformed
    // `content` column cannot hand a capability-link reader a payload the client
    // cannot load. `'[]'` is a valid scene, so it round-trips as `'[]'`.
    expect(JSON.parse(response.body.room.content)).toEqual([]);
  });

  it('answers 404 for an unknown token and 410 for an expired one', async () => {
    const unknown = await get(app, '/api/rooms/share/nope');
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('Share link not found');

    fakeDb().seed('shareLink', {
      id: 'link-2',
      token: 'tok-2',
      roomId: OWNER_ROOM,
      permission: 'VIEW',
      expiresAt: new Date(Date.now() - 1_000),
      createdById: OWNER_ID,
    });
    const expired = await get(app, '/api/rooms/share/tok-2');
    expect(expired.status).toBe(410);
    expect(expired.body.message).toBe('Share link has expired');
  });

  it('answers 500 when the service throws', async () => {
    const boom = vi.spyOn(RoomService, 'getShareLink').mockRejectedValueOnce(new Error('db down'));

    const response = await get(app, '/api/rooms/share/tok-1');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Internal server error');
    boom.mockRestore();
  });
});
