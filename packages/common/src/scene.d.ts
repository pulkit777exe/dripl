import type { DriplElement } from "./types/element";
export interface SceneState {
    elements: DriplElement[];
    selectedElementIds: Set<string>;
    editingTextId: string | null;
}
export declare class Scene {
    private elements;
    private selectedElementIds;
    private editingTextId;
    constructor(initialElements?: DriplElement[]);
    getElements(): DriplElement[];
    getElement(id: string): DriplElement | undefined;
    addElement(element: DriplElement): void;
    updateElement(id: string, updates: Partial<DriplElement>): void;
    deleteElement(id: string): void;
    deleteElements(ids: string[]): void;
    restoreElement(id: string): void;
    getSelectedElements(): DriplElement[];
    setSelectedElements(ids: string[]): void;
    toggleElementSelection(id: string): void;
    clearSelection(): void;
    getEditingTextId(): string | null;
    setEditingTextId(id: string | null): void;
    isSelected(id: string): boolean;
    hasSelection(): boolean;
    getBounds(): {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    getSelectedBounds(): {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    clone(): Scene;
    toJSON(): SceneState;
    static fromJSON(data: SceneState): Scene;
}
//# sourceMappingURL=scene.d.ts.map