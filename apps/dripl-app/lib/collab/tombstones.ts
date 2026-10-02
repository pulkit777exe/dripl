/**
 * Frontend tombstones — local delete markers that suppress resurrection.
 *
 * Mirrors the ws-server's durable tombstones (`apps/ws-server/src/tombstones.ts`)
 * on the client: once an id is deleted locally (or a remote delete is applied),
 * stale `added`/`updated` records for that id — e.g. a delayed packet, an
 * offline replay, or a racing collaborator edit — are ignored until the marker
 * expires. Without this, physical deletes (`Map.delete`) let any late record
 * silently resurrect the element.
 *
 * Markers are memory-only and bounded: entries expire after `ttlMs` and the
 * store caps at `maxEntries` (oldest evicted first). A reload drops them, at
 * which point the server's durable tombstones remain authoritative.
 */

export interface TombstoneFilter {
  has(id: string): boolean;
}

export const DEFAULT_TOMBSTONE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_TOMBSTONE_MAX_ENTRIES = 1_000;

export class TombstoneStore implements TombstoneFilter {
  private readonly deletedAtById = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TOMBSTONE_TTL_MS,
    private readonly maxEntries: number = DEFAULT_TOMBSTONE_MAX_ENTRIES
  ) {}

  add(id: string): void;
  add(ids: Iterable<string>): void;
  add(idOrIds: string | Iterable<string>): void {
    const now = Date.now();
    if (typeof idOrIds === 'string') {
      this.deletedAtById.set(idOrIds, now);
    } else {
      for (const id of idOrIds) this.deletedAtById.set(id, now);
    }
    this.enforceBounds(now);
  }

  has(id: string): boolean {
    const at = this.deletedAtById.get(id);
    if (at === undefined) return false;
    if (Date.now() - at > this.ttlMs) {
      this.deletedAtById.delete(id);
      return false;
    }
    return true;
  }

  /** Forget markers (e.g. room change — ids are scoped to one scene). */
  clear(): void {
    this.deletedAtById.clear();
  }

  get size(): number {
    return this.deletedAtById.size;
  }

  private enforceBounds(now: number): void {
    if (this.deletedAtById.size <= this.maxEntries) return;
    // Evict oldest first. Insertion order ≈ deletion order (re-adds refresh).
    const overflow = this.deletedAtById.size - this.maxEntries;
    let evicted = 0;
    for (const key of this.deletedAtById.keys()) {
      void now;
      this.deletedAtById.delete(key);
      evicted += 1;
      if (evicted >= overflow) break;
    }
  }
}

export function createTombstoneStore(
  ttlMs: number = DEFAULT_TOMBSTONE_TTL_MS,
  maxEntries: number = DEFAULT_TOMBSTONE_MAX_ENTRIES
): TombstoneStore {
  return new TombstoneStore(ttlMs, maxEntries);
}
