import type { DriplElement } from "./types/element";
import { Scene } from "./scene";

export type DeltaOperation = "add" | "update" | "delete" | "restore";

export interface Delta {
  id: string;
  operation: DeltaOperation;
  elementId: string;
  timestamp: number;
  before?: Partial<DriplElement>;
  after?: Partial<DriplElement>;
}

export class DeltaManager {
  private deltas: Delta[] = [];
  private maxHistorySize: number = 100;

  createAddDelta(element: DriplElement): Delta {
    const delta: Delta = {
      id: this.generateId(),
      operation: "add",
      elementId: element.id,
      timestamp: Date.now(),
      after: element,
    };
    this.addDelta(delta);
    return delta;
  }

  createUpdateDelta(
    elementId: string,
    before: Partial<DriplElement>,
    after: Partial<DriplElement>,
  ): Delta {
    const delta: Delta = {
      id: this.generateId(),
      operation: "update",
      elementId: elementId,
      timestamp: Date.now(),
      before,
      after,
    };
    this.addDelta(delta);
    return delta;
  }

  createDeleteDelta(elementId: string, before: Partial<DriplElement>): Delta {
    const delta: Delta = {
      id: this.generateId(),
      operation: "delete",
      elementId: elementId,
      timestamp: Date.now(),
      before,
    };
    this.addDelta(delta);
    return delta;
  }

  createRestoreDelta(elementId: string, after: Partial<DriplElement>): Delta {
    const delta: Delta = {
      id: this.generateId(),
      operation: "restore",
      elementId: elementId,
      timestamp: Date.now(),
      after,
    };
    this.addDelta(delta);
    return delta;
  }

  applyDelta(scene: Scene, delta: Delta): Scene {
    const clonedScene = scene.clone();

    switch (delta.operation) {
      case "add":
        if (delta.after) {
          clonedScene.addElement(delta.after as DriplElement);
        }
        break;

      case "update":
        if (delta.after) {
          clonedScene.updateElement(delta.elementId, delta.after);
        }
        break;

      case "delete":
        clonedScene.deleteElement(delta.elementId);
        break;

      case "restore":
        if (delta.after) {
          clonedScene.restoreElement(delta.elementId);
        }
        break;
    }

    return clonedScene;
  }

  applyDeltas(scene: Scene, deltas: Delta[]): Scene {
    let result = scene;
    deltas.forEach((delta) => {
      result = this.applyDelta(result, delta);
    });
    return result;
  }

  revertDelta(scene: Scene, delta: Delta): Scene {
    const clonedScene = scene.clone();

    switch (delta.operation) {
      case "add":
        clonedScene.deleteElement(delta.elementId);
        break;

      case "update":
        if (delta.before) {
          clonedScene.updateElement(delta.elementId, delta.before);
        }
        break;

      case "delete":
        if (delta.before) {
          clonedScene.restoreElement(delta.elementId);
          clonedScene.updateElement(delta.elementId, delta.before);
        }
        break;

      case "restore":
        clonedScene.deleteElement(delta.elementId);
        break;
    }

    return clonedScene;
  }

  revertDeltas(scene: Scene, deltas: Delta[]): Scene {
    let result = scene;
    [...deltas].reverse().forEach((delta) => {
      result = this.revertDelta(result, delta);
    });
    return result;
  }

  getDeltas(): Delta[] {
    return [...this.deltas];
  }

  getDeltasSince(index: number): Delta[] {
    return this.deltas.slice(index);
  }

  getDelta(id: string): Delta | undefined {
    return this.deltas.find((d) => d.id === id);
  }

  clear(): void {
    this.deltas = [];
  }

  getSize(): number {
    return this.deltas.length;
  }

  isEmpty(): boolean {
    return this.deltas.length === 0;
  }

  private addDelta(delta: Delta): void {
    this.deltas.push(delta);

    if (this.deltas.length > this.maxHistorySize) {
      this.deltas.shift();
    }
  }

  private generateId(): string {
    return `delta_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export class SceneHistory {
  private states: { scene: Scene; delta?: Delta }[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 50;

  constructor(initialScene?: Scene) {
    if (initialScene) {
      this.states.push({ scene: initialScene });
      this.currentIndex = 0;
    }
  }

  pushState(scene: Scene, delta?: Delta): void {
    if (this.currentIndex < this.states.length - 1) {
      this.states = this.states.slice(0, this.currentIndex + 1);
    }

    this.states.push(
      delta !== undefined ?
        { scene: scene.clone(), delta } :
        { scene: scene.clone() }
    );
    this.currentIndex++;

    if (this.states.length > this.maxHistorySize) {
      this.states.shift();
      this.currentIndex--;
    }
  }

  undo(): Scene | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      const state = this.states[this.currentIndex];
      if (state && state.scene) {
        return state.scene.clone();
      }
    }
    return null;
  }

  redo(): Scene | null {
    if (this.currentIndex < this.states.length - 1) {
      this.currentIndex++;
      const state = this.states[this.currentIndex];
      if (state && state.scene) {
        return state.scene.clone();
      }
    }
    return null;
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.states.length - 1;
  }

  getCurrentState(): Scene | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.states.length) {
      const state = this.states[this.currentIndex];
      if (state && state.scene) {
        return state.scene.clone();
      }
    }
    return null;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getStateCount(): number {
    return this.states.length;
  }

  clear(): void {
    this.states = [];
    this.currentIndex = -1;
  }

  getCurrentDelta(): Delta | undefined {
    if (this.currentIndex >= 0 && this.currentIndex < this.states.length) {
      const state = this.states[this.currentIndex];
      if (state) {
        return state.delta;
      }
    }
    return undefined;
  }

  getDeltaAt(index: number): Delta | undefined {
    if (index >= 0 && index < this.states.length) {
      const state = this.states[index];
      if (state) {
        return state.delta;
      }
    }
    return undefined;
  }
}
