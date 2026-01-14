import { CanvasElement } from "./canvasUtils";

export interface HistoryState {
  elements: CanvasElement[];
  selectedIds: string[];
}

export class CanvasHistory {
  private history: HistoryState[] = [];
  private currentIndex: number = -1;
  private maxHistory: number = 50;

  pushState(state: HistoryState): void {
    this.history = this.history.slice(0, this.currentIndex + 1);

    this.history.push(this.cloneState(state));
    this.currentIndex++;

    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  undo(): HistoryState | null {
    if (!this.canUndo()) return null;

    this.currentIndex--;
    const state = this.history[this.currentIndex];
    return state ? this.cloneState(state) : null;
  }

  redo(): HistoryState | null {
    if (!this.canRedo()) return null;

    this.currentIndex++;
    const state = this.history[this.currentIndex];
    return state ? this.cloneState(state) : null;
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  getCurrentState(): HistoryState | null {
    if (this.currentIndex < 0) return null;
    const state = this.history[this.currentIndex];
    return state ? this.cloneState(state) : null;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  private cloneState(state: HistoryState): HistoryState {
    return {
      elements: state.elements.map((el) => ({
        ...el,
        points: el.points ? [...el.points] : undefined,
      })),
      selectedIds: [...state.selectedIds],
    };
  }
}
