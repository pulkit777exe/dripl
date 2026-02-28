import type { DriplElement } from "@dripl/common";

export interface StoreSnapshot {
  readonly elements: readonly DriplElement[];
  readonly selectedIds: readonly string[];
  readonly editingTextId: string | null;
}

export function createSnapshot(
  elements: readonly DriplElement[],
  selectedIds: readonly string[] = [],
  editingTextId: string | null = null,
): StoreSnapshot {
  return {
    elements: [...elements],
    selectedIds: [...selectedIds],
    editingTextId,
  };
}

export function cloneSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  return {
    elements: snapshot.elements.map((el) => ({ ...el })),
    selectedIds: [...snapshot.selectedIds],
    editingTextId: snapshot.editingTextId,
  };
}

/**
 * Dev-only helper to deep-freeze a snapshot so accidental mutations
 * in renderers or subscribers are surfaced immediately.
 */
export function freezeSnapshotDev<T extends StoreSnapshot>(
  snapshot: T,
): T {
  // Freeze shallow container and element objects; we don't recurse into
  // arbitrary custom fields (renders should treat elements as immutable).
  snapshot.elements.forEach((el) => Object.freeze(el));
  Object.freeze(snapshot.elements);
  Object.freeze(snapshot.selectedIds);
  return Object.freeze({ ...snapshot }) as T;
}
