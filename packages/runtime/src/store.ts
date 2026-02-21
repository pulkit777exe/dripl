import {
  Scene,
  ActionReducer,
  DeltaManager,
  type Action,
  type Delta,
} from "@dripl/common";
import {
  createSnapshot,
  cloneSnapshot,
  type StoreSnapshot,
} from "./snapshot.js";
import { shouldCaptureToHistory, type CaptureMode } from "./capture.js";

/**
 * State evolution engine. Single path for scene mutations.
 * Spec §4.2. commit(update, captureMode); maybeClone when capturing.
 */
/** Single delta or a batch of deltas (one undo step). */
type HistoryEntry = Delta | Delta[];

export class Store {
  private scene: Scene;
  private readonly deltaManager: DeltaManager = new DeltaManager();
  private history: HistoryEntry[] = [];
  private currentIndex: number = -1;
  private subscribers = new Set<(snapshot: StoreSnapshot) => void>();

  constructor(initialSnapshot?: StoreSnapshot) {
    const elements = initialSnapshot?.elements ?? [];
    this.scene = new Scene([...elements]);
    if (initialSnapshot) {
      this.scene.setSelectedElements([...initialSnapshot.selectedIds]);
      this.scene.setEditingTextId(initialSnapshot.editingTextId);
    }
  }

  getSnapshot(): StoreSnapshot {
    return createSnapshot(
      this.scene.getElements(),
      this.scene.getSelectedElements().map((el) => el.id),
      this.scene.getEditingTextId(),
    );
  }

  /**
   * Replace current scene and selection with a new snapshot; clear history.
   * Use when loading a scene from room/file/link so Store stays in sync.
   */
  replaceSnapshot(snapshot: StoreSnapshot): void {
    this.setSnapshot(snapshot);
    this.history = [];
    this.currentIndex = -1;
    this.notify();
  }

  /**
   * Commit multiple actions as one history step (e.g. drag end).
   * One undo reverts the entire batch.
   */
  commitBatch(actions: Action[], captureMode: CaptureMode): void {
    if (actions.length === 0) {
      this.notify();
      return;
    }
    const deltas: Delta[] = [];
    const shouldCapture = shouldCaptureToHistory(captureMode);
    this.deltaManager.setTransientMode(shouldCapture);

    for (const action of actions) {
      const newScene = ActionReducer.reduce(
        this.scene,
        action,
        shouldCapture ? this.deltaManager : undefined,
      );
      const delta = this.deltaManager.takeLastCreatedDelta();
      if (delta) deltas.push(delta);
      this.scene = newScene;
    }

    this.deltaManager.setTransientMode(false);

    if (shouldCapture && deltas.length > 0) {
      this.history = this.history.slice(0, this.currentIndex + 1);
      const entry: HistoryEntry =
        deltas.length === 1 ? (deltas[0] as Delta) : deltas;
      this.history.push(entry);
      this.currentIndex = this.history.length - 1;
    }

    this.notify();
  }

  private setSnapshot(snapshot: StoreSnapshot): void {
    this.scene = new Scene([...snapshot.elements]);
    this.scene.setSelectedElements([...snapshot.selectedIds]);
    this.scene.setEditingTextId(snapshot.editingTextId);
  }

  /**
   * Commit an action. State transitions only via this path.
   * maybeClone: we only push to history when capturing; clone not needed for apply (reducer returns new scene).
   */
  commit(action: Action, captureMode: CaptureMode): void {
    this.deltaManager.setTransientMode(shouldCaptureToHistory(captureMode));
    const newScene = ActionReducer.reduce(
      this.scene,
      action,
      shouldCaptureToHistory(captureMode) ? this.deltaManager : undefined,
    );
    const delta = this.deltaManager.takeLastCreatedDelta();
    this.deltaManager.setTransientMode(false);

    this.scene = newScene;

    if (shouldCaptureToHistory(captureMode) && delta) {
      this.history = this.history.slice(0, this.currentIndex + 1);
      this.history.push(delta);
      this.currentIndex = this.history.length - 1;
    }

    this.notify();
  }

  /** Apply an update function to current snapshot and commit the resulting snapshot (no action/delta). For EPHEMERAL/NEVER only; no history. */
  commitSnapshot(
    update: (prev: StoreSnapshot) => StoreSnapshot,
    captureMode: CaptureMode,
  ): void {
    const prev = this.getSnapshot();
    const next = update(cloneSnapshot(prev));
    this.setSnapshot(next);
    if (shouldCaptureToHistory(captureMode)) {
      // Snapshot-only commit does not push delta yet (Phase 2: diff-based delta).
      this.notify();
      return;
    }
    this.notify();
  }

  undo(): boolean {
    if (this.currentIndex < 0) return false;
    const entry = this.history[this.currentIndex];
    if (!entry) return false;
    const toRevert = Array.isArray(entry) ? [...entry].reverse() : [entry];
    for (const delta of toRevert) {
      this.scene = this.deltaManager.revertDelta(this.scene, delta);
    }
    this.currentIndex--;
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.currentIndex >= this.history.length - 1) return false;
    this.currentIndex++;
    const entry = this.history[this.currentIndex];
    if (!entry) return false;
    const toApply = Array.isArray(entry) ? entry : [entry];
    for (const delta of toApply) {
      this.scene = this.deltaManager.applyDelta(this.scene, delta);
    }
    this.notify();
    return true;
  }

  canUndo(): boolean {
    return this.currentIndex >= 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  subscribe(listener: (snapshot: StoreSnapshot) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    this.subscribers.forEach((fn) => fn(snapshot));
  }
}
