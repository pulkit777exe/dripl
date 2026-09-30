import { compareElementFreshness } from '@dripl/common/reconciliation';
import type { RoomState, Tombstone } from './types';

/**
 * Delete markers live here (leaf module: no imports from rooms or
 * sceneMutation, so both can use it without an import cycle).
 *
 * Without tombstones, a stale concurrent edit (or an offline replay)
 * re-adds a deleted id and the delete silently un-happens — the element
 * resurrects on every replica and gets persisted. A tombstone carries the
 * delete's version so the freshness fence can reject older writes while
 * still accepting genuinely newer ones, mirroring Excalidraw's `isDeleted`
 * + `DELETED_ELEMENT_TIMEOUT` (1 day). Memory-only: a restart loses them,
 * same as all other room state (single-instance caveat).
 */

/** How long a delete marker suppresses stale writes (Excalidraw parity). */
export const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;

function tombstoneMap(room: RoomState): Map<string, Tombstone> {
  return room.tombstones ?? (room.tombstones = new Map());
}

/** A live (unexpired) tombstone for the id, or undefined. Expired markers
 * are dropped on sight so they cannot suppress anything. */
export function getLiveTombstone(
  room: RoomState,
  id: string,
  now = Date.now()
): Tombstone | undefined {
  const tombstone = tombstoneMap(room).get(id);
  if (!tombstone) return undefined;
  if (now - tombstone.deletedAt >= TOMBSTONE_TTL_MS) {
    tombstoneMap(room).delete(id);
    return undefined;
  }
  return tombstone;
}

/**
 * Remove an element and record a versioned delete marker. The marker's
 * version beats whatever was stored (existing version + 1), so concurrent
 * edits made against the pre-delete state lose the freshness fence instead
 * of resurrecting the element. A genuinely newer edit still wins and clears
 * the marker (see acceptElement/acceptValidated). Returns false when the id
 * was absent — same no-op contract as the bare Map.delete before it.
 */
export function deleteWithTombstone(room: RoomState, id: string, now = Date.now()): boolean {
  const existing = room.elements.get(id);
  if (!room.elements.delete(id)) return false;
  const version = (existing?.version ?? 0) + 1;
  tombstoneMap(room).set(id, {
    id,
    version,
    // Tie-break nonce for the delete itself: concurrent same-version edits
    // resolve deterministically instead of by arrival order.
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    deletedAt: now,
  });
  return true;
}

/** Drop expired markers. Called on the periodic-save tick; cheap enough
 * that the 24h TTL needs no dedicated interval. */
export function sweepExpiredTombstones(room: RoomState, now = Date.now()): number {
  let swept = 0;
  for (const [id, tombstone] of tombstoneMap(room)) {
    if (now - tombstone.deletedAt >= TOMBSTONE_TTL_MS) {
      tombstoneMap(room).delete(id);
      swept += 1;
    }
  }
  return swept;
}

export type TombstonedElement = { id: string; version?: number; versionNonce?: number };

/**
 * Single-element tombstone fence shared by every admission path
 * (acceptElement, acceptValidated, and the add/update single-element
 * handlers). Returns true when a live tombstone beats the incoming element
 * — the caller must drop it (no resurrection). When the incoming element is
 * genuinely newer it clears the marker (legitimate revive) and returns
 * false. No tombstone → false.
 */
export function isSupersededByTombstone(room: RoomState, element: TombstonedElement): boolean {
  const tombstone = getLiveTombstone(room, element.id);
  if (!tombstone) return false;
  if (compareElementFreshness(element, tombstone) <= 0) return true;
  tombstoneMap(room).delete(element.id);
  return false;
}
