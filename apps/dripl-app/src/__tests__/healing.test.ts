import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { decideHealingAction } from '@/lib/collab/healing';

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

describe('decideHealingAction', () => {
  it('does nothing before the initial sync', () => {
    const current = [el('a')];
    expect(decideHealingAction(true, current, [], current)).toEqual({ kind: 'none' });
  });

  it('flushes a stranded pending snapshot', () => {
    const pending = [el('a')];
    expect(decideHealingAction(false, pending, [], [])).toEqual({ kind: 'flush-pending' });
  });

  it('does nothing when the baseline reference is unchanged', () => {
    const scene = [el('a')];
    expect(decideHealingAction(false, null, scene, scene)).toEqual({ kind: 'none' });
  });

  it('re-queues a diverged baseline for convergence', () => {
    const prev = [el('a')];
    const current = [el('a'), el('b')];
    const action = decideHealingAction(false, null, prev, current);
    expect(action).toEqual({ kind: 'requeue', elements: current });
  });

  it('does nothing when the delta is empty despite new references', () => {
    const prev = [el('a')];
    const twin = { ...prev[0]! };
    expect(decideHealingAction(false, null, prev, [twin])).toEqual({ kind: 'none' });
  });
});
