/**
 * The last few branches in `handlers/scene.ts` — the per-handler guards that sit
 * beside the admission funnel rather than inside it.
 *
 * They are duplicated per handler on purpose (each handler owns its own wire
 * effects), which is exactly why they need individual tests: a copy that drifts
 * is invisible, and the drifted copy is the one that lets an over-cap batch or a
 * replayed message through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';
import { MAX_SCENE_ELEMENTS } from '@dripl/common';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

vi.mock('@/broadcast', () => ({ broadcast: vi.fn(), send: vi.fn() }));
vi.mock('../../redis', async importOriginal => {
  const actual = await importOriginal<typeof import('../../redis')>();
  return { ...actual, publishToRoom: vi.fn(async () => undefined) };
});

import { broadcast, send } from '../../broadcast';
import { getOrCreateRoom, rooms, saveTimeouts } from '../../rooms';
import { sceneDeltaHandler, sceneUpdateHandler, updateElementHandler } from '../../handlers/scene';
import type { HandlerCtx } from '../../handlers/types';

const mockedBroadcast = vi.mocked(broadcast);
const mockedSend = vi.mocked(send);

const el = (id: string, version = 1) =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    version,
    versionNonce: version,
  }) as unknown as DriplElement;

function makeCtx(): HandlerCtx {
  const room = getOrCreateRoom('scene-edge');
  return {
    ws: { readyState: 1 } as unknown as WebSocket,
    user: {
      userId: 'u',
      displayName: 'U',
      color: '#000',
      ws: { readyState: 1 } as unknown as WebSocket,
      isAlive: true,
    },
    userId: 'u',
    roomId: room.roomId,
    room,
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    rejectReadOnlyMutation: () => false,
  };
}

function sentMessages(): Array<Record<string, unknown>> {
  return mockedSend.mock.calls.map(call => call[1] as Record<string, unknown>);
}

describe('scene handler edge guards', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const timeout of saveTimeouts.values()) clearTimeout(timeout);
    saveTimeouts.clear();
  });

  it('reports capacity for an update to a new id in a full scene', async () => {
    // The mirrored copy of `addElementHandler`'s capacity branch. `add` is not
    // the only way a scene reaches its cap: an `update_element` naming an id the
    // room has never seen is an add in disguise, and without this branch it would
    // put the room one element over the limit that every other admission path
    // enforces.
    const ctx = makeCtx();
    for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
      ctx.room.elements.set(`full-${i}`, el(`full-${i}`));
    }
    await updateElementHandler.apply(
      { type: 'update_element', element: el('ghost') } as never,
      ctx
    );
    expect(ctx.room.elements.has('ghost')).toBe(false);
    expect(sentMessages()).toEqual([
      { type: 'error', message: `Scene is at capacity (${MAX_SCENE_ELEMENTS} elements max)` },
    ]);
    expect(mockedBroadcast).not.toHaveBeenCalled();
  });

  it('ignores a scene-update whose elements field is not an array', async () => {
    // The wire schema guarantees an array, so this can only arrive from a direct
    // caller or a future transport. It must be a no-op rather than a crash in the
    // dispatch, which would take the connection's whole message queue with it.
    const ctx = makeCtx();
    expect(() =>
      sceneUpdateHandler.apply(
        { type: 'scene-update', subtype: 'update', elements: 'nope' } as never,
        ctx
      )
    ).not.toThrow();
    expect(ctx.room.elements.size).toBe(0);
    expect(ctx.room.dirty).toBe(false);
  });

  it('ignores a scene-delta whose added field is not an array', async () => {
    const ctx = makeCtx();
    expect(() =>
      sceneDeltaHandler.apply({ type: 'scene-delta', added: 'nope' } as never, ctx)
    ).not.toThrow();
    expect(ctx.room.elements.size).toBe(0);
    expect(ctx.room.dirty).toBe(false);
    expect(mockedBroadcast).not.toHaveBeenCalled();
  });

  it('acks a replayed scene-delta without re-applying it', async () => {
    // The retry path for a client that missed the ack. Re-applying is not
    // harmless: it re-relays a duplicate delta to every peer and re-bumps the
    // room version for work already done, so the room never settles.
    const ctx = makeCtx();
    const message = {
      type: 'scene-delta' as const,
      added: [el('a')],
      clientMsgId: 'delta-1',
    };
    await sceneDeltaHandler.apply(message as never, ctx);
    expect(ctx.room.recentMsgIds.has('delta-1')).toBe(true);
    mockedBroadcast.mockClear();
    mockedSend.mockClear();

    await sceneDeltaHandler.apply(message as never, ctx);

    expect(mockedBroadcast).not.toHaveBeenCalled();
    expect(sentMessages()).toEqual([{ type: 'pong', timestamp: expect.any(Number) }]);
    expect(ctx.room.mutationVersion).toBe(1);
  });

  it('does not consume its dedup budget on a message that changes nothing', async () => {
    // Order matters: the dedup check runs before the fences, so a batch that
    // loses every element still burns its `clientMsgId`. A retry of that batch
    // is then silently acked. Pinned because the current order is the one the
    // client protocol assumes — the alternative (fence first) would let a retry
    // of a partially-applied batch apply the rest.
    const ctx = makeCtx();
    ctx.room.elements.set('a', el('a', 9));
    const stale = {
      type: 'scene-delta' as const,
      updated: [el('a', 1)],
      clientMsgId: 'delta-stale',
    };
    await sceneDeltaHandler.apply(stale as never, ctx);
    expect(ctx.room.recentMsgIds.has('delta-stale')).toBe(true);
    expect(ctx.room.mutationVersion).toBe(0);
  });
});
