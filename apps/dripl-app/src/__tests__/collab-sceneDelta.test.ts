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
    expect(computeSceneDelta([], [])).toEqual({ added: [], updated: [], deleted: [] });
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
  });

  it('treats reference-identical elements as unchanged', () => {
    const a = el('a');
    const delta = computeSceneDelta([a], [a]);
    expect(delta).toEqual({ added: [], updated: [], deleted: [] });
  });

  it('sends content-identical replacements as updates (over-send, server resolves)', () => {
    const a = el('a');
    const twin = { ...a };
    const delta = computeSceneDelta([a], [twin]);
    expect(delta.updated).toEqual([twin]);
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
