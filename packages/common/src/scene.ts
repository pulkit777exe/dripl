import type { DriplElement } from "./types/element";

export interface SceneState {
  elements: DriplElement[];
  selectedElementIds: Set<string>;
  editingTextId: string | null;
}

export class Scene {
  private elements: Map<string, DriplElement> = new Map();
  private selectedElementIds: Set<string> = new Set();
  private editingTextId: string | null = null;

  constructor(initialElements: DriplElement[] = []) {
    initialElements.forEach((element) => {
      if (!element.isDeleted) {
        this.elements.set(element.id, element);
      }
    });
  }

  getElements(): DriplElement[] {
    return Array.from(this.elements.values()).filter(
      (element) => !element.isDeleted,
    );
  }

  getElement(id: string): DriplElement | undefined {
    return this.elements.get(id);
  }

  addElement(element: DriplElement): void {
    this.elements.set(element.id, element);
  }

  updateElement(id: string, updates: Partial<DriplElement>): void {
    const element = this.elements.get(id);
    if (element) {
      this.elements.set(id, { ...element, ...updates } as DriplElement);
    }
  }

  deleteElement(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      this.elements.set(id, { ...element, isDeleted: true });
      this.selectedElementIds.delete(id);
    }
  }

  deleteElements(ids: string[]): void {
    ids.forEach((id) => this.deleteElement(id));
  }

  restoreElement(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      this.elements.set(id, { ...element, isDeleted: false });
    }
  }

  getSelectedElements(): DriplElement[] {
    return Array.from(this.selectedElementIds)
      .map((id) => this.elements.get(id))
      .filter(
        (element): element is DriplElement =>
          element !== undefined && !element.isDeleted,
      );
  }

  setSelectedElements(ids: string[]): void {
    this.selectedElementIds = new Set(ids);
  }

  toggleElementSelection(id: string): void {
    if (this.selectedElementIds.has(id)) {
      this.selectedElementIds.delete(id);
    } else {
      this.selectedElementIds.add(id);
    }
  }

  clearSelection(): void {
    this.selectedElementIds.clear();
  }

  getEditingTextId(): string | null {
    return this.editingTextId;
  }

  setEditingTextId(id: string | null): void {
    this.editingTextId = id;
  }

  isSelected(id: string): boolean {
    return this.selectedElementIds.has(id);
  }

  hasSelection(): boolean {
    return this.selectedElementIds.size > 0;
  }

  getBounds(): { x: number; y: number; width: number; height: number } | null {
    const activeElements = this.getElements();
    if (activeElements.length === 0) return null;

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

  getSelectedBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const selectedElements = this.getSelectedElements();
    if (selectedElements.length === 0) return null;

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

  clone(): Scene {
    const cloned = new Scene();
    this.getElements().forEach((element) => {
      cloned.addElement({ ...element });
    });
    cloned.setSelectedElements(Array.from(this.selectedElementIds));
    cloned.setEditingTextId(this.editingTextId);
    return cloned;
  }

  toJSON(): SceneState {
    return {
      elements: this.getElements(),
      selectedElementIds: new Set(this.selectedElementIds),
      editingTextId: this.editingTextId,
    };
  }

  static fromJSON(data: SceneState): Scene {
    const scene = new Scene(data.elements);
    scene.setSelectedElements(Array.from(data.selectedElementIds));
    scene.setEditingTextId(data.editingTextId);
    return scene;
  }
}
