/**
 * Bridge between @dripl/runtime Store and app Zustand store.
 * Phase 1: single path for scene mutations; syncs Store snapshot to Zustand for rendering.
 */
import { Store, createSnapshot, type StoreSnapshot } from "@dripl/runtime";

let storeInstance: Store | null = null;
let syncUnsubscribe: (() => void) | null = null;

export type SyncToZustand = (snapshot: StoreSnapshot) => void;

/**
 * Initialize the runtime store with optional initial snapshot.
 * Call once when canvas is ready (e.g. after loadInitialScene).
 */
export function initRuntimeStore(initialSnapshot?: StoreSnapshot): Store {
  if (storeInstance) {
    return storeInstance;
  }
  storeInstance = new Store(initialSnapshot);
  return storeInstance;
}

/**
 * Subscribe the Store to sync its snapshot to Zustand on every commit/undo/redo.
 * Call after initRuntimeStore from a component that has setElements/setSelectedIds.
 */
export function setRuntimeStoreSync(sync: SyncToZustand): void {
  if (syncUnsubscribe) syncUnsubscribe();
  if (!storeInstance) return;
  syncUnsubscribe = storeInstance.subscribe(sync);
}

/**
 * Get the Store instance if initialized. Use for commit() from UI.
 */
export function getRuntimeStore(): Store | null {
  return storeInstance;
}

/**
 * Replace the Store's scene with a new snapshot and clear history.
 * Call after loading a scene from room/file/link so the Store stays in sync.
 */
export function updateRuntimeStoreSnapshot(snapshot: StoreSnapshot): void {
  if (storeInstance) {
    storeInstance.replaceSnapshot(snapshot);
  }
}

/**
 * Build a StoreSnapshot from current elements and selection (e.g. from Zustand).
 */
export function snapshotFromState(
  elements: readonly { id: string }[],
  selectedIds: Iterable<string>,
  editingTextId: string | null = null,
): StoreSnapshot {
  return createSnapshot(
    elements as StoreSnapshot["elements"],
    [...selectedIds],
    editingTextId,
  );
}
