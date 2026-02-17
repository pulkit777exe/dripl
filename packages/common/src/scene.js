export class Scene {
    elements = new Map();
    selectedElementIds = new Set();
    editingTextId = null;
    constructor(initialElements = []) {
        initialElements.forEach((element) => {
            if (!element.isDeleted) {
                this.elements.set(element.id, element);
            }
        });
    }
    getElements() {
        return Array.from(this.elements.values()).filter((element) => !element.isDeleted);
    }
    getElement(id) {
        return this.elements.get(id);
    }
    addElement(element) {
        this.elements.set(element.id, element);
    }
    updateElement(id, updates) {
        const element = this.elements.get(id);
        if (element) {
            this.elements.set(id, { ...element, ...updates });
        }
    }
    deleteElement(id) {
        const element = this.elements.get(id);
        if (element) {
            this.elements.set(id, { ...element, isDeleted: true });
            this.selectedElementIds.delete(id);
        }
    }
    deleteElements(ids) {
        ids.forEach((id) => this.deleteElement(id));
    }
    restoreElement(id) {
        const element = this.elements.get(id);
        if (element) {
            this.elements.set(id, { ...element, isDeleted: false });
        }
    }
    getSelectedElements() {
        return Array.from(this.selectedElementIds)
            .map((id) => this.elements.get(id))
            .filter((element) => element !== undefined && !element.isDeleted);
    }
    setSelectedElements(ids) {
        this.selectedElementIds = new Set(ids);
    }
    toggleElementSelection(id) {
        if (this.selectedElementIds.has(id)) {
            this.selectedElementIds.delete(id);
        }
        else {
            this.selectedElementIds.add(id);
        }
    }
    clearSelection() {
        this.selectedElementIds.clear();
    }
    getEditingTextId() {
        return this.editingTextId;
    }
    setEditingTextId(id) {
        this.editingTextId = id;
    }
    isSelected(id) {
        return this.selectedElementIds.has(id);
    }
    hasSelection() {
        return this.selectedElementIds.size > 0;
    }
    getBounds() {
        const activeElements = this.getElements();
        if (activeElements.length === 0)
            return null;
        const minX = Math.min(...activeElements.map((el) => el.x));
        const minY = Math.min(...activeElements.map((el) => el.y));
        const maxX = Math.max(...activeElements.map((el) => el.x + el.width));
        const maxY = Math.max(...activeElements.map((el) => el.y + el.height));
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }
    getSelectedBounds() {
        const selectedElements = this.getSelectedElements();
        if (selectedElements.length === 0)
            return null;
        const minX = Math.min(...selectedElements.map((el) => el.x));
        const minY = Math.min(...selectedElements.map((el) => el.y));
        const maxX = Math.max(...selectedElements.map((el) => el.x + el.width));
        const maxY = Math.max(...selectedElements.map((el) => el.y + el.height));
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }
    clone() {
        const cloned = new Scene();
        this.getElements().forEach((element) => {
            cloned.addElement({ ...element });
        });
        cloned.setSelectedElements(Array.from(this.selectedElementIds));
        cloned.setEditingTextId(this.editingTextId);
        return cloned;
    }
    toJSON() {
        return {
            elements: this.getElements(),
            selectedElementIds: new Set(this.selectedElementIds),
            editingTextId: this.editingTextId,
        };
    }
    static fromJSON(data) {
        const scene = new Scene(data.elements);
        scene.setSelectedElements(Array.from(data.selectedElementIds));
        scene.setEditingTextId(data.editingTextId);
        return scene;
    }
}
//# sourceMappingURL=scene.js.map