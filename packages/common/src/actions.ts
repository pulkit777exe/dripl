import type { DriplElement, Point } from "./types/element";
import { Scene } from "./scene";
import type { Delta, DeltaManager } from "./delta";

export type ActionType =
  | "ADD_ELEMENT"
  | "UPDATE_ELEMENT"
  | "DELETE_ELEMENT"
  | "RESTORE_ELEMENT"
  | "SELECT_ELEMENT"
  | "DESELECT_ELEMENT"
  | "SELECT_ALL"
  | "CLEAR_SELECTION"
  | "TOGGLE_SELECTION"
  | "START_EDITING_TEXT"
  | "STOP_EDITING_TEXT";

export interface Action {
  type: ActionType;
  payload: any;
  timestamp: number;
  id: string;
}

export interface AddElementAction extends Action {
  type: "ADD_ELEMENT";
  payload: {
    element: DriplElement;
  };
}

export interface UpdateElementAction extends Action {
  type: "UPDATE_ELEMENT";
  payload: {
    elementId: string;
    updates: Partial<DriplElement>;
  };
}

export interface DeleteElementAction extends Action {
  type: "DELETE_ELEMENT";
  payload: {
    elementId: string;
  };
}

export interface RestoreElementAction extends Action {
  type: "RESTORE_ELEMENT";
  payload: {
    elementId: string;
  };
}

export interface SelectElementAction extends Action {
  type: "SELECT_ELEMENT";
  payload: {
    elementId: string;
  };
}

export interface DeselectElementAction extends Action {
  type: "DESELECT_ELEMENT";
  payload: {
    elementId: string;
  };
}

export interface SelectAllAction extends Action {
  type: "SELECT_ALL";
}

export interface ClearSelectionAction extends Action {
  type: "CLEAR_SELECTION";
}

export interface ToggleSelectionAction extends Action {
  type: "TOGGLE_SELECTION";
  payload: {
    elementId: string;
  };
}

export interface StartEditingTextAction extends Action {
  type: "START_EDITING_TEXT";
  payload: {
    elementId: string;
  };
}

export interface StopEditingTextAction extends Action {
  type: "STOP_EDITING_TEXT";
}

export class ActionCreator {
  static addElement(element: DriplElement): AddElementAction {
    return {
      type: "ADD_ELEMENT",
      payload: { element },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static updateElement(
    elementId: string,
    updates: Partial<DriplElement>,
  ): UpdateElementAction {
    return {
      type: "UPDATE_ELEMENT",
      payload: { elementId, updates },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static deleteElement(elementId: string): DeleteElementAction {
    return {
      type: "DELETE_ELEMENT",
      payload: { elementId },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static restoreElement(elementId: string): RestoreElementAction {
    return {
      type: "RESTORE_ELEMENT",
      payload: { elementId },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static selectElement(elementId: string): SelectElementAction {
    return {
      type: "SELECT_ELEMENT",
      payload: { elementId },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static deselectElement(elementId: string): DeselectElementAction {
    return {
      type: "DESELECT_ELEMENT",
      payload: { elementId },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static selectAll(): SelectAllAction {
    return {
      type: "SELECT_ALL",
      payload: {},
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static clearSelection(): ClearSelectionAction {
    return {
      type: "CLEAR_SELECTION",
      payload: {},
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static toggleSelection(elementId: string): ToggleSelectionAction {
    return {
      type: "TOGGLE_SELECTION",
      payload: { elementId },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static startEditingText(elementId: string): StartEditingTextAction {
    return {
      type: "START_EDITING_TEXT",
      payload: { elementId },
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  static stopEditingText(): StopEditingTextAction {
    return {
      type: "STOP_EDITING_TEXT",
      payload: {},
      timestamp: Date.now(),
      id: ActionCreator.generateId(),
    };
  }

  private static generateId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export class ActionReducer {
  static reduce(
    scene: Scene,
    action: Action,
    deltaManager?: DeltaManager,
  ): Scene {
    const clonedScene = scene.clone();

    switch (action.type) {
      case "ADD_ELEMENT": {
        const { element } = (action as AddElementAction).payload;
        clonedScene.addElement(element);
        if (deltaManager) {
          deltaManager.createAddDelta(element);
        }
        break;
      }

      case "UPDATE_ELEMENT": {
        const { elementId, updates } = (action as UpdateElementAction).payload;
        const existingElement = scene.getElement(elementId);
        if (existingElement) {
          clonedScene.updateElement(elementId, updates);
          if (deltaManager) {
            deltaManager.createUpdateDelta(elementId, existingElement, updates);
          }
        }
        break;
      }

      case "DELETE_ELEMENT": {
        const { elementId } = (action as DeleteElementAction).payload;
        const existingElement = scene.getElement(elementId);
        if (existingElement) {
          clonedScene.deleteElement(elementId);
          if (deltaManager) {
            deltaManager.createDeleteDelta(elementId, existingElement);
          }
        }
        break;
      }

      case "RESTORE_ELEMENT": {
        const { elementId } = (action as RestoreElementAction).payload;
        const existingElement = scene.getElement(elementId);
        if (existingElement) {
          clonedScene.restoreElement(elementId);
          if (deltaManager) {
            deltaManager.createRestoreDelta(elementId, existingElement);
          }
        }
        break;
      }

      case "SELECT_ELEMENT": {
        const { elementId } = (action as SelectElementAction).payload;
        if (scene.getElement(elementId)) {
          clonedScene.setSelectedElements([elementId]);
        }
        break;
      }

      case "DESELECT_ELEMENT": {
        const { elementId } = (action as DeselectElementAction).payload;
        clonedScene.toggleElementSelection(elementId);
        break;
      }

      case "SELECT_ALL": {
        const allIds = scene.getElements().map((el) => el.id);
        clonedScene.setSelectedElements(allIds);
        break;
      }

      case "CLEAR_SELECTION": {
        clonedScene.clearSelection();
        break;
      }

      case "TOGGLE_SELECTION": {
        const { elementId } = (action as ToggleSelectionAction).payload;
        if (scene.getElement(elementId)) {
          clonedScene.toggleElementSelection(elementId);
        }
        break;
      }

      case "START_EDITING_TEXT": {
        const { elementId } = (action as StartEditingTextAction).payload;
        if (scene.getElement(elementId)) {
          clonedScene.setEditingTextId(elementId);
        }
        break;
      }

      case "STOP_EDITING_TEXT": {
        clonedScene.setEditingTextId(null);
        break;
      }
    }

    return clonedScene;
  }
}

export class ActionDispatcher {
  private subscribers: Set<(action: Action) => void> = new Set();

  dispatch(action: Action): void {
    this.subscribers.forEach((subscriber) => subscriber(action));
  }

  subscribe(callback: (action: Action) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  unsubscribe(callback: (action: Action) => void): void {
    this.subscribers.delete(callback);
  }
}
