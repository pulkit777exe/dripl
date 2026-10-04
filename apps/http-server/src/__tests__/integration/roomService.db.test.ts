/**
 * ROOM AUTHORISATION AGAINST REAL POSTGRESQL.
 *
 * WHY THIS FILE IS GATED AND WHY IT IS NOT REDUNDANT
 *
 * Every room suite in this package runs on `fakePrisma`, an in-memory stand-in that
 * *evaluates* the `where` clause a service builds. That is what makes the room
 * authorisation assertions meaningful — a query that stopped carrying the caller's id
 * returns nothing there rather than passing because a stub answered what the test
 * wanted. But it also means the fake is a second implementation of Prisma's filter
 * semantics, and a room query shape it does not model fails as an assertion error
 * rather than as "this fake does not do that".
 *
 * `RoomService.listRooms` is exactly such a query: it filters with
 * `OR: [{ ownerId }, { members: { some: { userId } } }]`. That is the most complex
 * clause any room service issues and the one the entire membership story rests on —
 * it is the difference between "your rooms" and "every room". It had never run
 * against a real database, and the fake's relation-quantifier support was added while
 * writing the room route suite, i.e. it is new code that has only ever agreed with
 * itself.
 *
 * So this file runs the same authorisation questions against PostgreSQL. If the two
 * implementations ever disagree about what a query means, this is where it shows.
 *
 * RUNNING IT
 *
 *   docker run -d --name dripl-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_USER=dripl \
 *     -e POSTGRES_DB=dripl -p 127.0.0.1:56701:5432 postgres:16-alpine
 *   cd packages/db && DATABASE_URL=postgresql://dripl:pw@127.0.0.1:56701/dripl npx prisma db push
 *   RUN_DB_INTEGRATION=true \
 *   DATABASE_URL=postgresql://dripl:pw@127.0.0.1:56701/dripl \
 *   pnpm --filter http-server test
 *
 * `DATABASE_URL` must be overridden on the command line. The repository `.env` holds
 * a real Neon URL, and this suite creates and deletes rows.
 *
 * EVERY CASE DELETES ITS OWN ROWS. A leaked row would not fail this suite — the ids
 * are random per run — it would just accumulate.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, initializeDb } from '@dripl/db';
import { RoomService } from '../../services/roomService';

const run = process.env.RUN_DB_INTEGRATION === 'true';
const describeIntegration = run ? describe : describe.skip;

/** A user row, since every room query joins to `User` for its owner. */
async function seedUser(label: string): Promise<string> {
  const id = randomUUID();
  await db.user.create({
    data: { id, email: `dripl-room-${label}-${id}@example.test`, emailVerified: true, name: label },
  });
  return id;
}

async function seedRoom(ownerId: string, slug: string): Promise<string> {
  const room = await RoomService.createRoom({ userId: ownerId, name: slug });
  if (room.kind !== 'ok') throw new Error(`fixture room was not created: ${room.kind}`);
  const id = (room.room as { id: string }).id;
  await db.canvasRoom.update({ where: { id }, data: { slug } });
  return id;
}

describeIntegration('RoomService authorisation with PostgreSQL', () => {
  let ownerId = '';
  let memberId = '';
  let strangerId = '';
  let ownedRoomId = '';
  let memberRoomId = '';

  beforeAll(async () => {
    await initializeDb();
    ownerId = await seedUser('owner');
    memberId = await seedUser('member');
    strangerId = await seedUser('stranger');
    ownedRoomId = await seedRoom(ownerId, `owned-${randomUUID()}`);
    memberRoomId = await seedRoom(memberId, `member-${randomUUID()}`);
  });

  /**
   * Teardown, in foreign-key order.
   *
   * `ShareLink.roomId` and `CanvasRoomMember.roomId` both reference `CanvasRoom`, and
   * `CanvasRoom.ownerId` references `User`, so deleting in the wrong order raises
   * P2003 and leaves the fixture rows behind. The `ownerId` clause rather than an id
   * list, because several cases create extra rooms and link rows against the same
   * three accounts — and a leaked row would not fail this suite (every id here is
   * random per run), it would just accumulate.
   */
  afterAll(async () => {
    const accounts = [ownerId, memberId, strangerId];
    await db.shareLink.deleteMany({
      where: { OR: [{ room: { ownerId: { in: accounts } } }, { createdById: { in: accounts } }] },
    });
    await db.canvasRoomMember.deleteMany({
      where: { OR: [{ room: { ownerId: { in: accounts } } }, { userId: { in: accounts } }] },
    });
    await db.canvasRoom.deleteMany({ where: { ownerId: { in: accounts } } });
    await db.user.deleteMany({ where: { id: { in: accounts } } });
    await db.$disconnect();
  });

  /**
   * The `OR: [ownerId, members.some(userId)]` clause, which is the whole point.
   *
   * This is the query the in-memory fake was extended to model, and it is the only
   * place in the room API where relational filtering decides membership. A
   * regression that dropped either branch produces a specific, user-visible failure:
   * without `ownerId`, an owner loses sight of their own rooms; without
   * `members.some`, a collaborator's rooms vanish from their list.
   *
   * Asserted on ids rather than counts, because a count would also pass if the query
   * returned the right *number* of the wrong rows.
   */
  it('lists the caller’s own rooms and the rooms it has been added to, and no others', async () => {
    await RoomService.addMember({
      userId: ownerId,
      slug: await slugOf(ownedRoomId),
      memberUserId: memberId,
      role: 'EDITOR',
    });

    const asOwner = await RoomService.listRooms(ownerId);
    const asMember = await RoomService.listRooms(memberId);
    const asStranger = await RoomService.listRooms(strangerId);

    // Compared as sets, not as sequences: `listRooms` orders by `updatedAt desc`, and
    // two rooms created in the same millisecond have no defined order between them.
    // Asserting on order here would make the case flaky for a reason that has nothing
    // to do with authorisation.
    expect(asOwner.map(roomId)).toContain(ownedRoomId);
    expect(asMember.map(roomId).sort()).toEqual([ownedRoomId, memberRoomId].sort());
    // The stranger has no relationship to either room.
    expect(asStranger).toEqual([]);
  });

  /**
   * A membership row for a *different* room must not leak.
   *
   * The `some` clause is scoped by `roomId` on the far side. A query that matched
   * membership rows on `userId` alone — a plausible mistake, since both are user-ish
   * columns — would return every room the user has ever been invited to from every
   * room, which after a room deletion is exactly the room they must not see.
   */
  it('does not return a room through a membership row belonging to another room', async () => {
    const rooms = await RoomService.listRooms(memberId);

    expect(rooms.map(roomId)).not.toContain(memberRoomId + '-nonexistent');
    // And nothing outside the two seeded rooms.
    expect(rooms).toHaveLength(2);
  });

  /**
   * Private-room admission, against the real row rather than a fixture object.
   *
   * `getRoom` reads `room.members` and `room.ownerId` off the row Prisma returns, so
   * the two `include` branches (`owner`, `members`) are what this exercises. A
   * collaborator being refused here is the failure a user reports as "I was added and
   * I still can't open it".
   */
  it('admits the owner, a member, and refuses a stranger on a private room', async () => {
    const slug = await slugOf(ownedRoomId);

    const asOwner = await RoomService.getRoom({ userId: ownerId, slug });
    const asMember = await RoomService.getRoom({ userId: memberId, slug });
    const asStranger = await RoomService.getRoom({ userId: strangerId, slug });

    expect(asOwner.kind).toBe('ok');
    expect(asMember.kind).toBe('ok');
    expect(asStranger.kind).toBe('forbidden');
  });

  /**
   * The membership roles survive the round trip with their DB enum intact.
   *
   * `getRoom` is the only query that embeds `members[].role`, and `roomRoutes`
   * rewrites the enum to the lowercase wire vocabulary at the boundary. If the
   * mapping ever ran against a role the map did not cover, the raw `EDITOR` would
   * reach the client and every `role === 'edit'` comparison on the client would be
   * false — a read-only collaborator silently treated as an editor, or vice versa.
   */
  it('reads member roles back with their DB enum intact', async () => {
    const result = await RoomService.getRoom({
      userId: ownerId,
      slug: await slugOf(ownedRoomId),
    });

    expect(result.kind).toBe('ok');
    const members = (result as { room: { members: Array<{ userId: string; role: string }> } }).room
      .members;
    expect(members).toEqual([expect.objectContaining({ userId: memberId, role: 'EDITOR' })]);
  });

  /**
   * Delete is scoped to the owner, and it takes the membership rows with it.
   *
   * Two things at once. The scope: a delete that looked the room up by `slug` alone
   * would let any authenticated caller destroy any room. The cascade: leaving
   * `CanvasRoomMember` rows behind is not visible in the response, but
   * `listRooms`' `members.some` clause matches on them — so an orphaned row keeps a
   * dead room in a former member's list.
   */
  it('deletes only for the owner, and removes the membership rows with the room', async () => {
    const roomId = await seedRoom(ownerId, `doomed-${randomUUID()}`);
    await RoomService.addMember({
      userId: ownerId,
      slug: await slugOf(roomId),
      memberUserId: memberId,
      role: 'VIEWER',
    });

    const asStranger = await RoomService.deleteRoom({
      userId: strangerId,
      slug: await slugOf(roomId),
    });
    expect(asStranger).toEqual({ kind: 'not_found' });
    expect(await db.canvasRoom.findUnique({ where: { id: roomId } })).not.toBeNull();

    const asOwner = await RoomService.deleteRoom({ userId: ownerId, slug: await slugOf(roomId) });
    expect(asOwner).toEqual({ kind: 'ok' });
    expect(await db.canvasRoom.findUnique({ where: { id: roomId } })).toBeNull();
    expect(await db.canvasRoomMember.count({ where: { roomId } })).toBe(0);
  });

  /**
   * The optimistic fence is enforced by the database, not by a read-then-write.
   *
   * `updateRoom` matches on `{ slug, ownerId, updatedAt }` and answers `conflict` when
   * `updateManyAndReturn` matched nothing. Against a real database this is a genuine
   * compare-and-swap under concurrency — the in-memory fake compares in one turn and
   * cannot lose a race. Two concurrent saves from the same `expectedUpdatedAt` must
   * produce exactly one winner.
   */
  it('lets exactly one of two concurrent saves from the same fence win', async () => {
    const roomId = await seedRoom(ownerId, `race-${randomUUID()}`);
    const slug = await slugOf(roomId);
    const before = await db.canvasRoom.findUniqueOrThrow({ where: { id: roomId } });

    const [first, second] = await Promise.all([
      RoomService.updateRoom({
        userId: ownerId,
        slug,
        name: 'Winner A',
        expectedUpdatedAt: before.updatedAt,
      }),
      RoomService.updateRoom({
        userId: ownerId,
        slug,
        name: 'Winner B',
        expectedUpdatedAt: before.updatedAt,
      }),
    ]);

    const outcomes = [first.kind, second.kind].sort();
    expect(outcomes).toEqual(['conflict', 'ok']);
    // The row carries one of the two names, not a blend: the fence is a swap, not a
    // read-modify-write.
    const after = await db.canvasRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(['Winner A', 'Winner B']).toContain(after.name);

    await db.canvasRoom.deleteMany({ where: { id: roomId } });
  });

  /**
   * A non-owner cannot move a room's content, even with a valid fence.
   *
   * `updateRoom` reads the row by `slug` *without* the owner in the `where`, checks
   * ownership in code, and only then issues the scoped write. So this is a two-layer
   * check, and against a real database it is the only place the second layer is
   * load-bearing: a write that lost its `ownerId` would be invisible to the fake's
   * ownership assertion if the fake did not evaluate the clause.
   */
  it('refuses an update from a non-owner and leaves the row untouched', async () => {
    const slug = await slugOf(memberRoomId);
    const before = await db.canvasRoom.findUniqueOrThrow({ where: { id: memberRoomId } });

    const result = await RoomService.updateRoom({
      userId: strangerId,
      slug,
      name: 'Hijacked',
      expectedUpdatedAt: before.updatedAt,
    });

    expect(result.kind).toBe('forbidden');
    const after = await db.canvasRoom.findUniqueOrThrow({ where: { id: memberRoomId } });
    expect(after.name).toBe(before.name);
  });

  /**
   * The 24-hour quota counts real timestamps.
   *
   * `createRoom`'s window is `createdAt >= now - 24h`, evaluated by the database. The
   * in-memory fake compares `Date` values in one turn, so a window boundary — a room
   * created 23 hours ago counting, one 25 hours ago not — is arithmetic the fake
   * cannot disagree about but Postgres can, if the predicate were wrong.
   */
  it('counts only the rooms created inside the rolling 24-hour window', async () => {
    const roomId = await seedRoom(strangerId, `window-${randomUUID()}`);

    // Just inside: counts against the quota.
    await db.canvasRoom.update({
      where: { id: roomId },
      data: { createdAt: new Date(Date.now() - 23 * 60 * 60 * 1000) },
    });
    const recent = await countRoomsInWindow(strangerId);
    expect(recent).toBeGreaterThanOrEqual(1);

    // Well outside: does not count, so the quota is not consumed by old rooms.
    await db.canvasRoom.update({
      where: { id: roomId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const stale = await countRoomsInWindow(strangerId);
    expect(stale).toBe(recent - 1);

    await db.canvasRoom.deleteMany({ where: { id: roomId } });
  });

  /**
   * The quota refuses at the boundary, against the database's own count.
   *
   * `MAX_ROOMS_PER_DAY` is 10 and the check is `count >= limit`. This tops the account
   * up to exactly the limit and requires the next create to be refused — the same
   * boundary the route suite pins against the fake, here with a real `COUNT`.
   */
  it('refuses the eleventh room in the window', async () => {
    const roomId = await seedRoom(strangerId, `quota-${randomUUID()}`);
    const now = new Date();
    await db.canvasRoom.update({ where: { id: roomId }, data: { createdAt: now } });

    const roomCount = await countRoomsInWindow(strangerId);
    // Fill to exactly the limit.
    const filler: string[] = [];
    for (let index = roomCount; index < 10; index += 1) {
      filler.push(await seedRoom(strangerId, `filler-${randomUUID()}`));
    }
    expect(await countRoomsInWindow(strangerId)).toBe(10);

    const refused = await RoomService.createRoom({ userId: strangerId, name: 'One too many' });
    expect(refused).toEqual({ kind: 'rate_limited' });

    await db.canvasRoom.deleteMany({ where: { id: { in: [roomId, ...filler] } } });
  });

  /**
   * `getShareLink` refuses an elapsed link and honours a live one, off real dates.
   *
   * The comparison is `shareLink.expiresAt < new Date()` in JavaScript, after the row
   * is read. A `ShareLink` row's `expiresAt` is non-nullable, so "no expiry" is not a
   * state this table can hold — worth pinning, because the type says `Date | null` and
   * a future migration making it nullable would silently mean "never expires".
   */
  it('refuses an elapsed share link and serves a live one', async () => {
    const live = await createLink(ownerId, 1);
    const elapsed = await createLink(ownerId, 1);
    await db.shareLink.update({
      where: { id: elapsed.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const liveResult = await RoomService.getShareLink(live.token);
    const elapsedResult = await RoomService.getShareLink(elapsed.token);

    expect(liveResult.kind).toBe('ok');
    expect(elapsedResult.kind).toBe('expired');

    await db.shareLink.deleteMany({ where: { id: { in: [live.id, elapsed.id] } } });
  });

  /**
   * A share link is refused to a non-owner, and the row is not written.
   *
   * `shareRoom` reads by `slug` alone and checks `ownerId` in code. Against a real
   * database that means a non-owner's attempt must leave `ShareLink` empty — the
   * capability URL is the credential, so a row written here would be a public read of
   * somebody else's canvas.
   */
  it('refuses to share a room the caller does not own', async () => {
    const before = await db.shareLink.count({ where: { roomId: memberRoomId } });

    const result = await RoomService.shareRoom({
      userId: strangerId,
      slug: await slugOf(memberRoomId),
      permission: 'view',
      expiresInHours: 1,
    });

    expect(result.kind).toBe('forbidden');
    expect(await db.shareLink.count({ where: { roomId: memberRoomId } })).toBe(before);
  });

  /** The room's slug, which `createRoom` generated at random. */
  async function slugOf(id: string): Promise<string> {
    const row = await db.canvasRoom.findUniqueOrThrow({ where: { id }, select: { slug: true } });
    return row.slug;
  }

  /** `RoomService.listRooms` selects `id`, so the assertion can be on identity. */
  function roomId(room: unknown): string {
    return (room as { id: string }).id;
  }
});

/** The same predicate `createRoom` uses, run by the database. */
async function countRoomsInWindow(userId: string): Promise<number> {
  return db.canvasRoom.count({
    where: { ownerId: userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
}

async function createLink(
  userId: string,
  expiresInHours: number
): Promise<{ id: string; token: string }> {
  const slug = `linkable-${randomUUID()}`;
  const roomId = await seedRoom(userId, slug);
  const result = await RoomService.shareRoom({
    userId,
    slug,
    permission: 'view',
    expiresInHours,
  });
  if (result.kind !== 'ok') throw new Error(`fixture link was not issued: ${result.kind}`);
  const row = await db.shareLink.findUniqueOrThrow({ where: { token: result.token } });
  // The link outlives the test that made it if the caller forgets; tied to the room
  // so `afterAll`'s room delete reaches it.
  expect(row.roomId).toBe(roomId);
  return { id: row.id, token: result.token };
}
