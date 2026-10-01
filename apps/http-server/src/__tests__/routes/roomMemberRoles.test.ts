import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const dbMock = vi.hoisted(() => ({
  canvasRoom: { findUnique: vi.fn() },
  canvasRoomMember: { findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

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

function authHeader(): string {
  const secret = process.env.JWT_SECRET;
  expect(secret).toBeTruthy();
  return `Bearer ${jwt.sign({ userId: 'user-1' }, secret as string)}`;
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
