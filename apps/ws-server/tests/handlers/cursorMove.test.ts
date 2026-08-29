import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cursorMoveHandler } from '@/handlers/cursorMove';
import { broadcast } from '@/broadcast';
import type { RoomState, UserConnection, HandlerCtx, HandlerLogger } from '@/handlers/types';
import type { WebSocket } from 'ws';

vi.mock('@/broadcast', () => ({
  broadcast: vi.fn(),
}));

const mockedBroadcast = vi.mocked(broadcast);

function makeLogger(): HandlerLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
}

function makeUser(): UserConnection {
  return {
    userId: 'user-1',
    displayName: 'Alice',
    color: '#ff0000',
    ws: { readyState: 1 } as unknown as WebSocket,
    isAlive: true,
  };
}

function makeRoom(): RoomState {
  return {
    roomId: 'room-1',
    elements: new Map(),
    users: new Map([['user-1', makeUser()]]),
    cursors: new Map(),
    viewports: new Map(),
    following: new Map(),
    elementLocks: new Map(),
    recentMsgIds: new Set(),
    loadedFromDb: true,
    saving: false,
    dirty: false,
  };
}

function makeCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
  return {
    ws: { readyState: 1 } as unknown as WebSocket,
    user: makeUser(),
    userId: 'user-1',
    roomId: 'room-1',
    room: makeRoom(),
    logger: makeLogger(),
    ...overrides,
  };
}

describe('cursorMoveHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses snake_case payload (cursor_move)', () => {
    const ctx = makeCtx();
    const msg = { type: 'cursor_move' as const, x: 10, y: 20, userName: 'Alice' };

    cursorMoveHandler.apply(msg, ctx);

    expect(ctx.room.cursors.get('user-1')).toEqual({ x: 10, y: 20 });
    expect(mockedBroadcast).toHaveBeenCalledTimes(1);
    const broadcastArgs = mockedBroadcast.mock.calls[0]!;
    expect(broadcastArgs[0]).toBe(ctx.room);
    expect(broadcastArgs[1]).toMatchObject({
      type: 'cursor_move',
      roomId: 'room-1',
      userId: 'user-1',
      x: 10,
      y: 20,
      displayName: 'Alice',
      color: '#ff0000',
    });
    expect(broadcastArgs[2]).toBe('user-1');
  });

  it('uses kebab-case payload (cursor-move)', () => {
    const ctx = makeCtx();
    const msg = { type: 'cursor-move' as const, x: 30, y: 40, displayName: 'Bob' };

    cursorMoveHandler.apply(msg, ctx);

    expect(ctx.room.cursors.get('user-1')).toEqual({ x: 30, y: 40 });
    expect(mockedBroadcast).toHaveBeenCalledTimes(1);
    expect(mockedBroadcast.mock.calls[0]![1]).toMatchObject({
      type: 'cursor_move',
      x: 30,
      y: 40,
      displayName: 'Bob',
    });
  });

  it('falls back to user displayName and color when message omits them', () => {
    const ctx = makeCtx();
    const msg = { type: 'cursor_move' as const, x: 0, y: 0 };

    cursorMoveHandler.apply(msg, ctx);

    expect(mockedBroadcast.mock.calls[0]![1]).toMatchObject({
      displayName: 'Alice',
      color: '#ff0000',
    });
  });

  it('rejects unknown message shapes at the schema boundary', () => {
    const bad = { type: 'cursor_move', x: 'not-a-number', y: 0 };
    const result = cursorMoveHandler.schema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
