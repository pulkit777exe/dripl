import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  elementLockHandler,
  elementUnlockHandler,
  elementLockHeartbeatHandler,
} from '@/handlers/locks';
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

// `Handler.apply` is declared `void | Promise<void>` because the dispatcher
// awaits every handler, so calling one without awaiting is a genuinely
// floating promise. These three handlers are synchronous today; awaiting is
// what keeps these tests honest if that ever changes.
describe('elementLockHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets the lock and broadcasts it', async () => {
    const ctx = makeCtx();
    await elementLockHandler.apply({ type: 'element-lock', elementId: 'el-1' }, ctx);
    expect(ctx.room.elementLocks.get('el-1')).toMatchObject({ userId: 'user-1' });
    expect(mockedBroadcast).toHaveBeenCalledTimes(1);
  });

  it('refuses a lock held by another user', async () => {
    const ctx = makeCtx();
    ctx.room.elementLocks.set('el-1', { userId: 'user-2', lastHeartbeat: Date.now() });
    await elementLockHandler.apply({ type: 'element-lock', elementId: 'el-1' }, ctx);
    expect(ctx.room.elementLocks.get('el-1')?.userId).toBe('user-2');
    expect(mockedBroadcast).not.toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('defers to read-only access', async () => {
    const ctx = makeCtx({ rejectReadOnlyMutation: () => true });
    await elementLockHandler.apply({ type: 'element-lock', elementId: 'el-1' }, ctx);
    expect(ctx.room.elementLocks.has('el-1')).toBe(false);
    expect(mockedBroadcast).not.toHaveBeenCalled();
  });
});

describe('elementUnlockHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases an own lock and broadcasts', async () => {
    const ctx = makeCtx();
    ctx.room.elementLocks.set('el-1', { userId: 'user-1', lastHeartbeat: Date.now() });
    await elementUnlockHandler.apply({ type: 'element-unlock', elementId: 'el-1' }, ctx);
    expect(ctx.room.elementLocks.has('el-1')).toBe(false);
    expect(mockedBroadcast).toHaveBeenCalledTimes(1);
  });

  it('ignores locks owned by others', async () => {
    const ctx = makeCtx();
    ctx.room.elementLocks.set('el-1', { userId: 'user-2', lastHeartbeat: Date.now() });
    await elementUnlockHandler.apply({ type: 'element-unlock', elementId: 'el-1' }, ctx);
    expect(ctx.room.elementLocks.has('el-1')).toBe(true);
    expect(mockedBroadcast).not.toHaveBeenCalled();
  });
});

describe('elementLockHeartbeatHandler', () => {
  it('refreshes the heartbeat of an own lock only', async () => {
    const ctx = makeCtx();
    ctx.room.elementLocks.set('el-1', { userId: 'user-1', lastHeartbeat: 1 });
    ctx.room.elementLocks.set('el-2', { userId: 'user-2', lastHeartbeat: 1 });
    await elementLockHeartbeatHandler.apply(
      { type: 'element-lock-heartbeat', elementId: 'el-1' },
      ctx
    );
    await elementLockHeartbeatHandler.apply(
      { type: 'element-lock-heartbeat', elementId: 'el-2' },
      ctx
    );
    expect(ctx.room.elementLocks.get('el-1')?.lastHeartbeat).toBeGreaterThan(1);
    expect(ctx.room.elementLocks.get('el-2')?.lastHeartbeat).toBe(1);
  });
});
