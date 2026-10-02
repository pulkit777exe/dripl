import { describe, it, expect, vi, beforeEach } from 'vitest';
import { viewportUpdateHandler, followUserHandler, unfollowUserHandler } from '@/handlers/presence';
import { broadcast, send } from '@/broadcast';
import type { RoomState, UserConnection, HandlerCtx, HandlerLogger } from '@/handlers/types';
import type { WebSocket } from 'ws';

vi.mock('@/broadcast', () => ({
  broadcast: vi.fn(),
  send: vi.fn(),
}));

const mockedBroadcast = vi.mocked(broadcast);
const mockedSend = vi.mocked(send);

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
    tombstones: new Map(),
    loadedFromDb: true,
    saving: false,
    dirty: false,
  } as RoomState;
}

function makeCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
  return {
    ws: { readyState: 1 } as unknown as WebSocket,
    user: makeUser(),
    userId: 'user-1',
    roomId: 'room-1',
    room: makeRoom(),
    logger: makeLogger(),
    rejectReadOnlyMutation: () => false,
    ...overrides,
  };
}

describe('viewportUpdateHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // `Handler.apply` is `void | Promise<void>` because the dispatcher awaits
  // every handler, so an un-awaited call in a test is a genuinely floating
  // promise. These handlers are synchronous today; awaiting keeps these tests
  // honest if that changes.
  it('stores the viewport and notifies followers only', async () => {
    const ctx = makeCtx();
    const followerWs = { readyState: 1 } as unknown as WebSocket;
    const bystanderWs = { readyState: 1 } as unknown as WebSocket;
    ctx.room.users.set('follower', { ...makeUser(), userId: 'follower', ws: followerWs });
    ctx.room.users.set('bystander', { ...makeUser(), userId: 'bystander', ws: bystanderWs });
    ctx.room.following.set('follower', 'user-1');

    await viewportUpdateHandler.apply(
      { type: 'viewport-update', panX: 10, panY: 20, zoom: 2 },
      ctx
    );

    expect(ctx.room.viewports.get('user-1')).toEqual({ panX: 10, panY: 20, zoom: 2 });
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledWith(
      followerWs,
      expect.objectContaining({ type: 'viewport-update', userId: 'user-1' })
    );
    expect(mockedBroadcast).not.toHaveBeenCalled();
  });
});

describe('followUserHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the follow and pushes the leader viewport', async () => {
    const ctx = makeCtx();
    ctx.room.viewports.set('leader', { panX: 1, panY: 2, zoom: 3 });
    await followUserHandler.apply({ type: 'follow-user', targetUserId: 'leader' }, ctx);
    expect(ctx.room.following.get('user-1')).toBe('leader');
    expect(mockedSend).toHaveBeenCalledWith(
      ctx.ws,
      expect.objectContaining({ type: 'viewport-update', userId: 'leader' })
    );
  });

  it('records the follow silently when the leader has no viewport', async () => {
    const ctx = makeCtx();
    await followUserHandler.apply({ type: 'follow-user', targetUserId: 'ghost' }, ctx);
    expect(ctx.room.following.get('user-1')).toBe('ghost');
    expect(mockedSend).not.toHaveBeenCalled();
  });
});

describe('unfollowUserHandler', () => {
  it('removes the follow', async () => {
    const ctx = makeCtx();
    ctx.room.following.set('user-1', 'leader');
    await unfollowUserHandler.apply({ type: 'unfollow-user' }, ctx);
    expect(ctx.room.following.has('user-1')).toBe(false);
  });
});
