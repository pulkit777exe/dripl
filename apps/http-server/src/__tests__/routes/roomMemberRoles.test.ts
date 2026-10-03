import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const dbMock = vi.hoisted(() => ({
  canvasRoom: { findUnique: vi.fn() },
  canvasRoomMember: { findUnique: vi.fn(), create: vi.fn() },
  // `roomRoutes` mounts `authMiddleware` for everything under `/api/rooms`, and the
  // middleware resolves the token's stored generation here. It must answer
  // `{ tokenVersion: 0 }` to match the `ver` claim `authHeader()` signs; the two
  // are compared, so a mismatch would answer 401 for a reason this suite is not
  // about.
  user: { findUnique: vi.fn(async () => ({ tokenVersion: 0 })) },
}));

// `authMiddleware` -- mounted by `roomRoutes` -- resolves the token's stored
// generation through `@dripl/db`, and that resolution is a *separate export* of
// this module. A literal `{ db: dbMock }` factory leaves it `undefined`, the
// middleware throws, and every request answers 401; `fakeRevocation` supplies the
// real functions against the `user` stub above.
vi.mock('@dripl/db', async () => {
  const { fakeRevocation } = await import('../test-utils/fakeDbModule');
  return { db: dbMock, ...(await fakeRevocation(dbMock as never)) };
});

import roomRoutes from '../../routes/roomRoutes';

// Product decision 2026-10-01 (Q2/Q5): the wire speaks lowercase view/edit
// everywhere; the DB keeps its EDITOR/VIEWER enum and roomRoutes maps at
// the boundary. One casing on the wire — uppercase requests are rejected.

function buildApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use('/api/rooms', roomRoutes);
  return app;
}

const app = buildApp();

/**
 * Signed with an explicit `ver: 0`, matching what `dbMock.user.findUnique` above
 * reports. The two have to agree: the revocation check compares them, and a token
 * whose claim disagreed with storage would be refused for a reason this suite is
 * not about.
 */
function authHeader(): string {
  const secret = process.env.JWT_SECRET;
  expect(secret).toBeTruthy();
  return `Bearer ${jwt.sign({ userId: 'user-1', ver: 0 }, secret as string)}`;
}

function mockAddMemberFlow(): void {
  dbMock.canvasRoom.findUnique.mockResolvedValue({ id: 'room-1' });
  dbMock.canvasRoomMember.findUnique.mockResolvedValue(null);
  dbMock.canvasRoomMember.create.mockResolvedValue({
    id: 'member-1',
    userId: 'user-2',
    role: 'EDITOR',
  });
}

describe('room member role wire vocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` drops the `vi.fn` implementation set in `dbMock`, including
    // the one the revocation check reads. Re-asserting it here keeps every case in
    // this file about wire vocabulary rather than about a 401.
    dbMock.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
  });

  it('maps wire edit to the DB EDITOR enum and returns wire edit', async () => {
    mockAddMemberFlow();
    const res = await request(app)
      .post('/api/rooms/some-room/members')
      .set('Authorization', authHeader())
      .send({ userId: 'user-2', role: 'edit' });

    expect(res.status).toBe(201);
    expect(dbMock.canvasRoomMember.create).toHaveBeenCalledWith({
      data: { roomId: 'room-1', userId: 'user-2', role: 'EDITOR' },
    });
    expect(res.body.member.role).toBe('edit');
  });

  it('defaults an omitted role to the old EDITOR grant, in wire terms', async () => {
    mockAddMemberFlow();
    const res = await request(app)
      .post('/api/rooms/some-room/members')
      .set('Authorization', authHeader())
      .send({ userId: 'user-2' });

    expect(res.status).toBe(201);
    expect(dbMock.canvasRoomMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'EDITOR' }) })
    );
    expect(res.body.member.role).toBe('edit');
  });

  it('rejects uppercase DB names — one casing on the wire', async () => {
    mockAddMemberFlow();
    const res = await request(app)
      .post('/api/rooms/some-room/members')
      .set('Authorization', authHeader())
      .send({ userId: 'user-2', role: 'EDITOR' });

    expect(res.status).toBe(400);
    expect(dbMock.canvasRoomMember.create).not.toHaveBeenCalled();
  });

  it('maps member roles to wire view/edit in the room response', async () => {
    dbMock.canvasRoom.findUnique.mockResolvedValue({
      slug: 'some-room',
      ownerId: 'user-1',
      isPublic: false,
      content: '[]',
      owner: { id: 'user-1', name: 'Owner', image: null },
      members: [
        { userId: 'user-2', role: 'EDITOR', user: { id: 'user-2', name: 'Ed', image: null } },
        { userId: 'user-3', role: 'VIEWER', user: { id: 'user-3', name: 'Vi', image: null } },
      ],
    });

    const res = await request(app).get('/api/rooms/some-room').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.room.members.map((m: { role: string }) => m.role)).toEqual(['edit', 'view']);
  });
});
