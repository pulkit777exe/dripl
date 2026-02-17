import { Scene } from "./scene";
export class DeltaManager {
    deltas = [];
    maxHistorySize = 100;
    createAddDelta(element) {
        const delta = {
            id: this.generateId(),
            operation: "add",
            elementId: element.id,
            timestamp: Date.now(),
            after: element,
        };
        this.addDelta(delta);
        return delta;
    }
    createUpdateDelta(elementId, before, after) {
        const delta = {
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
    createDeleteDelta(elementId, before) {
        const delta = {
            id: this.generateId(),
            operation: "delete",
            elementId: elementId,
            timestamp: Date.now(),
            before,
        };
        this.addDelta(delta);
        return delta;
    }
    createRestoreDelta(elementId, after) {
        const delta = {
            id: this.generateId(),
            operation: "restore",
            elementId: elementId,
            timestamp: Date.now(),
            after,
        };
        this.addDelta(delta);
        return delta;
    }
    applyDelta(scene, delta) {
        const clonedScene = scene.clone();
        switch (delta.operation) {
            case "add":
                if (delta.after) {
                    clonedScene.addElement(delta.after);
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
    applyDeltas(scene, deltas) {
        let result = scene;
        deltas.forEach((delta) => {
            result = this.applyDelta(result, delta);
        });
        return result;
    }
    revertDelta(scene, delta) {
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
    revertDeltas(scene, deltas) {
        let result = scene;
        [...deltas].reverse().forEach((delta) => {
            result = this.revertDelta(result, delta);
        });
        return result;
    }
    getDeltas() {
        return [...this.deltas];
    }
    getDeltasSince(index) {
        return this.deltas.slice(index);
    }
    getDelta(id) {
        return this.deltas.find((d) => d.id === id);
    }
    clear() {
        this.deltas = [];
    }
    getSize() {
        return this.deltas.length;
    }
    isEmpty() {
        return this.deltas.length === 0;
    }
    addDelta(delta) {
        this.deltas.push(delta);
        if (this.deltas.length > this.maxHistorySize) {
            this.deltas.shift();
        }
    }
    generateId() {
        return `delta_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
export class SceneHistory {
    states = [];
    currentIndex = -1;
    maxHistorySize = 50;
    constructor(initialScene) {
        if (initialScene) {
            this.states.push({ scene: initialScene });
            this.currentIndex = 0;
        }
    }
    pushState(scene, delta) {
        if (this.currentIndex < this.states.length - 1) {
            this.states = this.states.slice(0, this.currentIndex + 1);
        }
        this.states.push(delta !== undefined ?
            { scene: scene.clone(), delta } :
            { scene: scene.clone() });
        this.currentIndex++;
        if (this.states.length > this.maxHistorySize) {
            this.states.shift();
            this.currentIndex--;
        }
    }
    undo() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            const state = this.states[this.currentIndex];
            if (state && state.scene) {
                return state.scene.clone();
            }
        }
        return null;
    }
    redo() {
        if (this.currentIndex < this.states.length - 1) {
            this.currentIndex++;
            const state = this.states[this.currentIndex];
            if (state && state.scene) {
                return state.scene.clone();
            }
        }
        return null;
    }
    canUndo() {
        return this.currentIndex > 0;
    }
    canRedo() {
        return this.currentIndex < this.states.length - 1;
    }
    getCurrentState() {
        if (this.currentIndex >= 0 && this.currentIndex < this.states.length) {
            const state = this.states[this.currentIndex];
            if (state && state.scene) {
                return state.scene.clone();
            }
        }
        return null;
    }
    getCurrentIndex() {
        return this.currentIndex;
    }
    getStateCount() {
        return this.states.length;
    }
    clear() {
        this.states = [];
        this.currentIndex = -1;
    }
    getCurrentDelta() {
        if (this.currentIndex >= 0 && this.currentIndex < this.states.length) {
            const state = this.states[this.currentIndex];
            if (state) {
                return state.delta;
            }
        }
        return undefined;
    }
    getDeltaAt(index) {
        if (index >= 0 && index < this.states.length) {
            const state = this.states[index];
            if (state) {
                return state.delta;
            }
        }
        return undefined;
    }
}
//# sourceMappingURL=delta.js.map