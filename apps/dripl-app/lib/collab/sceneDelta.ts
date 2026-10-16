import type { DriplElement, MovedElement } from '@dripl/common';

export interface SceneDelta {
  added: DriplElement[];
  updated: DriplElement[];
  deleted: string[];
  /** Move-only updates: translation merged by receivers onto their own copy. */
  moved: MovedElement[];
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
 * Fields a move-delta carries; everything else must be identical for the
 * compact form to apply. `updated` is masked too: it is a render timestamp,
 * not scene content, and the receiver keeps its own.
 */
const MOVE_MASKED_KEYS = new Set(['x', 'y', 'version', 'versionNonce', 'updated']);

/** Strip the move-delta fields so the remainder is comparable as content. */
function contentKey(element: DriplElement): string {
  const record = element as unknown as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!MOVE_MASKED_KEYS.has(key)) content[key] = record[key];
  }
  return JSON.stringify(content);
}

/**
 * Whether the change from `prev` to `next` is a pure translation with
 * freshness markers present. Points arrays are compared by value (a drag
 * rebuilds them), but only when the origin actually moved — otherwise the
 * stringify is skipped entirely.
 */
export function isMoveOnlyUpdate(prev: DriplElement, next: DriplElement): boolean {
  if (next.x === prev.x && next.y === prev.y) return false;
  if (typeof next.version !== 'number' || typeof next.versionNonce !== 'number') return false;
  return contentKey(prev) === contentKey(next);
}
/**
 * Diff a previous scene against the pending scene into a wire delta.
 *
 * Identity rule: an element whose reference is unchanged is treated as
 * unchanged. An element replaced under a new reference but carrying the same
 * version/versionNonce is also unchanged — this skips harmless re-renders
 * (e.g. transient render state replaced without a mutation) while the
 * server's version fence remains authoritative for real conflicts.
 *
 * A changed element whose only content difference is translation travels as
 * a move-delta (`moved`) instead of a full record: drags are the hottest
 * broadcast path and their points arrays never change mid-drag.
 */
export function computeSceneDelta(prev: DriplElement[], pending: DriplElement[]): SceneDelta {
  const prevMap = new Map(prev.map(el => [el.id, el]));
  const nextMap = new Map(pending.map(el => [el.id, el]));

  const added: DriplElement[] = [];
  const updated: DriplElement[] = [];
  const moved: MovedElement[] = [];

  for (const el of pending) {
    const prevEl = prevMap.get(el.id);
    if (!prevEl) {
      added.push(el);
    } else if (prevEl !== el && !isSameVersion(prevEl, el)) {
      if (isMoveOnlyUpdate(prevEl, el)) {
        moved.push({
          id: el.id,
          x: el.x,
          y: el.y,
          version: el.version as number,
          versionNonce: el.versionNonce as number,
        });
      } else {
        updated.push(el);
      }
    }
  }

  const deleted: string[] = [];
  for (const el of prev) {
    if (!nextMap.has(el.id)) {
      deleted.push(el.id);
    }
  }

  return { added, updated, deleted, moved };
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
