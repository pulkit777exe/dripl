import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { getOrCreateRoom, rooms } from '../rooms';
import { deleteWithTombstone } from '../tombstones';
import {
  applyRemoteSceneMessage,
  commitLocalSceneCommand,
  defaultSceneCommitPorts,
  type CommitReceipt,
  type LocalSceneOrigin,
  type SceneCommitPorts,
} from '../sceneCommit';

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

function makePorts() {
  const calls: string[] = [];
  const send = vi.fn((..._args: unknown[]) => {
    calls.push('send');
  });
  const broadcast = vi.fn((..._args: unknown[]) => {
    calls.push('broadcast');
  });
  const publish = vi.fn((..._args: unknown[]) => {
    calls.push('publish');
  });
  const markDirty = vi.fn((..._args: unknown[]) => {
    calls.push('markDirty');
  });
  const scheduleSave = vi.fn((..._args: unknown[]) => {
    calls.push('scheduleSave');
  });
  const ports: SceneCommitPorts = {
    send: send as unknown as SceneCommitPorts['send'],
    broadcast: broadcast as unknown as SceneCommitPorts['broadcast'],
    publish: publish as unknown as SceneCommitPorts['publish'],
    markDirty: markDirty as unknown as SceneCommitPorts['markDirty'],
    scheduleSave: scheduleSave as unknown as SceneCommitPorts['scheduleSave'],
  };
  return { ports, calls, send, broadcast, publish, markDirty, scheduleSave };
}

function makeOrigin(
  roomId = 'room-1',
  userId = 'user-1',
  rejectReadOnlyMutation = vi.fn(() => false)
): LocalSceneOrigin & { rejectReadOnlyMutation: ReturnType<typeof vi.fn> } {
  return {
    kind: 'local',
    roomId,
    userId,
    ws: { readyState: 1 } as unknown as WebSocket,
    rejectReadOnlyMutation,
  };
}

function expectNoEffects(mocks: ReturnType<typeof makePorts>) {
  expect(mocks.markDirty).not.toHaveBeenCalled();
  expect(mocks.scheduleSave).not.toHaveBeenCalled();
  expect(mocks.broadcast).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
}

describe('sceneCommit', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
  });

  it('exports default ports wired to production modules', () => {
    expect(defaultSceneCommitPorts.send).toBeTypeOf('function');
    expect(defaultSceneCommitPorts.broadcast).toBeTypeOf('function');
    expect(defaultSceneCommitPorts.publish).toBeTypeOf('function');
    expect(defaultSceneCommitPorts.markDirty).toBeTypeOf('function');
    expect(defaultSceneCommitPorts.scheduleSave).toBeTypeOf('function');
  });

  describe('commitLocalSceneCommand', () => {
    it('commits add_element: marks dirty, schedules save, broadcasts excluding sender, publishes fire-and-forget', () => {
      const room = getOrCreateRoom('r1');
      const { ports, calls, broadcast, publish, markDirty, scheduleSave } = makePorts();
      const origin = makeOrigin('r1', 'u1');

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'add_element', element: el('a', 1) },
        origin,
        ports
      );

      expect(receipt).toEqual<CommitReceipt>({
        status: 'accepted',
        changed: true,
        delta: { type: 'scene-delta', added: [el('a', 1)] },
      });
      expect(room.elements.get('a')?.version).toBe(1);
      expect(calls).toEqual(['markDirty', 'scheduleSave', 'broadcast', 'publish']);
      expect(markDirty).toHaveBeenCalledWith('r1');
      expect(scheduleSave).toHaveBeenCalledWith('r1');
      expect(broadcast).toHaveBeenCalledWith(
        room,
        { type: 'scene-delta', added: [el('a', 1)] },
        'u1'
      );
      expect(publish).toHaveBeenCalledWith('r1', {
        type: 'scene-delta',
        added: [el('a', 1)],
      });
    });

    it('commits update_element as delta.updated', () => {
      const room = getOrCreateRoom('r2');
      room.elements.set('a', el('a', 1));
      const { ports, broadcast } = makePorts();
      const origin = makeOrigin('r2', 'u1');

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'update_element', element: el('a', 2) },
        origin,
        ports
      );

      expect(receipt.status).toBe('accepted');
      expect(receipt.delta).toEqual({ type: 'scene-delta', updated: [el('a', 2)] });
      expect(broadcast).toHaveBeenCalledWith(
        room,
        { type: 'scene-delta', updated: [el('a', 2)] },
        'u1'
      );
    });

    it('commits delete_element as delta.deleted', () => {
      const room = getOrCreateRoom('r3');
      room.elements.set('a', el('a', 1));
      const { ports, publish } = makePorts();
      const origin = makeOrigin('r3', 'u1');

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'delete_element', elementId: 'a' },
        origin,
        ports
      );

      expect(receipt).toEqual<CommitReceipt>({
        status: 'accepted',
        changed: true,
        delta: { type: 'scene-delta', deleted: ['a'] },
      });
      expect(room.elements.has('a')).toBe(false);
      expect(publish).toHaveBeenCalledWith('r3', {
        type: 'scene-delta',
        deleted: ['a'],
      });
    });

    it('enforces read-only defense in depth before any mutation or effect', () => {
      const room = getOrCreateRoom('r4');
      room.elements.set('a', el('a', 1));
      const mocks = makePorts();
      const reject = vi.fn(() => {
        // simulate session.send error reply side effect
        mocks.ports.send(origin.ws, { type: 'error', message: 'read-only' });
        return true;
      });
      const origin = makeOrigin('r4', 'u1', reject);

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'delete_element', elementId: 'a' },
        origin,
        mocks.ports
      );

      expect(receipt).toEqual({ status: 'read-only', changed: false });
      expect(reject).toHaveBeenCalled();
      expect(room.elements.has('a')).toBe(true);
      expect(mocks.markDirty).not.toHaveBeenCalled();
      expect(mocks.scheduleSave).not.toHaveBeenCalled();
      expect(mocks.broadcast).not.toHaveBeenCalled();
      expect(mocks.publish).not.toHaveBeenCalled();
    });

    it('rejects capacity for a new singleton element and sends capacity error', () => {
      const room = getOrCreateRoom('r5');
      for (let i = 0; i < 5000; i++) {
        room.elements.set(`e-${i}`, el(`e-${i}`, 1));
      }
      const mocks = makePorts();
      const origin = makeOrigin('r5', 'u1');

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'add_element', element: el('new', 1) },
        origin,
        mocks.ports
      );

      expect(receipt).toEqual({ status: 'capacity', changed: false });
      expect(room.elements.has('new')).toBe(false);
      expect(mocks.send).toHaveBeenCalledWith(origin.ws, {
        type: 'error',
        message: 'Scene is at capacity (5000 elements max)',
      });
      expectNoEffects(mocks);
    });

    it('dedups scene-delta by clientMsgId before admission effects and acks pong', () => {
      const room = getOrCreateRoom('r6');
      const mocks = makePorts();
      const origin = makeOrigin('r6', 'u1');
      const command = {
        type: 'scene-delta' as const,
        added: [el('a', 1)],
        clientMsgId: 'msg-1',
      };

      const first = commitLocalSceneCommand(room, command, origin, mocks.ports);
      expect(first.status).toBe('accepted');

      mocks.calls.length = 0;
      vi.clearAllMocks();
      const second = commitLocalSceneCommand(room, command, origin, mocks.ports);

      expect(second).toEqual({ status: 'deduped', changed: false });
      expect(mocks.send).toHaveBeenCalledWith(origin.ws, {
        type: 'pong',
        timestamp: expect.any(Number),
      });
      expectNoEffects(mocks);
      expect(room.mutationVersion).toBe(1);
    });

    it('preserves dedup-before-fence: stale no-change batch still consumes clientMsgId', () => {
      const room = getOrCreateRoom('r7');
      room.elements.set('a', el('a', 9));
      const mocks = makePorts();
      const origin = makeOrigin('r7', 'u1');

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'scene-delta', updated: [el('a', 1)], clientMsgId: 'stale-1' },
        origin,
        mocks.ports
      );

      expect(receipt.status).toBe('no-change');
      expect(room.recentMsgIds.has('stale-1')).toBe(true);
      expect(room.mutationVersion).toBe(0);
      expectNoEffects(mocks);
    });

    it('returns no-change with no effects when stale singleton is rejected', () => {
      const room = getOrCreateRoom('r8');
      room.elements.set('a', el('a', 5));
      const mocks = makePorts();
      const origin = makeOrigin('r8', 'u1');

      const receipt = commitLocalSceneCommand(
        room,
        { type: 'update_element', element: el('a', 2) },
        origin,
        mocks.ports
      );

      expect(receipt).toEqual({ status: 'no-change', changed: false });
      expect(room.elements.get('a')?.version).toBe(5);
      expectNoEffects(mocks);
    });
  });

  describe('applyRemoteSceneMessage', () => {
    it('accepts legacy remote add_element and returns filtered delta', () => {
      const room = getOrCreateRoom('rr1');
      const markDirty = vi.fn();
      const scheduleSave = vi.fn();

      const result = applyRemoteSceneMessage(
        room,
        { type: 'add_element', element: el('a', 1) },
        { markDirty, scheduleSave }
      );

      expect(result).toEqual({
        changed: true,
        delta: { type: 'scene-delta', added: [el('a', 1)] },
      });
      expect(markDirty).toHaveBeenCalledWith('rr1');
      expect(scheduleSave).toHaveBeenCalledWith('rr1');
    });

    it('accepts legacy remote scene-update and update_element wire types', () => {
      const room = getOrCreateRoom('rr2');
      room.elements.set('a', el('a', 1));

      const r1 = applyRemoteSceneMessage(room, {
        type: 'scene-update',
        elements: [el('b', 1)],
      });
      expect(r1.changed).toBe(true);
      expect(r1.delta?.added?.map(e => e.id)).toEqual(['b']);

      const r2 = applyRemoteSceneMessage(room, {
        type: 'update_element',
        element: el('a', 2),
      });
      expect(r2.changed).toBe(true);
      expect(r2.delta?.updated?.map(e => e.id)).toEqual(['a']);
    });

    it('rejects malformed/untrusted remote payloads with no effects', () => {
      const room = getOrCreateRoom('rr3');
      const markDirty = vi.fn();
      const scheduleSave = vi.fn();

      const result = applyRemoteSceneMessage(
        room,
        { type: 'add_element', element: { nope: true } },
        { markDirty, scheduleSave }
      );

      expect(result).toEqual({ changed: false });
      expect(room.elements.size).toBe(0);
      expect(markDirty).not.toHaveBeenCalled();
      expect(scheduleSave).not.toHaveBeenCalled();
    });

    it('drops over-capacity remote scene-delta wholesale', () => {
      const room = getOrCreateRoom('rr4');
      const added = Array.from({ length: 5001 }, (_, i) => el(`x-${i}`, 1));

      const result = applyRemoteSceneMessage(room, { type: 'scene-delta', added });

      expect(result).toEqual({ changed: false });
      expect(room.elements.size).toBe(0);
    });

    it('applies remote delete with tombstone and returns filtered delta', () => {
      const room = getOrCreateRoom('rr5');
      room.elements.set('a', el('a', 1));

      const result = applyRemoteSceneMessage(room, {
        type: 'delete_element',
        elementId: 'a',
      });

      expect(result).toEqual({
        changed: true,
        delta: { type: 'scene-delta', deleted: ['a'] },
      });
      expect(room.elements.has('a')).toBe(false);
    });

    it('returns no-change for unknown remote type', () => {
      const room = getOrCreateRoom('rr6');
      const result = applyRemoteSceneMessage(room, { type: 'cursor-update', x: 1 });
      expect(result).toEqual({ changed: false });
    });
  });
});
