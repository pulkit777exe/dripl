import type { DriplElement, Point } from "@dripl/common";

export interface HistoryState {
  elements: DriplElement[];
  selectedIds: string[];
}

export class HistoryManager<T> {
  private history: T[] = [];
  private currentIndex: number = -1;
  private maxHistory: number;

  constructor(maxHistory: number = 50) {
    this.maxHistory = maxHistory;
  }

  pushState(state: T, cloneFn: (state: T) => T): void {
    // Remove any states after current index (discard redo history)
    this.history = this.history.slice(0, this.currentIndex + 1);

    // Add new state
    this.history.push(cloneFn(state));
    this.currentIndex++;

    // Trim history if it exceeds max
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  undo(cloneFn: (state: T) => T): T | null {
    if (!this.canUndo()) return null;

    this.currentIndex--;
    const state = this.history[this.currentIndex];
    return state ? cloneFn(state) : null;
  }

  redo(cloneFn: (state: T) => T): T | null {
    if (!this.canRedo()) return null;

    this.currentIndex++;
    const state = this.history[this.currentIndex];
    return state ? cloneFn(state) : null;
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  getCurrentState(cloneFn: (state: T) => T): T | null {
    if (this.currentIndex < 0) return null;
    const state = this.history[this.currentIndex];
    return state ? cloneFn(state) : null;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  get length(): number {
    return this.history.length;
  }

  get index(): number {
    return this.currentIndex;
  }
}

function cloneElement(el: DriplElement): DriplElement {
  const base = { ...el };
  
  if ("points" in el && el.points) {
    (base as { points: Point[] }).points = el.points.map((p: Point) => ({ ...p }));
  }
  
  return base as DriplElement;
}

export function cloneHistoryState(state: HistoryState): HistoryState {
  return {
    elements: state.elements.map(cloneElement),
    selectedIds: [...state.selectedIds],
  };
}

export class CanvasHistory extends HistoryManager<HistoryState> {
  constructor(maxHistory: number = 50) {
    super(maxHistory);
  }

  pushState(state: HistoryState): void {
    super.pushState(state, cloneHistoryState);
  }

  push(elements: readonly DriplElement[], selectedIds: string[] = []): void {
    this.pushState({
      elements: [...elements],
      selectedIds: [...selectedIds],
    });
  }

  undo(): HistoryState | null {
    return super.undo(cloneHistoryState);
  }

  redo(): HistoryState | null {
    return super.redo(cloneHistoryState);
  }

  getCurrentState(): HistoryState | null {
    return super.getCurrentState(cloneHistoryState);
  }

  getHistoryLength(): number {
    return this.length;
  }

  getRedoLength(): number {
    return Math.max(0, this.length - this.index - 1);
  }
}
