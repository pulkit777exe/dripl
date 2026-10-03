/**
 * The rest of `rooms.ts`: the load path, the `canvasRoom` branch of the fenced
 * write, the merge-retry's failure modes, and the debounce timer that bounds
 * what a crash can lose.
 *
 * `rooms.persistence.test.ts` covers the `file` happy path and two merge
 * outcomes. What it does not cover is the part that decides *how much work can
 * be lost*: `scheduleSave`'s re-arm policy, and the paths where a bad read or a
 * bad write leaves the room dirty. A regression in either is silent data loss
 * — the room looks healthy in memory and the row in Postgres is stale forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { MAX_SCENE_ELEMENTS } from '@dripl/common';
import type { DriplElement } from '@dripl/common';
import {
  MAX_EMPTY_ROOM_TTL_MS,
  SAVE_DEBOUNCE_MS,
  getOrCreateRoom,
  loadRoomElements,
  markRoomDirty,
  parseStoredElements,
  rooms,
  saveRoomElements,
  saveTimeouts,
  scheduleSave,
} from '../rooms';
import { deleteWithTombstone } from '../tombstones';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const T1 = new Date('2026-01-01T00:00:01.000Z');
const T2 = new Date('2026-01-01T00:00:02.000Z');

const rect = (id: string, version = 1): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  version,
  versionNonce: version,
});

const stored = (elements: Record<string, unknown>[], extra: object = {}) =>
  JSON.stringify({ elements, ...extra });

function writtenContent(model: { mock: { calls: unknown[][] } }, index = 0): string {
  const call = model.mock.calls[index];
  if (!call) throw new Error(`no write at index ${index}`);
  return (call[0] as { data: { content: string } }).data.content;
}

describe('parseStoredElements: malformed stored content', () => {
  // The deliberate swallow. A column that is not parseable must not crash a
  // join: the room loads empty and the client re-sends its scene. What matters
  // is that the swallow is *bounded* — it returns exactly `[]`, never a
  // partially-trusted structure — and that it cannot escalate into a write of
  // the truncated value over a healthy row.
  it('returns an empty scene for unparseable content instead of throwing', () => {
    expect(() => parseStoredElements('{"elements": [ truncated')).not.toThrow();
    expect(parseStoredElements('{"elements": [ truncated')).toEqual([]);
  });

  it('returns an empty scene for content that is neither an array nor an envelope', () => {
    expect(parseStoredElements('42')).toEqual([]);
    expect(parseStoredElements('"a string"')).toEqual([]);
    expect(parseStoredElements('null')).toEqual([]);
    // An object whose `elements` is not an array: the envelope key exists, so
    // this is the shape most likely to be trusted by mistake.
    expect(parseStoredElements('{"elements": {"a": 1}}')).toEqual([]);
    expect(parseStoredElements('{"elements": null}')).toEqual([]);
  });

  it('treats missing, empty, and nullish content as an empty scene', () => {
    expect(parseStoredElements(null)).toEqual([]);
    expect(parseStoredElements(undefined)).toEqual([]);
    expect(parseStoredElements('')).toEqual([]);
  });

  it('accepts both the bare array and the enveloped shape', () => {
    // Historical rows are bare arrays; current rows are enveloped. Refusing
    // either shape silently empties a room on load.
    expect(parseStoredElements(stored([rect('a')])).map(e => e.id)).toEqual(['a']);
    expect(parseStoredElements(JSON.stringify([rect('b')])).map(e => e.id)).toEqual(['b']);
  });

  it('caps a stored scene at the scene limit', () => {
    const huge = Array.from({ length: MAX_SCENE_ELEMENTS + 10 }, (_, i) => rect(`e-${i}`));
    expect(parseStoredElements(stored(huge))).toHaveLength(MAX_SCENE_ELEMENTS);
  });
});

describe('loadRoomElements', () => {
  beforeEach(() => {
    rooms.clear();
    saveTimeouts.clear();
    vi.clearAllMocks();
  });

  it('loads a file row and remembers the fence and envelope for later saves', async () => {
    dbMock.file.findUnique.mockResolvedValue({
      content: stored([rect('a')], {
        encryptedPayload: { iv: 'iv-1', data: 'cipher' },
        encryptedAt: '2026-01-01T00:00:00.000Z',
        appState: { zoom: 2 },
      }),
      updatedAt: T1,
    });
    const room = getOrCreateRoom('file-load');

    const elements = await loadRoomElements('file-load');

    expect([...elements.keys()]).toEqual(['a']);
    // Without the remembered fence the next save would write unfenced and
    // clobber a concurrent writer.
    expect(room.recordType).toBe('file');
    expect(room.lastPersistedUpdatedAt).toEqual(T1);
    expect(room.storedMetadata).toEqual({
      encryptedPayload: { iv: 'iv-1', data: 'cipher' },
      encryptedAt: '2026-01-01T00:00:00.000Z',
      appState: { zoom: 2 },
    });
  });

  it('falls back to the canvas room row and tags the record type', async () => {
    // Both persistence models share this transport; writing a canvas-room
    // scene back into the `file` table (or refusing to save at all) would lose
    // it outright.
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue({
      content: stored([rect('c')]),
      updatedAt: T1,
    });
    const room = getOrCreateRoom('canvas-load');

    const elements = await loadRoomElements('canvas-load');

    expect([...elements.keys()]).toEqual(['c']);
    expect(room.recordType).toBe('canvasRoom');
    expect(room.lastPersistedUpdatedAt).toEqual(T1);
  });

  it('returns an empty scene when no row exists anywhere', async () => {
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    expect((await loadRoomElements('nothing')).size).toBe(0);
  });
});

describe('canvasRoom fenced writes', () => {
  beforeEach(() => {
    rooms.clear();
    saveTimeouts.clear();
    vi.clearAllMocks();
  });

  it('writes to the canvas room row behind its own updatedAt fence', async () => {
    dbMock.canvasRoom.updateManyAndReturn.mockResolvedValue([{ updatedAt: T2 }]);
    const room = getOrCreateRoom('canvas-save');
    room.recordType = 'canvasRoom';
    room.lastPersistedUpdatedAt = T1;
    room.elements.set('x', rect('x') as unknown as DriplElement);

    await expect(saveRoomElements('canvas-save', room.elements)).resolves.toBe(true);

    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(dbMock.canvasRoom.updateManyAndReturn).toHaveBeenCalledWith({
      where: { slug: 'canvas-save', updatedAt: T1 },
      data: { content: expect.stringContaining('"x"') },
      select: { updatedAt: true },
    });
    expect(room.lastPersistedUpdatedAt).toEqual(T2);
  });

  it('merges and retries rather than losing the scene when the fence is lost', async () => {
    dbMock.canvasRoom.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ updatedAt: T2 }]);
    dbMock.canvasRoom.findUnique.mockResolvedValue({
      content: stored([rect('peer', 1)]),
      updatedAt: T1,
    });
    const room = getOrCreateRoom('canvas-conflict');
    room.recordType = 'canvasRoom';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('mine', rect('mine', 1) as unknown as DriplElement);

    await expect(saveRoomElements('canvas-conflict', room.elements)).resolves.toBe(true);

    // Both the local edit and the peer's stored-only element survive, and the
    // retry was fenced on the re-read timestamp rather than the stale one.
    expect(writtenContent(dbMock.canvasRoom.updateManyAndReturn, 1)).toContain('"mine"');
    expect(writtenContent(dbMock.canvasRoom.updateManyAndReturn, 1)).toContain('"peer"');
    expect(room.elements.has('peer')).toBe(true);
    expect(dbMock.canvasRoom.updateManyAndReturn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ where: { slug: 'canvas-conflict', updatedAt: T1 } })
    );
  });

  it('probes a canvas room for a room that never loaded, instead of writing unfenced', async () => {
    // The probe closes an unfenced-write hole: the room has no row identity
    // because it never loaded (or its row vanished), and a write without a
    // fence silently overwrites whatever is there now.
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue({ content: stored([]), updatedAt: T1 });
    dbMock.canvasRoom.updateManyAndReturn.mockResolvedValue([{ updatedAt: T2 }]);
    const room = getOrCreateRoom('canvas-probe');
    room.elements.set('x', rect('x') as unknown as DriplElement);

    await expect(saveRoomElements('canvas-probe', room.elements)).resolves.toBe(true);

    expect(room.recordType).toBe('canvasRoom');
    expect(dbMock.canvasRoom.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'canvas-probe', updatedAt: T1 } })
    );
  });

  it('stays dirty when neither table has a row for the room', async () => {
    dbMock.file.findUnique.mockResolvedValue(null);
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    const room = getOrCreateRoom('nowhere');
    room.elements.set('x', rect('x') as unknown as DriplElement);
    room.dirty = true;

    await expect(saveRoomElements('nowhere', room.elements)).resolves.toBe(false);
    expect(room.dirty).toBe(true);
  });
});

describe('merge-retry failure modes', () => {
  beforeEach(() => {
    rooms.clear();
    saveTimeouts.clear();
    vi.clearAllMocks();
  });

  it('keeps memory when the merge re-read fails outright', async () => {
    // The re-read is the only way to know what the winner contains. If it
    // throws, retrying blindly would overwrite the winner with this room's
    // copy. Refusing keeps the room dirty so a later tick retries.
    dbMock.file.updateManyAndReturn.mockResolvedValue([]);
    dbMock.file.findUnique.mockRejectedValue(new Error('connection reset'));
    const room = getOrCreateRoom('merge-read-fail');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('mine', rect('mine') as unknown as DriplElement);
    room.dirty = true;

    await expect(saveRoomElements('merge-read-fail', room.elements)).resolves.toBe(false);
    expect(room.dirty).toBe(true);
    expect(room.elements.has('mine')).toBe(true);
  });

  it('keeps memory when the merge retry write throws', async () => {
    dbMock.file.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('deadlock'));
    dbMock.file.findUnique.mockResolvedValue({ content: stored([rect('peer')]), updatedAt: T1 });
    const room = getOrCreateRoom('merge-write-fail');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('mine', rect('mine') as unknown as DriplElement);

    await expect(saveRoomElements('merge-write-fail', room.elements)).resolves.toBe(false);
    // Nothing was adopted from a write that did not land, so the next attempt
    // still re-reads and re-merges rather than assuming the peer is in memory.
    expect(room.elements.has('peer')).toBe(false);
    expect(room.elements.has('mine')).toBe(true);
  });

  it('reports failure without writing when the whole save throws', async () => {
    dbMock.file.updateManyAndReturn.mockRejectedValue(new Error('pool exhausted'));
    const room = getOrCreateRoom('save-throw');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('x', rect('x') as unknown as DriplElement);

    await expect(saveRoomElements('save-throw', room.elements)).resolves.toBe(false);
    expect(room.saving).toBe(false);
  });

  it('does not let a malformed winner wipe the room it is merging into', async () => {
    // The exact data-loss shape this task was pointed at: the fence is lost, the
    // re-read returns garbage, and a naive "stored wins" merge would persist the
    // empty parse over a healthy in-memory scene. `mergeMemoryWithStored` starts
    // from the stored set and *adds* memory, so memory survives.
    dbMock.file.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ updatedAt: T2 }]);
    dbMock.file.findUnique.mockResolvedValue({ content: '{"elements": [trunc', updatedAt: T1 });
    const room = getOrCreateRoom('merge-malformed');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('healthy', rect('healthy') as unknown as DriplElement);

    await expect(saveRoomElements('merge-malformed', room.elements)).resolves.toBe(true);
    expect(room.elements.has('healthy')).toBe(true);
    expect(writtenContent(dbMock.file.updateManyAndReturn, 1)).toContain('"healthy"');
  });

  it('does not resurrect an element it deleted when the winner is malformed', async () => {
    // Same shape, with a tombstone: the delete must survive a garbage re-read.
    dbMock.file.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ updatedAt: T2 }]);
    dbMock.file.findUnique.mockResolvedValue({ content: 'not json at all', updatedAt: T1 });
    const room = getOrCreateRoom('merge-malformed-del');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('x', rect('x', 2) as unknown as DriplElement);
    deleteWithTombstone(room, 'x');

    await expect(saveRoomElements('merge-malformed-del', room.elements)).resolves.toBe(true);
    expect(room.elements.has('x')).toBe(false);
    expect(room.tombstones.has('x')).toBe(true);
  });

  it('sheds the stalest stored-only elements when the union would overflow', async () => {
    // Capacity is enforced on admission, but a merge unions two capped scenes.
    // Persisting an over-cap scene is not an option — no client could have
    // built it — so the oldest stored-only survivors are dropped and this
    // room's own elements are never shed.
    dbMock.file.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ updatedAt: T2 }]);
    // A full stored row plus two ids this room holds that it does not: the
    // union is over the cap, so something has to go.
    const storedElements = Array.from({ length: MAX_SCENE_ELEMENTS }, (_, i) => ({
      ...rect(`peer-${i}`, 1),
      version: i + 1,
    }));
    dbMock.file.findUnique.mockResolvedValue({
      content: stored(storedElements),
      updatedAt: T1,
    });
    const room = getOrCreateRoom('merge-overflow');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T0;
    room.elements.set('mine-a', rect('mine-a') as unknown as DriplElement);
    room.elements.set('mine-b', rect('mine-b') as unknown as DriplElement);

    await expect(saveRoomElements('merge-overflow', room.elements)).resolves.toBe(true);

    const persisted = JSON.parse(writtenContent(dbMock.file.updateManyAndReturn, 1)) as {
      elements: Array<{ id: string }>;
    };
    const persistedIds = persisted.elements.map(e => e.id);
    // Exactly at the cap: no client could have built an over-cap scene, and
    // persisting one would wedge every future add in the room.
    expect(persistedIds).toHaveLength(MAX_SCENE_ELEMENTS);
    // This room's own elements are never shed — only stored-only survivors are.
    expect(persistedIds).toContain('mine-a');
    expect(persistedIds).toContain('mine-b');
    // And the ones shed are the stalest of them.
    expect(persistedIds).not.toContain('peer-0');
    expect(persistedIds).not.toContain('peer-1');
    expect(persistedIds).toContain('peer-4999');
  });

  it('refuses to write when the room no longer exists in memory', async () => {
    // A debounced save can fire after the room was GC'd. Writing without the
    // load-time envelope would erase the row's share/appState metadata.
    await expect(saveRoomElements('vanished', new Map())).resolves.toBe(false);
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
  });
});

describe('saved scene shape', () => {
  beforeEach(() => {
    rooms.clear();
    saveTimeouts.clear();
    vi.clearAllMocks();
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: T2 }]);
  });

  it('orders the persisted scene by fractional index', async () => {
    // Z-order is the stored contract: the client re-derives layering from it,
    // so an insertion-ordered save changes what every client draws.
    const room = getOrCreateRoom('order');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T1;
    room.elements.set('late', {
      ...rect('late'),
      fractionalIndex: 'a5',
    } as unknown as DriplElement);
    room.elements.set('early', {
      ...rect('early'),
      fractionalIndex: 'a0',
    } as unknown as DriplElement);

    await saveRoomElements('order', room.elements);

    const parsed = JSON.parse(writtenContent(dbMock.file.updateManyAndReturn)) as {
      elements: Array<{ id: string }>;
    };
    expect(parsed.elements.map(e => e.id)).toEqual(['early', 'late']);
  });

  it('omits the envelope entirely when there is no metadata to preserve', async () => {
    const room = getOrCreateRoom('bare');
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T1;
    await saveRoomElements('bare', room.elements);
    expect(writtenContent(dbMock.file.updateManyAndReturn)).toBe('{"elements":[]}');
  });
});

describe('markRoomDirty', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('ignores an unknown room rather than creating one', () => {
    // Creating state here would resurrect a GC'd room purely from a stale
    // reference, leaving an empty room pinned to this process forever.
    markRoomDirty('never-existed');
    expect(rooms.has('never-existed')).toBe(false);
  });

  it('advances the mutation version exactly once per call', () => {
    const room = getOrCreateRoom('dirty');
    expect(room.mutationVersion).toBe(0);
    markRoomDirty('dirty');
    markRoomDirty('dirty');
    expect(room.dirty).toBe(true);
    expect(room.mutationVersion).toBe(2);
  });
});

describe('scheduleSave debounce policy', () => {
  beforeEach(() => {
    rooms.clear();
    saveTimeouts.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: T2 }]);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function dirtyRoom(id: string) {
    const room = getOrCreateRoom(id);
    room.recordType = 'file';
    room.lastPersistedUpdatedAt = T1;
    room.elements.set('x', rect('x') as unknown as DriplElement);
    room.dirty = true;
    return room;
  }

  it('coalesces a burst of mutations into one write', async () => {
    // 200 mutations must cost one fenced write, not 200: this is the write
    // amplification bound that keeps a busy room affordable.
    dirtyRoom('burst');
    for (let i = 0; i < 200; i++) scheduleSave('burst');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('stops rearming once the room is saved and clean', async () => {
    // A room that re-arms forever never releases its debounce handle and is
    // paid a write on every interval for the life of the process.
    dirtyRoom('clean-after');
    scheduleSave('clean-after');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saveTimeouts.has('clean-after')).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 4);
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('rearms when a mutation landed while the write was in flight', async () => {
    // The load-bearing case. Clearing dirty on a write that started before the
    // last mutation is what loses edits: the row is written, the in-memory
    // change is marked clean, and it is never written again.
    const room = dirtyRoom('mid-flight');
    scheduleSave('mid-flight');
    dbMock.file.updateManyAndReturn.mockImplementationOnce(async () => {
      // A mutation lands while the *first* UPDATE is on the wire. The second
      // pass must find the room quiet, or this test cannot tell "re-armed and
      // then succeeded" from "re-armed forever".
      room.elements.set('y', rect('y') as unknown as DriplElement);
      room.dirty = true;
      room.mutationVersion += 1;
      return [{ updatedAt: T2 }];
    });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect(room.dirty).toBe(true);
    expect(saveTimeouts.has('mid-flight')).toBe(true);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(writtenContent(dbMock.file.updateManyAndReturn, 1)).toContain('"y"');
    expect(room.dirty).toBe(false);
  });

  it('keeps retrying after a failed write instead of dropping pending work', async () => {
    // A transient database failure must not convert into a lost edit. The room
    // stays dirty and visible until a later attempt succeeds.
    const room = dirtyRoom('flaky');
    scheduleSave('flaky');
    dbMock.file.updateManyAndReturn
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue([{ updatedAt: T2 }]);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(room.dirty).toBe(true);
    expect(saveTimeouts.has('flaky')).toBe(true);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(room.dirty).toBe(false);
    expect(dbMock.file.updateManyAndReturn).toHaveBeenCalledTimes(2);
  });

  it('drops the handle when the room vanished before the timer fired', async () => {
    // GC races the debounce. A leaked entry makes shutdown clear a handle for a
    // room that no longer exists and keeps the map growing.
    dirtyRoom('gc-race');
    scheduleSave('gc-race');
    rooms.delete('gc-race');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saveTimeouts.has('gc-race')).toBe(false);
    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('rearms when the periodic tick already owns the write', async () => {
    // `busy` means another writer has the room; the debounce must come back
    // rather than assume that writer will also clear this room's dirt.
    const room = dirtyRoom('busy');
    scheduleSave('busy');
    dbMock.file.updateManyAndReturn.mockImplementation(async () => {
      // Simulate the periodic tick holding `saving` for this room.
      getOrCreateRoom('busy').saving = true;
      return [];
    });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saveTimeouts.has('busy')).toBe(true);
    expect(room.dirty).toBe(true);
  });

  it('leaves the periodic-save interval and the empty-room TTL alone', () => {
    // Pinned because these two constants are the numbers the architecture
    // documents as "what a crash can lose" and "how long an idle room is held".
    expect(SAVE_DEBOUNCE_MS).toBe(2_000);
    expect(MAX_EMPTY_ROOM_TTL_MS).toBe(5 * 60 * 1000);
  });
});
