import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { getOrCreateRoom, rooms } from '../rooms';
import { deleteWithTombstone } from '../tombstones';
import {
  acceptAllParsed,
  acceptElement,
  acceptSingleValidated,
  acceptValidated,
  noteClientMsgId,
  sceneCapacityMessage,
  toDriplElement,
  wouldExceedSceneCapacity,
} from '../sceneMutation';
import type { DriplElement } from '@dripl/common';
import { MAX_SCENE_ELEMENTS } from '@dripl/common';

const el = (id: string, version = 1): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  version,
  versionNonce: 1,
});

describe('sceneMutation', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('toDriplElement parses a valid element and throws on garbage', () => {
    expect(toDriplElement(el('a')).id).toBe('a');
    expect(() => toDriplElement({ nope: true })).toThrow();
  });

  it('acceptElement stores new elements and enforces the version fence', () => {
    const room = getOrCreateRoom('m1');
    expect(acceptElement(room, el('a', 1))?.id).toBe('a');
    expect(acceptElement(room, el('a', 1))).toBeNull();
    expect(acceptElement(room, el('a', 2))?.version).toBe(2);
    expect(acceptElement(room, { nope: true })).toBeNull();
  });

  it('acceptValidated stores fence-passing elements without re-parsing', () => {
    // Fast path for dispatch-validated input: same fence as acceptElement,
    // no Zod cost. Invalid input can never arrive here — messageSchema is
    // the single gate (see sceneDeltaSchema tests).
    const room = getOrCreateRoom('v1');
    room.elements.set('a', el('a', 2) as unknown as DriplElement);
    const into: DriplElement[] = [];
    acceptValidated(
      room,
      [el('a', 1) as unknown as DriplElement, el('b', 1) as unknown as DriplElement],
      into
    );
    expect(into.map(e => e.id)).toEqual(['b']);
    expect(room.elements.get('a')?.version).toBe(2);
    expect(room.elements.get('b')?.version).toBe(1);
  });

  it('acceptAllParsed parses, fences, and tombstone-guards remote batches', () => {
    // The Redis trust boundary: independent parse, same fence as the local
    // funnel. A stale edit and garbage are dropped; the tombstone fence
    // applies (this is what the deleted acceptAll never had).
    const room = getOrCreateRoom('m2');
    room.elements.set('a', el('a', 2) as unknown as DriplElement);
    room.elements.set('t', el('t', 1) as unknown as DriplElement);
    deleteWithTombstone(room, 't');
    const into: DriplElement[] = [];
    acceptAllParsed(room, [el('a', 1), el('b', 1), { nope: true }, el('t', 1)], into);
    expect(into.map(e => e.id)).toEqual(['b']);
    expect(room.elements.get('a')?.version).toBe(2);
    expect(room.elements.has('t')).toBe(false);
  });

  it('acceptAllParsed drops over-capacity remote batches wholesale', () => {
    const room = getOrCreateRoom('m2cap');
    const into: DriplElement[] = [];
    const huge = Array.from({ length: MAX_SCENE_ELEMENTS + 1 }, (_, i) => el(`x-${i}`, 1));
    acceptAllParsed(room, huge, into);
    expect(into).toEqual([]);
    expect(room.elements.size).toBe(0);
  });

  it('acceptSingleValidated funnels capacity, tombstone, and freshness in order', () => {
    const room = getOrCreateRoom('s1');
    room.elements.set('a', el('a', 2) as unknown as DriplElement);
    room.elements.set('t', el('t', 1) as unknown as DriplElement);
    deleteWithTombstone(room, 't');
    // Fresh element, no existing: accepted.
    expect(acceptSingleValidated(room, el('b', 1) as unknown as DriplElement)).toBe('accepted');
    // Stale vs existing: rejected, stored copy untouched.
    expect(acceptSingleValidated(room, el('a', 1) as unknown as DriplElement)).toBe('rejected');
    expect(room.elements.get('a')?.version).toBe(2);
    // Stale vs tombstone: rejected, no resurrection.
    expect(acceptSingleValidated(room, el('t', 1) as unknown as DriplElement)).toBe('rejected');
    expect(room.elements.has('t')).toBe(false);
    // Genuinely newer vs tombstone: accepted, marker cleared.
    expect(acceptSingleValidated(room, el('t', 5) as unknown as DriplElement)).toBe('accepted');
    expect(room.elements.get('t')?.version).toBe(5);
  });

  it('acceptSingleValidated reports capacity before consulting fences', () => {
    const room = getOrCreateRoom('s2cap');
    for (let i = 0; i < MAX_SCENE_ELEMENTS; i++) {
      room.elements.set(`full-${i}`, el(`full-${i}`, 1) as unknown as DriplElement);
    }
    expect(acceptSingleValidated(room, el('new', 1) as unknown as DriplElement)).toBe('capacity');
    // An update to an existing id is not capacity-gated.
    expect(acceptSingleValidated(room, el('full-0', 2) as unknown as DriplElement)).toBe(
      'accepted'
    );
  });

  it('local and remote funnels accept the same set in any order', () => {
    // Gate-A-lite: order-independence plus local/remote equivalence through
    // the funnel seam. Capacity pre-checks and clientMsgId dedup are
    // handler-level and intentionally outside this property.
    const batch = (nonceSalt: number): DriplElement[] =>
      (['a', 'b', 'c', 'd'] as const).map(
        (id, i) =>
          ({
            ...el(id, i % 2 === 0 ? 2 : 1),
            versionNonce: nonceSalt + i,
          }) as unknown as DriplElement
      );
    const orders: DriplElement[][] = [
      batch(10),
      [...batch(10)].reverse(),
      [batch(10)[2]!, batch(10)[0]!, batch(10)[3]!, batch(10)[1]!],
    ];
    const snapshots: string[] = [];
    // 'c' sits at v2 in every room so its tombstone is v3 and the batch's
    // c@v2 is stale deterministically (a v2-vs-v2 tie would fall to the
    // delete's random tie-break nonce and make this test flaky).
    for (const [n, order] of orders.entries()) {
      const room = getOrCreateRoom(`ord-${n}`);
      room.elements.set('a', el('a', 1) as unknown as DriplElement);
      room.elements.set('c', el('c', 2) as unknown as DriplElement);
      deleteWithTombstone(room, 'c');
      const into: DriplElement[] = [];
      acceptValidated(room, order, into);
      snapshots.push(
        JSON.stringify(
          [...room.elements.entries()]
            .map(([id, e]) => [id, e.version, e.versionNonce] as const)
            .sort((x, y) => (x[0] < y[0] ? -1 : 1))
        )
      );
    }
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);

    // Same payload through the remote (parse) funnel: same survivors
    // (a updated, b/d added, tombstoned c dropped).
    const remote = getOrCreateRoom('ord-remote');
    remote.elements.set('a', el('a', 1) as unknown as DriplElement);
    remote.elements.set('c', el('c', 2) as unknown as DriplElement);
    deleteWithTombstone(remote, 'c');
    const remoteInto: DriplElement[] = [];
    acceptAllParsed(remote, batch(10), remoteInto);
    expect(remoteInto.map(e => e.id).sort()).toEqual(
      (JSON.parse(snapshots[0] as string) as [string][]).map(row => row[0])
    );
  });

  it('wouldExceedSceneCapacity counts only new ids', () => {
    const room = getOrCreateRoom('m3');
    room.elements.set('a', el('a') as unknown as DriplElement);
    expect(wouldExceedSceneCapacity(room, [el('a'), el('b')])).toBe(false);
    expect(wouldExceedSceneCapacity(room, [])).toBe(false);
  });

  it('noteClientMsgId dedups and evicts past 500 entries', () => {
    const room = getOrCreateRoom('m4');
    expect(noteClientMsgId(room, undefined)).toBe(false);
    expect(noteClientMsgId(room, 'x')).toBe(false);
    expect(noteClientMsgId(room, 'x')).toBe(true);
    for (let i = 0; i < 600; i++) noteClientMsgId(room, `id-${i}`);
    expect(room.recentMsgIds.size).toBeLessThanOrEqual(500);
    expect(noteClientMsgId(room, 'x')).toBe(false);
  });

  it('sceneCapacityMessage names the live cap', () => {
    expect(sceneCapacityMessage()).toContain('5000');
  });
});
