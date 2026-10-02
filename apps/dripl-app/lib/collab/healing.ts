import type { DriplElement } from '@dripl/common';
import { computeSceneDelta } from './sceneDelta';

export type HealingAction =
  { kind: 'none' } | { kind: 'flush-pending' } | { kind: 'requeue'; elements: DriplElement[] };

/**
 * Healing tick decision — pure helper extracted from `useCollaboration`.
 *
 * A delta lost while the socket stayed OPEN (flush-time race, or a send
 * that never arrived without a close event) would otherwise diverge
 * silently until the next local edit. The heartbeat therefore compares the
 * coalesced snapshot against the last flushed baseline:
 * - before the initial sync the server snapshot is authoritative → none;
 * - a stranded pending snapshot just needs a flush;
 * - a diverged baseline is re-queued so the next flush converges.
 *
 * The hook owns socket liveness and the actual flush; this function only
 * decides, so it is unit-testable without timers or sockets.
 */
export function decideHealingAction(
  isFirstSync: boolean,
  pending: DriplElement[] | null,
  prev: DriplElement[],
  current: DriplElement[]
): HealingAction {
  if (isFirstSync) return { kind: 'none' };
  if (pending) return { kind: 'flush-pending' };
  if (current === prev) return { kind: 'none' };
  const { added, updated, deleted } = computeSceneDelta(prev, current);
  if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
    return { kind: 'requeue', elements: current };
  }
  return { kind: 'none' };
}
