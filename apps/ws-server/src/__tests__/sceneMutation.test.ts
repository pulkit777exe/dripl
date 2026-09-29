import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
  canvasRoom: { findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
}));

vi.mock('@dripl/db', () => ({ db: dbMock }));

import { getOrCreateRoom, rooms } from '../rooms';
import {
  acceptAll,
  acceptElement,
  acceptValidated,
  noteClientMsgId,
  sceneCapacityMessage,
  toDriplElement,
  wouldExceedSceneCapacity,
} from '../sceneMutation';
import type { DriplElement } from '@dripl/common';

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

  it('acceptAll accepts the fence-passing subset and reports invalid payloads', () => {
    const room = getOrCreateRoom('m2');
    room.elements.set('a', el('a', 2) as unknown as DriplElement);
    const into: DriplElement[] = [];
    const invalid: unknown[] = [];
    acceptAll(room, [el('a', 1), el('b', 1), { nope: true }], into, raw => {
      invalid.push(raw);
    });
    expect(into.map(e => e.id)).toEqual(['b']);
    expect(invalid).toHaveLength(1);
    expect(room.elements.get('a')?.version).toBe(2);
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
