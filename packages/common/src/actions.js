import { Scene } from "./scene";
export class ActionCreator {
    static addElement(element) {
        return {
            type: "ADD_ELEMENT",
            payload: { element },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static updateElement(elementId, updates) {
        return {
            type: "UPDATE_ELEMENT",
            payload: { elementId, updates },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static deleteElement(elementId) {
        return {
            type: "DELETE_ELEMENT",
            payload: { elementId },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static restoreElement(elementId) {
        return {
            type: "RESTORE_ELEMENT",
            payload: { elementId },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static selectElement(elementId) {
        return {
            type: "SELECT_ELEMENT",
            payload: { elementId },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static deselectElement(elementId) {
        return {
            type: "DESELECT_ELEMENT",
            payload: { elementId },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static selectAll() {
        return {
            type: "SELECT_ALL",
            payload: {},
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static clearSelection() {
        return {
            type: "CLEAR_SELECTION",
            payload: {},
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static toggleSelection(elementId) {
        return {
            type: "TOGGLE_SELECTION",
            payload: { elementId },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static startEditingText(elementId) {
        return {
            type: "START_EDITING_TEXT",
            payload: { elementId },
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static stopEditingText() {
        return {
            type: "STOP_EDITING_TEXT",
            payload: {},
            timestamp: Date.now(),
            id: ActionCreator.generateId(),
        };
    }
    static generateId() {
        return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
export class ActionReducer {
    static reduce(scene, action, deltaManager) {
        const clonedScene = scene.clone();
        switch (action.type) {
            case "ADD_ELEMENT": {
                const { element } = action.payload;
                clonedScene.addElement(element);
                if (deltaManager) {
                    deltaManager.createAddDelta(element);
                }
                break;
            }
            case "UPDATE_ELEMENT": {
                const { elementId, updates } = action.payload;
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
                const { elementId } = action.payload;
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
                const { elementId } = action.payload;
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
                const { elementId } = action.payload;
                if (scene.getElement(elementId)) {
                    clonedScene.setSelectedElements([elementId]);
                }
                break;
            }
            case "DESELECT_ELEMENT": {
                const { elementId } = action.payload;
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
                const { elementId } = action.payload;
                if (scene.getElement(elementId)) {
                    clonedScene.toggleElementSelection(elementId);
                }
                break;
            }
            case "START_EDITING_TEXT": {
                const { elementId } = action.payload;
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
    subscribers = new Set();
    dispatch(action) {
        this.subscribers.forEach((subscriber) => subscriber(action));
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }
    unsubscribe(callback) {
        this.subscribers.delete(callback);
    }
}
//# sourceMappingURL=actions.js.map