import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@dripl/db', () => ({
  db: {
    shareLink: { findUnique: vi.fn() },
  },
}));

import { db } from '@dripl/db';
import roomRoutes from '../../routes/roomRoutes';
import { createApp } from '../../app';

const findShare = vi.mocked(db.shareLink.findUnique);

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/rooms', roomRoutes);
  return instance;
}

describe('public room capability links', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a valid token before the room auth middleware', async () => {
    findShare.mockResolvedValue({
      token: 'share-token',
      permission: 'VIEW',
      expiresAt: new Date(Date.now() + 60_000),
      room: { id: 'room-1', slug: 'room-1', name: 'Room', content: '[]', isPublic: false },
    } as never);

    const response = await request(app()).get('/api/rooms/share/share-token');
    expect(response.status).toBe(200);
    expect(response.body.room.slug).toBe('room-1');
  });

  it('keeps the capability route public when the full app is mounted', async () => {
    findShare.mockResolvedValue({
      token: 'app-share-token',
      permission: 'VIEW',
      expiresAt: new Date(Date.now() + 60_000),
      room: { id: 'room-1', slug: 'room-1', name: 'Room', content: '[]', isPublic: false },
    } as never);

    const response = await request(createApp()).get('/api/rooms/share/app-share-token');
    expect(response.status).toBe(200);
    expect(response.body.permission).toBe('VIEW');
  });

  it('rejects expired capability links', async () => {
    findShare.mockResolvedValue({
      token: 'expired-token',
      permission: 'VIEW',
      expiresAt: new Date(Date.now() - 1_000),
      room: { id: 'room-1', slug: 'room-1', name: 'Room', content: '[]', isPublic: false },
    } as never);

    const response = await request(app()).get('/api/rooms/share/expired-token');
    expect(response.status).toBe(410);
  });
});
