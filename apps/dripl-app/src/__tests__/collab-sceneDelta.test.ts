import { describe, it, expect } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { computeSceneDelta, filterReplayPending } from '@/lib/collab/sceneDelta';

const el = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

describe('computeSceneDelta', () => {
  it('reports an empty scene against an empty baseline as no-op', () => {
    expect(computeSceneDelta([], [])).toEqual({ added: [], updated: [], deleted: [], moved: [] });
  });

  it('classifies added, updated, and deleted by identity', () => {
    const kept = el('keep');
    const changed = el('change', { version: 1 });
    const gone = el('gone');
    const changedNext = { ...changed, version: 2 };
    const added = el('new');
    const delta = computeSceneDelta([kept, changed, gone], [kept, changedNext, added]);
    expect(delta.added).toEqual([added]);
    expect(delta.updated).toEqual([changedNext]);
    expect(delta.deleted).toEqual(['gone']);
    expect(delta.moved).toEqual([]);
  });

  it('treats reference-identical elements as unchanged', () => {
    const a = el('a');
    const delta = computeSceneDelta([a], [a]);
    expect(delta).toEqual({ added: [], updated: [], deleted: [], moved: [] });
  });

  it('skips content-identical replacements with the same version (no over-send)', () => {
    const a = el('a');
    const twin = { ...a };
    const delta = computeSceneDelta([a], [twin]);
    expect(delta.updated).toEqual([]);
  });

  it('still sends replacements carrying a newer version', () => {
    const a = el('a', { version: 1, versionNonce: 5 });
    const newer = { ...a, version: 2, versionNonce: 9 };
    const delta = computeSceneDelta([a], [newer]);
    expect(delta.updated).toEqual([newer]);
  });

  it('sends a pure translation as a move-delta, not a full record', () => {
    // A drag rebuilds points arrays, so the check is by value rather than by
    // reference — but the payload on the wire stays a five-field move.
    const before = el('a', {
      type: 'freedraw',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      version: 3,
      versionNonce: 7,
    });
    const after = {
      ...before,
      x: 50,
      y: 60,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      version: 4,
      versionNonce: 8,
    };
    const delta = computeSceneDelta([before], [after]);
    expect(delta.updated).toEqual([]);
    expect(delta.moved).toEqual([{ id: 'a', x: 50, y: 60, version: 4, versionNonce: 8 }]);
  });

  it('sends a full record when a move also changes content', () => {
    const before = el('a', { version: 1, versionNonce: 1 });
    const after = { ...before, x: 5, width: 99, version: 2, versionNonce: 2 };
    const delta = computeSceneDelta([before], [after]);
    expect(delta.moved).toEqual([]);
    expect(delta.updated).toEqual([after]);
  });

  it('sends a full record for unversioned legacy moves', () => {
    const before = el('a');
    delete (before as { version?: number }).version;
    delete (before as { versionNonce?: number }).versionNonce;
    const after = { ...before, x: 5 };
    const delta = computeSceneDelta([before], [after]);
    expect(delta.moved).toEqual([]);
    expect(delta.updated).toEqual([after]);
  });

  it('does not treat an in-place version bump as a move', () => {
    const a = el('a', { version: 1, versionNonce: 5 });
    const bumped = { ...a, version: 2, versionNonce: 9 };
    const delta = computeSceneDelta([a], [bumped]);
    expect(delta.moved).toEqual([]);
    expect(delta.updated).toEqual([bumped]);
  });
});

describe('filterReplayPending', () => {
  it('drops stale local elements the server never saw', () => {
    const stale = el('stale');
    const live = el('live');
    const out = filterReplayPending([stale, live], new Set(['stale', 'other']), new Set(['live']));
    expect(out).toEqual([live]);
  });

  it('keeps brand-new elements with no baseline', () => {
    const fresh = el('fresh');
    expect(filterReplayPending([fresh], new Set(), new Set())).toEqual([fresh]);
  });
});
