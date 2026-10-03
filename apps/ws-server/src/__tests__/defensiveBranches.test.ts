/**
 * The remaining defensive branches, gathered in one file because each is small
 * and none deserves a suite of its own. What they have in common is that each
 * is a place where the code decided a hostile or broken input must be handled
 * without throwing and without touching durable state.
 *
 * Where a branch is genuinely unreachable (and says so in its own comment), it
 * is left uncovered rather than contrived — see the task report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import {
  getOrCreateRoom,
  loadRoomElements,
  rooms,
  saveRoomElements,
  saveTimeouts,
  scheduleSave,
} from '../rooms';
import { applyRemoteSceneMessage, wouldExceedSceneCapacity } from '../sceneMutation';
import type { RoomState } from '../types';

const rect = (id: string, version = 1) =>
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

const T1 = new Date('2026-01-01T00:00:01.000Z');

function clearSaveTimers(): void {
  for (const timeout of saveTimeouts.values()) clearTimeout(timeout);
  saveTimeouts.clear();
}

describe('capacity accounting ignores entries that are not elements', () => {
  beforeEach(() => {
    rooms.clear();
    clearSaveTimers();
    vi.clearAllMocks();
  });

  afterEach(clearSaveTimers);

  it('does not count nulls, primitives, arrays, or id-less objects as new ids', () => {
    // The remote channel carries whatever a peer published. Counting a garbage
    // entry as a new id would consume the room's usable capacity on every
    // malformed message; under-counting would let the scene pass the cap. The
    // only correct answer is that none of these are elements at all.
    const room = getOrCreateRoom('cap-junk');
    expect(
      wouldExceedSceneCapacity(room, [
        null,
        undefined,
        42,
        'string',
        [],
        {},
        { id: 42 },
        { noId: true },
        rect('real'),
      ])
    ).toBe(false);
  });

  it('counts one id repeated across a batch exactly once', () => {
    // The admission funnel deduplicates by id before storing, so capacity has
    // to agree with it: a peer that resends the same new id in every slot must
    // consume one slot, or a legitimate batch is refused because the scene is
    // "full".
    const room = getOrCreateRoom('cap-repeat');
    const batch = Array.from({ length: 50 }, () => rect('same-id'));
    expect(wouldExceedSceneCapacity(room, batch)).toBe(false);
    expect(applyRemoteSceneMessage(room, { type: 'scene-delta', added: batch })).toBe(true);
    expect(room.elements.size).toBe(1);
  });
});

describe('remote add path', () => {
  beforeEach(() => {
    rooms.clear();
    clearSaveTimers();
    vi.clearAllMocks();
  });

  afterEach(clearSaveTimers);

  it('applies a peer add, marks the room, and schedules the save', () => {
    // The success arm of the remote funnel, and the one `index.ts` gates its
    // broadcast on. If this returned false the delta would be applied but never
    // relayed, so two instances' clients would diverge while their owners stayed
    // consistent with each other.
    const room = getOrCreateRoom('remote-add-ok') as RoomState;
    expect(applyRemoteSceneMessage(room, { type: 'add_element', element: rect('from-peer') })).toBe(
      true
    );
    expect(room.elements.has('from-peer')).toBe(true);
    expect(room.dirty).toBe(true);
    expect(room.mutationVersion).toBe(1);
    expect(saveTimeouts.has('remote-add-ok')).toBe(true);
  });

  it('applies a peer update the same way', () => {
    const room = getOrCreateRoom('remote-update-ok') as RoomState;
    room.elements.set('a', rect('a', 1));
    expect(applyRemoteSceneMessage(room, { type: 'update_element', element: rect('a', 2) })).toBe(
      true
    );
    expect(room.elements.get('a')?.version).toBe(2);
    expect(room.dirty).toBe(true);
  });

  it('works on a room built without a tombstone map', () => {
    // `getOrCreateRoom` always supplies one in production, but the tombstone
    // helpers create it lazily on purpose so a room assembled elsewhere is not a
    // crash. A `room.tombstones.get` without that guard would throw inside the
    // Redis dispatch, where nothing catches it.
    const room = {
      roomId: 'no-tombstones',
      elements: new Map<string, DriplElement>(),
      users: new Map(),
      cursors: new Map(),
      loadedFromDb: true,
      saving: false,
      dirty: false,
      mutationVersion: 0,
      recentMsgIds: new Set<string>(),
      elementLocks: new Map(),
      following: new Map(),
      viewports: new Map(),
    } as unknown as RoomState;
    expect(applyRemoteSceneMessage(room, { type: 'add_element', element: rect('a') })).toBe(true);
    expect(room.tombstones).toBeInstanceOf(Map);
  });
});

describe('the load-time scene envelope', () => {
  beforeEach(() => {
    rooms.clear();
    vi.clearAllMocks();
    dbMock.canvasRoom.findUnique.mockResolvedValue(null);
    dbMock.file.updateManyAndReturn.mockResolvedValue([{ updatedAt: T1 }]);
  });

  /** What a later save would write — the envelope's only consumer. */
  async function envelopeSeenBySave(roomId: string): Promise<Record<string, unknown>> {
    const room = getOrCreateRoom(roomId);
    room.elements.set('marker', rect('marker'));
    await saveRoomElements(roomId, room.elements);
    const call = dbMock.file.updateManyAndReturn.mock.calls[0];
    if (!call) throw new Error('nothing was written');
    return JSON.parse((call[0] as { data: { content: string } }).data.content) as Record<
      string,
      unknown
    >;
  }

  it('is absent when the stored scene has none', async () => {
    // The envelope is captured at load and reused on every save. A row with no
    // envelope must leave the room with an empty one rather than keeping a
    // previous room's — otherwise one room's share payload gets written into
    // another room's row.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({ elements: [] }),
      updatedAt: T1,
    });
    const room = getOrCreateRoom('meta-none');
    await loadRoomElements('meta-none');
    expect(room.storedMetadata).toEqual({});
    expect(await envelopeSeenBySave('meta-none')).toEqual({
      elements: [expect.objectContaining({ id: 'marker' })],
    });
  });

  it('is carried through to the next save when present', async () => {
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({
        elements: [],
        encryptedPayload: { iv: 'iv', data: 'cipher' },
        encryptedAt: '2026-01-01T00:00:00.000Z',
      }),
      updatedAt: T1,
    });
    await loadRoomElements('meta-some');
    expect(await envelopeSeenBySave('meta-some')).toMatchObject({
      encryptedPayload: { iv: 'iv', data: 'cipher' },
      encryptedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('reads a malformed envelope as absent rather than as a load failure', async () => {
    // `encryptedPayload` present but not `{iv, data}` must not crash a join and
    // must not become a half-populated envelope that a later save writes back.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({
        elements: [],
        encryptedPayload: { nope: true },
        appState: ['not', 'an', 'object'],
      }),
      updatedAt: T1,
    });
    const room = getOrCreateRoom('meta-malformed');
    expect((await loadRoomElements('meta-malformed')).size).toBe(0);
    expect(room.storedMetadata).toEqual({});
  });

  it('accepts a flat {iv, data} envelope as well as the nested one', async () => {
    // Two shapes exist in the column. Reading only one loses the share payload
    // on the next save, which silently un-breaks a share link.
    dbMock.file.findUnique.mockResolvedValue({
      content: JSON.stringify({ elements: [], iv: 'flat-iv', data: 'flat-data' }),
      updatedAt: T1,
    });
    await loadRoomElements('meta-flat');
    expect(await envelopeSeenBySave('meta-flat')).toMatchObject({
      encryptedPayload: { iv: 'flat-iv', data: 'flat-data' },
    });
  });
});

describe('a stale debounce handle on an already-clean room', () => {
  beforeEach(() => {
    rooms.clear();
    clearSaveTimers();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    clearSaveTimers();
  });

  it('drops the handle without writing', async () => {
    // A debounce that fires after the room was already saved and cleaned: a
    // redundant fenced UPDATE for identical content, and if the handle were
    // re-armed the room would look permanently scheduled to a process that has
    // nothing to write.
    const room = getOrCreateRoom('clean-debounce');
    room.recordType = 'file';
    room.dirty = false;
    scheduleSave('clean-debounce');

    await vi.advanceTimersByTimeAsync(10_000);

    expect(dbMock.file.updateManyAndReturn).not.toHaveBeenCalled();
    expect(dbMock.canvasRoom.updateManyAndReturn).not.toHaveBeenCalled();
    expect(saveTimeouts.has('clean-debounce')).toBe(false);
  });
});
