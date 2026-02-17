import type { DriplElement } from "./types/element";
import { Scene } from "./scene";
import type { DeltaManager } from "./delta";
export type ActionType = "ADD_ELEMENT" | "UPDATE_ELEMENT" | "DELETE_ELEMENT" | "RESTORE_ELEMENT" | "SELECT_ELEMENT" | "DESELECT_ELEMENT" | "SELECT_ALL" | "CLEAR_SELECTION" | "TOGGLE_SELECTION" | "START_EDITING_TEXT" | "STOP_EDITING_TEXT";
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
export declare class ActionCreator {
    static addElement(element: DriplElement): AddElementAction;
    static updateElement(elementId: string, updates: Partial<DriplElement>): UpdateElementAction;
    static deleteElement(elementId: string): DeleteElementAction;
    static restoreElement(elementId: string): RestoreElementAction;
    static selectElement(elementId: string): SelectElementAction;
    static deselectElement(elementId: string): DeselectElementAction;
    static selectAll(): SelectAllAction;
    static clearSelection(): ClearSelectionAction;
    static toggleSelection(elementId: string): ToggleSelectionAction;
    static startEditingText(elementId: string): StartEditingTextAction;
    static stopEditingText(): StopEditingTextAction;
    private static generateId;
}
export declare class ActionReducer {
    static reduce(scene: Scene, action: Action, deltaManager?: DeltaManager): Scene;
}
export declare class ActionDispatcher {
    private subscribers;
    dispatch(action: Action): void;
    subscribe(callback: (action: Action) => void): () => void;
    unsubscribe(callback: (action: Action) => void): void;
}
//# sourceMappingURL=actions.d.ts.map