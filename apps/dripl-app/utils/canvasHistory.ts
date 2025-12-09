import { CanvasElement } from "./canvasUtils";

export interface HistoryState {
  elements: CanvasElement[];
  selectedIds: string[];
}

export class CanvasHistory {
  private history: HistoryState[] = [];
  private currentIndex: number = -1;
  private maxHistory: number = 50;

  /**
   * Add a new state to history
   */
  pushState(state: HistoryState): void {
    // Remove any states after current index (when undoing then making new changes)
    this.history = this.history.slice(0, this.currentIndex + 1);

    // Add new state
    this.history.push(this.cloneState(state));
    this.currentIndex++;

    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  /**
   * Undo to previous state
   */
  undo(): HistoryState | null {
    if (!this.canUndo()) return null;

    this.currentIndex--;
    const state = this.history[this.currentIndex];
    return state ? this.cloneState(state) : null;
  }

  /**
   * Redo to next state
   */
  redo(): HistoryState | null {
    if (!this.canRedo()) return null;

    this.currentIndex++;
    const state = this.history[this.currentIndex];
    return state ? this.cloneState(state) : null;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  /**
   * Get current state
   */
  getCurrentState(): HistoryState | null {
    if (this.currentIndex < 0) return null;
    const state = this.history[this.currentIndex];
    return state ? this.cloneState(state) : null;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  /**
   * Deep clone a state
   */
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
