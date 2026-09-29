import type { DriplElement } from '@dripl/common';

export interface SceneDelta {
  added: DriplElement[];
  updated: DriplElement[];
  deleted: string[];
}

/**
 * Diff a previous scene against the pending scene into a wire delta.
 *
 * Identity rule: an element whose reference is unchanged is treated as
 * unchanged. The store replaces element objects on mutation, so reference
 * inequality is the change signal. An element replaced with identical
 * content under a new reference is sent as an update — a harmless over-send
 * the server's version fence resolves.
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
    } else if (prevEl !== el) {
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
