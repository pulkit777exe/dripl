/**
 * The scene handlers — the only place a *locally authorised* mutation is
 * admitted and relayed.
 *
 * `production-integration.test.ts` proves the happy path end to end over real
 * sockets, but a socket test cannot see the difference between "the handler
 * relayed this" and "the dispatcher relayed it", and it cannot reach a room at
 * capacity without building a 5000-element scene over the wire. Both of the
 * properties below are load-bearing and were untested at this level:
 *
 *   - a read-only principal's mutation must be refused *before* any element is
 *     stored or broadcast. A read-only viewer that can still mutate the room
 *     is the authz boundary failing, not a cosmetic issue.
 *   - `scene-update` is additive. Treating the `init` subtype as a replace is
 *     how a newly connected client with a partial local scene erases a room.
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
import {
  addElementHandler,
  deleteElementHandler,
  elementUpdateHandler,
  sceneDeltaHandler,
  sceneUpdateHandler,
  updateElementHandler,
} from '../../handlers/scene';
import type { HandlerCtx, HandlerLogger, RoomState } from '../../handlers/types';

const mockedBroadcast = vi.mocked(broadcast);
const mockedSend = vi.mocked(send);

const el = (id: string, version = 1): DriplElement =>
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

function makeLogger(): HandlerLogger {
  return { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };
}

function makeCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
  const room = (overrides.room ?? getOrCreateRoom('scene-handlers')) as RoomState;
  return {
    ws: { readyState: 1 } as unknown as WebSocket,
    user: {
      userId: 'user-1',
      displayName: 'Alice',
      color: '#ff0000',
      ws: { readyState: 1 } as unknown as WebSocket,
      isAlive: true,
    },
    userId: 'user-1',
    roomId: room.roomId,
    room,
    logger: makeLogger(),
    rejectReadOnlyMutation: () => false,
    ...overrides,
  };
}

function sentMessages(): Array<Record<string, unknown>> {
  return mockedSend.mock.calls.map(call => call[1] as Record<string, unknown>);
}

describe('scene handlers', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const timeout of saveTimeouts.values()) clearTimeout(timeout);
    saveTimeouts.clear();
  });

  describe('read-only enforcement', () => {
    // One test per handler, because the guard is duplicated per handler by
    // construction: a new handler that forgets it is a read-only viewer
    // writing to the room. Each case carries a marker element the handler
    // would have to touch, so "the handler returned early" is distinguishable
    // from "the handler ran and its fence happened to reject the payload".
    type ReadOnlyCase = {
      name: string;
      setup: (ctx: HandlerCtx) => void;
      apply: (ctx: HandlerCtx) => Promise<void>;
    };

    const cases: ReadOnlyCase[] = [
      {
        name: 'add_element',
        setup: () => undefined,
        apply: ctx =>
          Promise.resolve(
            addElementHandler.apply({ type: 'add_element', element: el('ro-add') } as never, ctx)
          ),
      },
      {
        name: 'update_element',
        setup: ctx => ctx.room.elements.set('ro-add', el('ro-add', 4)),
        apply: ctx =>
          Promise.resolve(
            updateElementHandler.apply(
              { type: 'update_element', element: el('ro-add', 9) } as never,
              ctx
            )
          ),
      },
      {
        name: 'delete_element',
        setup: ctx => ctx.room.elements.set('victim', el('victim')),
        apply: ctx =>
          Promise.resolve(
            deleteElementHandler.apply(
              { type: 'delete_element', elementId: 'victim' } as never,
              ctx
            )
          ),
      },
      {
        name: 'scene-update',
        setup: ctx => ctx.room.elements.set('kept', el('kept', 4)),
        apply: ctx =>
          Promise.resolve(
            sceneUpdateHandler.apply(
              { type: 'scene-update', subtype: 'update', elements: [el('ro-add')] } as never,
              ctx
            )
          ),
      },
      {
        name: 'scene-delta',
        setup: ctx => ctx.room.elements.set('gone', el('gone', 2)),
        apply: ctx =>
          Promise.resolve(
            sceneDeltaHandler.apply(
              { type: 'scene-delta', added: [el('ro-add')], deleted: ['gone'] } as never,
              ctx
            )
          ),
      },
      {
        name: 'element-update',
        setup: () => undefined,
        apply: ctx =>
          Promise.resolve(
            elementUpdateHandler.apply(
              { type: 'element-update', element: el('ro-add') } as never,
              ctx
            )
          ),
      },
    ];

    for (const { name, setup, apply } of cases) {
      it(`${name} stores nothing, broadcasts nothing, and leaves the room clean`, async () => {
        const ctx = makeCtx({ rejectReadOnlyMutation: () => true });
        setup(ctx);
        const before = [...ctx.room.elements.entries()];

        await apply(ctx);

        // Byte-identical scene: the handler returned before touching anything.
        // A delete that had run would also show up as a tombstone below.
        expect([...ctx.room.elements.entries()]).toEqual(before);
        expect(ctx.room.tombstones.size).toBe(0);
        expect(ctx.room.dirty).toBe(false);
        expect(mockedBroadcast).not.toHaveBeenCalled();
        expect(saveTimeouts.has(ctx.roomId)).toBe(false);
      });
    }
  });

  describe('addElementHandler', () => {
    it('relays an add as delta-added and marks the room for save', async () => {
      // The uniform relay contract: receivers implement one merge path, so an
      // add arriving as a verbatim `add_element` would be dropped by every
      // current client.
      const ctx = makeCtx();
      await addElementHandler.apply({ type: 'add_element', element: el('a') } as never, ctx);
      expect(mockedBroadcast).toHaveBeenCalledWith(
        ctx.room,
        { type: 'scene-delta', added: [el('a')] },
        'user-1'
      );
      expect(ctx.room.dirty).toBe(true);
      expect(saveTimeouts.has('scene-handlers')).toBe(true);
    });

    it('drops a replayed version instead of overwriting the stored copy', async () => {
      const ctx = makeCtx();
      ctx.room.elements.set('a', el('a', 9));
      await addElementHandler.apply({ type: 'add_element', element: el('a', 2) } as never, ctx);
      expect(ctx.room.elements.get('a')?.version).toBe(9);
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(ctx.room.dirty).toBe(false);
    });

    it('answers a full scene with the capacity message and stores nothing', async () => {
      const ctx = makeCtx();
      for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
        ctx.room.elements.set(`full-${i}`, el(`full-${i}`));
      }
      await addElementHandler.apply({ type: 'add_element', element: el('one-more') } as never, ctx);
      expect(ctx.room.elements.has('one-more')).toBe(false);
      expect(sentMessages()).toEqual([
        { type: 'error', message: `Scene is at capacity (${MAX_SCENE_ELEMENTS} elements max)` },
      ]);
    });

    it('still admits an update to an element in a full scene', async () => {
      // Capacity gates *new* ids only. Gating updates would make a full room
      // permanently frozen — nobody could ever delete-or-edit their way out.
      const ctx = makeCtx();
      for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
        ctx.room.elements.set(`full-${i}`, el(`full-${i}`));
      }
      await updateElementHandler.apply(
        { type: 'update_element', element: el('full-0', 5) } as never,
        ctx
      );
      expect(ctx.room.elements.get('full-0')?.version).toBe(5);
      expect(mockedSend).not.toHaveBeenCalled();
    });
  });

  describe('deleteElementHandler', () => {
    it('relays a delete as delta-deleted with a tombstone behind it', async () => {
      const ctx = makeCtx();
      ctx.room.elements.set('x', el('x', 3));
      await deleteElementHandler.apply({ type: 'delete_element', elementId: 'x' } as never, ctx);
      expect(mockedBroadcast).toHaveBeenCalledWith(
        ctx.room,
        { type: 'scene-delta', deleted: ['x'] },
        'user-1'
      );
      expect(ctx.room.tombstones.get('x')?.version).toBe(4);
    });

    it('is silent for an id the room does not have', async () => {
      // No relay for a no-op: a delete for an absent id would tell every peer
      // to delete something it never had.
      const ctx = makeCtx();
      await deleteElementHandler.apply(
        { type: 'delete_element', elementId: 'ghost' } as never,
        ctx
      );
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(ctx.room.dirty).toBe(false);
    });
  });

  describe('sceneUpdateHandler', () => {
    it('never deletes elements missing from the payload', async () => {
      // The `init` contract. A newly connected client can hold a partial local
      // scene; treating its snapshot as a replacement would erase the room for
      // everyone before the first collaboration update lands.
      const ctx = makeCtx();
      ctx.room.elements.set('kept', el('kept', 4));
      await sceneUpdateHandler.apply(
        { type: 'scene-update', subtype: 'init', elements: [el('incoming')] } as never,
        ctx
      );
      expect([...ctx.room.elements.keys()].sort()).toEqual(['incoming', 'kept']);
      expect(mockedBroadcast).toHaveBeenCalledWith(
        ctx.room,
        { type: 'scene-delta', added: [el('incoming')] },
        'user-1'
      );
    });

    it('stays silent when every element in the snapshot loses the fence', async () => {
      const ctx = makeCtx();
      ctx.room.elements.set('a', el('a', 9));
      await sceneUpdateHandler.apply(
        { type: 'scene-update', subtype: 'update', elements: [el('a', 1)] } as never,
        ctx
      );
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(ctx.room.dirty).toBe(false);
    });

    it('acks a replayed clientMsgId without re-applying it', async () => {
      // The retry path for a client that did not see the ack. Re-applying is
      // mostly harmless, but it would relay a duplicate delta to every peer and
      // re-bump the room version for work already done.
      const ctx = makeCtx();
      const message = {
        type: 'scene-update' as const,
        subtype: 'update' as const,
        elements: [el('a')],
        clientMsgId: 'msg-1',
      };
      await sceneUpdateHandler.apply(message as never, ctx);
      expect(ctx.room.recentMsgIds.has('msg-1')).toBe(true);
      mockedBroadcast.mockClear();
      mockedSend.mockClear();

      await sceneUpdateHandler.apply(message as never, ctx);
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(sentMessages()).toEqual([{ type: 'pong', timestamp: expect.any(Number) }]);
    });

    it('refuses a snapshot larger than the cap even if the wire schema ever allowed it', async () => {
      // Defence in depth: `sceneUpdateSchema` caps `elements` at
      // MAX_SCENE_ELEMENTS and the handler re-checks the raw length. Both must
      // hold — if either were loosened, an over-cap snapshot would be stored
      // into a room no client could then add to.
      const ctx = makeCtx();
      const oversized = Array.from({ length: MAX_SCENE_ELEMENTS + 1 }, (_, i) => el(`x-${i}`));
      await sceneUpdateHandler.apply(
        { type: 'scene-update', subtype: 'update', elements: oversized } as never,
        ctx
      );
      expect(ctx.room.elements.size).toBe(0);
      expect(sentMessages()).toEqual([
        { type: 'error', message: `Scene is at capacity (${MAX_SCENE_ELEMENTS} elements max)` },
      ]);
    });
  });

  describe('sceneDeltaHandler', () => {
    it('relays one delta carrying only the changes that actually applied', async () => {
      // A peer must not be told to delete an id this room never had ('other'),
      // and must not be sent a stale update that lost its fence. Relaying
      // anything the fence dropped would make peers diverge from the owner.
      const ctx = makeCtx();
      ctx.room.elements.set('gone', el('gone', 2));
      await sceneDeltaHandler.apply(
        {
          type: 'scene-delta',
          added: [el('fresh')],
          updated: [el('gone', 5)],
          deleted: ['other'],
        } as never,
        ctx
      );
      expect(mockedBroadcast).toHaveBeenCalledWith(
        ctx.room,
        { type: 'scene-delta', added: [el('fresh')], updated: [el('gone', 5)] },
        'user-1'
      );
    });

    it('relays only the delete when nothing else survived', async () => {
      const ctx = makeCtx();
      ctx.room.elements.set('x', el('x', 1));
      await sceneDeltaHandler.apply({ type: 'scene-delta', deleted: ['x'] } as never, ctx);
      expect(mockedBroadcast).toHaveBeenCalledWith(
        ctx.room,
        { type: 'scene-delta', deleted: ['x'] },
        'user-1'
      );
    });

    it('reports capacity once and applies nothing from the delta', async () => {
      const ctx = makeCtx();
      for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
        ctx.room.elements.set(`full-${i}`, el(`full-${i}`));
      }
      await sceneDeltaHandler.apply(
        { type: 'scene-delta', added: [el('over')], deleted: ['full-0'] } as never,
        ctx
      );
      expect(ctx.room.elements.has('over')).toBe(false);
      expect(ctx.room.elements.has('full-0')).toBe(true);
      expect(ctx.room.dirty).toBe(false);
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(sentMessages()).toEqual([
        { type: 'error', message: `Scene is at capacity (${MAX_SCENE_ELEMENTS} elements max)` },
      ]);
    });

    it('emits no delta at all when every change lost its fence', async () => {
      const ctx = makeCtx();
      ctx.room.elements.set('a', el('a', 9));
      await sceneDeltaHandler.apply({ type: 'scene-delta', updated: [el('a', 1)] } as never, ctx);
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(mockedSend).not.toHaveBeenCalled();
      expect(ctx.room.dirty).toBe(false);
    });
  });

  describe('elementUpdateHandler', () => {
    it('relays a batch as delta-updated', async () => {
      const ctx = makeCtx();
      await elementUpdateHandler.apply(
        { type: 'element-update', elements: [el('a'), el('b')] } as never,
        ctx
      );
      expect(mockedBroadcast).toHaveBeenCalledWith(
        ctx.room,
        { type: 'scene-delta', updated: [el('a'), el('b')] },
        'user-1'
      );
    });

    it('ignores an element-update with neither elements nor element', async () => {
      const ctx = makeCtx();
      await elementUpdateHandler.apply({ type: 'element-update' } as never, ctx);
      expect(mockedBroadcast).not.toHaveBeenCalled();
      expect(ctx.room.dirty).toBe(false);
    });

    it('refuses a batch that would overflow the scene', async () => {
      const ctx = makeCtx();
      const oversized = Array.from({ length: MAX_SCENE_ELEMENTS + 1 }, (_, i) => el(`x-${i}`));
      await elementUpdateHandler.apply(
        { type: 'element-update', elements: oversized } as never,
        ctx
      );
      expect(ctx.room.elements.size).toBe(0);
      expect(sentMessages()).toEqual([
        { type: 'error', message: `Scene is at capacity (${MAX_SCENE_ELEMENTS} elements max)` },
      ]);
    });

    it('drops a stale singleton rather than relaying it', async () => {
      const ctx = makeCtx();
      ctx.room.elements.set('a', el('a', 9));
      await elementUpdateHandler.apply(
        { type: 'element-update', element: el('a', 1) } as never,
        ctx
      );
      expect(ctx.room.elements.get('a')?.version).toBe(9);
      expect(mockedBroadcast).not.toHaveBeenCalled();
    });

    it('reports capacity for a new singleton in a full scene', async () => {
      const ctx = makeCtx();
      for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
        ctx.room.elements.set(`full-${i}`, el(`full-${i}`));
      }
      await elementUpdateHandler.apply(
        { type: 'element-update', element: el('new') } as never,
        ctx
      );
      expect(ctx.room.elements.has('new')).toBe(false);
      expect(sentMessages()).toEqual([
        { type: 'error', message: `Scene is at capacity (${MAX_SCENE_ELEMENTS} elements max)` },
      ]);
    });
  });
});
