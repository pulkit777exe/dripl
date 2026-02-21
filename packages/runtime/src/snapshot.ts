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
