/**
 * `applyRemoteSceneMessage` — the Redis fan-out trust boundary.
 *
 * Every other admission path in this server is reached from a socket that ran
 * `messageSchema` first. This one is not: it parses whatever arrived on the
 * `dripl:room:*` channel, from any peer instance, with no prior validation. It
 * had no test at all.
 *
 * Two properties matter beyond "it stores elements":
 *
 *   1. It applies before it forwards. `index.ts` only broadcasts a remote
 *      mutation if this returns true, because a replica that forwards without
 *      applying keeps a stale authoritative scene and resurrects the older copy
 *      on the next join or save.
 *   2. Capacity is decided *before* any element is stored, so an over-capacity
 *      remote batch is dropped whole rather than partially applied. A partial
 *      apply is not a recoverable state: the room is now over its cap and no
 *      local client can add anything to it until the peers' next save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { MAX_SCENE_ELEMENTS } from '@dripl/common';
import { getOrCreateRoom, rooms, saveTimeouts } from '../rooms';
import { applyRemoteSceneMessage } from '../sceneMutation';
import { deleteWithTombstone } from '../tombstones';
import type { DriplElement } from '@dripl/common';
import type { RoomState } from '../types';

const el = (id: string, version = 1): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  version,
  versionNonce: version,
});

function ids(room: RoomState): string[] {
  return [...room.elements.keys()].sort();
}

describe('applyRemoteSceneMessage', () => {
  beforeEach(() => {
    rooms.clear();
    saveTimeouts.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Real debounce timers: clear them so a suite-level timer never fires
    // against a room from a finished test.
    for (const timeout of saveTimeouts.values()) clearTimeout(timeout);
    saveTimeouts.clear();
  });

  it('ignores message types it does not relay and leaves the room clean', () => {
    // Regression: an unknown or non-scene type (a cursor, a presence ping, a
    // future protocol message) must not mark the room dirty. Marking it dirty
    // would schedule a fenced Postgres write for a change that never happened.
    const room = getOrCreateRoom('remote-unknown');
    expect(applyRemoteSceneMessage(room, { type: 'user-join', roomId: 'remote-unknown' })).toBe(
      false
    );
    expect(room.dirty).toBe(false);
    expect(room.mutationVersion).toBe(0);
    expect(saveTimeouts.has('remote-unknown')).toBe(false);
  });

  it('drops a malformed remote add rather than storing it', () => {
    // The channel is untrusted: any instance (or anything that can reach Redis)
    // can publish here. An unparseable element must be discarded, not stored
    // into the authoritative copy and then persisted.
    const room = getOrCreateRoom('remote-bad');
    expect(applyRemoteSceneMessage(room, { type: 'add_element', element: { nope: true } })).toBe(
      false
    );
    expect(room.elements.size).toBe(0);
    expect(room.dirty).toBe(false);
  });

  it('rejects a remote add with no element at all', () => {
    const room = getOrCreateRoom('remote-empty');
    expect(applyRemoteSceneMessage(room, { type: 'add_element' })).toBe(false);
    expect(room.dirty).toBe(false);
  });

  it('drops a remote add that would exceed scene capacity', () => {
    // Capacity must be enforced on this path too: this instance is the
    // authoritative writer for the room, so a peer's over-cap delta that
    // landed here would put the room over its cap with no local client able to
    // add anything afterwards.
    const room = getOrCreateRoom('remote-cap');
    for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
      room.elements.set(`full-${i}`, el(`full-${i}`) as unknown as DriplElement);
    }
    expect(
      applyRemoteSceneMessage(room, { type: 'add_element', element: el('one-too-many') })
    ).toBe(false);
    expect(room.elements.has('one-too-many')).toBe(false);
    expect(room.dirty).toBe(false);
  });

  it('treats a delete of an id this room never had as a no-op', () => {
    // A peer's delete arriving after the element was already removed here. No
    // tombstone may be written for an absent element, or the id is suppressed
    // from legitimate re-adds for 24h for no reason.
    const room = getOrCreateRoom('remote-del-missing');
    expect(applyRemoteSceneMessage(room, { type: 'delete_element', elementId: 'ghost' })).toBe(
      false
    );
    expect(room.tombstones.has('ghost')).toBe(false);
    expect(room.dirty).toBe(false);
  });

  it('ignores a delete whose elementId is not a string', () => {
    const room = getOrCreateRoom('remote-del-junk');
    room.elements.set('x', el('x') as unknown as DriplElement);
    expect(applyRemoteSceneMessage(room, { type: 'delete_element', elementId: 42 })).toBe(false);
    expect(room.elements.has('x')).toBe(true);
  });

  it('applies a remote element-update batch and marks the room for save', () => {
    const room = getOrCreateRoom('remote-batch');
    const applied = applyRemoteSceneMessage(room, {
      type: 'element-update',
      elements: [el('a'), el('b')],
    });
    expect(applied).toBe(true);
    expect(ids(room)).toEqual(['a', 'b']);
    expect(room.dirty).toBe(true);
    expect(room.mutationVersion).toBe(1);
    expect(saveTimeouts.has('remote-batch')).toBe(true);
  });

  it('falls back to the singleton form of element-update', () => {
    const room = getOrCreateRoom('remote-batch-single');
    expect(applyRemoteSceneMessage(room, { type: 'element-update', element: el('solo') })).toBe(
      true
    );
    expect(ids(room)).toEqual(['solo']);
  });

  it('applies a remote scene-update as additions, never as a replacement', () => {
    // The non-destructive `init`/`update` contract: a snapshot from a newly
    // connected peer may legitimately be incomplete, so ids absent from it must
    // survive. Treating it as a replacement would erase the room.
    const room = getOrCreateRoom('remote-scene-update');
    room.elements.set('existing', el('existing', 5) as unknown as DriplElement);
    expect(applyRemoteSceneMessage(room, { type: 'scene-update', elements: [el('fresh')] })).toBe(
      true
    );
    expect(ids(room)).toEqual(['existing', 'fresh']);
  });

  it('applies a stale remote delta element through the freshness fence only', () => {
    const room = getOrCreateRoom('remote-fence');
    room.elements.set('a', el('a', 7) as unknown as DriplElement);
    // Everything in the batch loses the fence, so nothing changed: reporting
    // `true` would broadcast the batch onward and mark the room dirty for a
    // scene that did not move.
    expect(
      applyRemoteSceneMessage(room, {
        type: 'scene-delta',
        added: [el('a', 2)],
        updated: [el('a', 1)],
      })
    ).toBe(false);
    expect(room.elements.get('a')?.version).toBe(7);
    expect(room.dirty).toBe(false);
  });

  it('does not resurrect an element a peer deleted on itself', () => {
    // The tombstone fence on the remote path: a peer's in-flight add for an id
    // this room deleted must lose, or the delete silently un-happens on this
    // replica and gets persisted over the winner.
    const room = getOrCreateRoom('remote-tomb');
    room.elements.set('x', el('x', 2) as unknown as DriplElement);
    deleteWithTombstone(room, 'x');
    expect(applyRemoteSceneMessage(room, { type: 'add_element', element: el('x', 2) })).toBe(false);
    expect(room.elements.has('x')).toBe(false);
    expect(room.dirty).toBe(false);
  });

  it('rejects an over-capacity remote delta whole, without applying its deletes', () => {
    // The all-or-nothing property. Applying the deletes and then refusing the
    // adds would commit half a peer transaction: elements destroyed, the room
    // left over capacity, and no way for a client to recover.
    const room = getOrCreateRoom('remote-delta-cap');
    for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
      room.elements.set(`full-${i}`, el(`full-${i}`) as unknown as DriplElement);
    }
    expect(
      applyRemoteSceneMessage(room, {
        type: 'scene-delta',
        added: [el('brand-new')],
        deleted: ['full-0'],
      })
    ).toBe(false);
    expect(room.elements.has('brand-new')).toBe(false);
    expect(room.elements.has('full-0')).toBe(true);
    expect(room.dirty).toBe(false);
  });

  it('counts added and updated together against capacity', () => {
    // A peer splitting a large move across `added` and `updated` must not get
    // two independent capacity budgets.
    const room = getOrCreateRoom('remote-delta-cap-2');
    for (let i = 0; i < MAX_SCENE_ELEMENTS - 1; i++) {
      room.elements.set(`full-${i}`, el(`full-${i}`) as unknown as DriplElement);
    }
    expect(
      applyRemoteSceneMessage(room, {
        type: 'scene-delta',
        added: [el('n1')],
        updated: [el('n2')],
      })
    ).toBe(false);
    expect(room.dirty).toBe(false);
  });

  it('applies a remote delete as a versioned tombstone, not a bare map delete', () => {
    // The delete must be versioned so a stale concurrent edit from anywhere
    // loses instead of resurrecting the element.
    const room = getOrCreateRoom('remote-delta-del');
    room.elements.set('x', el('x', 3) as unknown as DriplElement);
    expect(applyRemoteSceneMessage(room, { type: 'scene-delta', deleted: ['x'] })).toBe(true);
    expect(room.elements.has('x')).toBe(false);
    expect(room.tombstones.get('x')?.version).toBe(4);
    expect(room.dirty).toBe(true);
  });

  it('ignores a remote delta that names nothing to change', () => {
    const room = getOrCreateRoom('remote-delta-empty');
    expect(applyRemoteSceneMessage(room, { type: 'scene-delta', deleted: ['never-existed'] })).toBe(
      false
    );
    expect(room.tombstones.size).toBe(0);
    expect(room.dirty).toBe(false);
  });

  it('survives non-array fields where the protocol expects arrays', () => {
    // A peer on a different revision, or a hand-published payload. Every field
    // is checked before use, so none of these may throw out of the fan-out
    // handler — an exception here runs from Upstash's dispatch, not from a
    // try/catch this server controls.
    const room = getOrCreateRoom('remote-junk-fields');
    expect(applyRemoteSceneMessage(room, { type: 'scene-update', elements: 'nope' })).toBe(false);
    expect(
      applyRemoteSceneMessage(room, {
        type: 'scene-delta',
        added: 'nope',
        updated: { nope: true },
        deleted: [null, 7, {}],
      })
    ).toBe(false);
    expect(room.dirty).toBe(false);
  });
});
