import type { DriplElement } from "./types/element";

export interface SceneState {
  elements: DriplElement[];
  selectedElementIds: Set<string>;
  editingTextId: string | null;
}

/**
 * Dual-map Scene: elementsMap (all), nonDeletedElementsMap (active), cached orderedElements.
 * Spec §4.1 Scene (Element Collection Engine). O(1) lookup; ordering stability.
 */
export class Scene {
  /** All elements by id (including deleted). */
  private elementsMap: Map<string, DriplElement> = new Map();
  /** Active elements by id (non-deleted). Kept in sync for O(1) lookup. */
  private nonDeletedElementsMap: Map<string, DriplElement> = new Map();
  /** Cached ordered list of active elements; invalidated on add/delete/order change. */
  private orderedElementsCache: DriplElement[] | null = null;
  private selectedElementIds: Set<string> = new Set();
  private editingTextId: string | null = null;

  constructor(initialElements: DriplElement[] = []) {
    initialElements.forEach((element) => {
      this.elementsMap.set(element.id, element);
      if (!element.isDeleted) {
        this.nonDeletedElementsMap.set(element.id, element);
      }
    });
    this.reindexOrderedElements();
  }

  private reindexOrderedElements(): void {
    this.orderedElementsCache = Array.from(this.nonDeletedElementsMap.values());
  }

  getElements(): DriplElement[] {
    if (this.orderedElementsCache === null) this.reindexOrderedElements();
    return this.orderedElementsCache ?? [];
  }

  getElement(id: string): DriplElement | undefined {
    return this.elementsMap.get(id);
  }

  addElement(element: DriplElement): void {
    this.elementsMap.set(element.id, element);
    if (!element.isDeleted) {
      this.nonDeletedElementsMap.set(element.id, element);
      this.orderedElementsCache = null;
    }
  }

  updateElement(id: string, updates: Partial<DriplElement>): void {
    const element = this.elementsMap.get(id);
    if (!element) return;
    const next = { ...element, ...updates } as DriplElement;
    this.elementsMap.set(id, next);
    if (next.isDeleted) {
      this.nonDeletedElementsMap.delete(id);
      this.selectedElementIds.delete(id);
    } else {
      this.nonDeletedElementsMap.set(id, next);
    }
    this.orderedElementsCache = null;
  }

  deleteElement(id: string): void {
    const element = this.elementsMap.get(id);
    if (element) {
      this.elementsMap.set(id, { ...element, isDeleted: true });
      this.nonDeletedElementsMap.delete(id);
      this.selectedElementIds.delete(id);
      this.orderedElementsCache = null;
    }
  }

  deleteElements(ids: string[]): void {
    ids.forEach((id) => this.deleteElement(id));
  }

  restoreElement(id: string): void {
    const element = this.elementsMap.get(id);
    if (element) {
      this.elementsMap.set(id, { ...element, isDeleted: false });
      this.nonDeletedElementsMap.set(id, { ...element, isDeleted: false });
      this.orderedElementsCache = null;
    }
  }

  getSelectedElements(): DriplElement[] {
    return Array.from(this.selectedElementIds)
      .map((id) => this.elementsMap.get(id))
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
    const cloned = new Scene(this.getElements().map((el) => ({ ...el })));
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
