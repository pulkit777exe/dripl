import type { DriplElement } from '@dripl/common';

export interface SceneDelta {
  added: DriplElement[];
  updated: DriplElement[];
  deleted: string[];
}

/**
 * Two element records carry the same applied mutation when both version and
 * versionNonce match. Version is bumped with a fresh nonce on every mutation
 * (see @dripl/element mutateElement), so equality means no newer edit.
 */
export function isSameVersion(a: DriplElement, b: DriplElement): boolean {
  return (
    typeof a.version === 'number' &&
    typeof b.version === 'number' &&
    typeof a.versionNonce === 'number' &&
    typeof b.versionNonce === 'number' &&
    a.version === b.version &&
    a.versionNonce === b.versionNonce
  );
}

/**
 * Diff a previous scene against the pending scene into a wire delta.
 *
 * Identity rule: an element whose reference is unchanged is treated as
 * unchanged. An element replaced under a new reference but carrying the same
 * version/versionNonce is also unchanged — this skips harmless re-renders
 * (e.g. transient render state replaced without a mutation) while the
 * server's version fence remains authoritative for real conflicts.
 */
export function computeSceneDelta(prev: DriplElement[], pending: DriplElement[]): SceneDelta {
  const prevMap = new Map(prev.map(el => [el.id, el]));
  const nextMap = new Map(pending.map(el => [el.id, el]));

  const added: DriplElement[] = [];
  const updated: DriplElement[] = [];

  for (const el of pending) {
    const prevEl = prevMap.get(el.id);
    if (!prevEl) {
      added.push(el);
    } else if (prevEl !== el && !isSameVersion(prevEl, el)) {
      updated.push(el);
    }
  }

  const deleted: string[] = [];
  for (const el of prev) {
    if (!nextMap.has(el.id)) {
      deleted.push(el.id);
    }
  }

  return { added, updated, deleted };
}

/**
 * Filter offline-replay candidates after a server sync: drop local elements
 * the server has never seen unless they are still in the server scene, so a
 * stale offline queue cannot resurrect deleted elements.
 */
export function filterReplayPending(
  pending: DriplElement[],
  previousIds: Set<string>,
  serverIds: Set<string>
): DriplElement[] {
  return pending.filter(element => !previousIds.has(element.id) || serverIds.has(element.id));
}
