import type { Point, DriplElement } from "./types/element";

export type PointerType = "mouse" | "touch" | "pen";

export interface PointerInfo {
  id: number;
  type: PointerType;
  point: Point;
  pressure: number;
  timestamp: number;
  button: "left" | "middle" | "right" | null;
}

export interface PointerEventData {
  type: "pointer_down" | "pointer_move" | "pointer_up" | "pointer_cancel";
  pointer: PointerInfo;
  timestamp: number;
}

/**
 * Snapshot of element state at pointer down for baseline-derived interaction.
 * Spec §4.6 Interaction Engine. Use to compute final geometry from baseline + pointer delta
 * instead of incremental updates (avoids drift, predictable undo).
 */
export interface PointerDownState {
  /** Pointer id. */
  pointerId: number;
  /** Canvas point at pointer down. */
  downPoint: Point;
  /** Frozen copy of elements involved (e.g. selected) at pointer down. */
  originalElements: ReadonlyArray<DriplElement>;
  /** Element ids that are being dragged/transformed. */
  elementIds: ReadonlyArray<string>;
  timestamp: number;
}

export class PointerManager {
  private activePointers: Map<number, PointerInfo> = new Map();
  private subscribers: Set<(event: PointerEventData) => void> = new Set();
  private lastPosition: Map<number, Point> = new Map();
  private downPosition: Map<number, Point> = new Map();

  constructor(private container: HTMLElement | null = null) {
    if (container) {
      this.setupEventListeners();
    }
  }

  setContainer(container: HTMLElement): void {
    if (this.container) {
      this.removeEventListeners();
    }

    this.container = container;
    this.setupEventListeners();
  }

  getActivePointerCount(): number {
    return this.activePointers.size;
  }

  getActivePointers(): PointerInfo[] {
    return Array.from(this.activePointers.values());
  }

  getPointer(id: number): PointerInfo | undefined {
    return this.activePointers.get(id);
  }

  getLastPosition(id: number): Point | undefined {
    return this.lastPosition.get(id);
  }

  getDownPosition(id: number): Point | undefined {
    return this.downPosition.get(id);
  }

  getMovement(id: number): Point {
    const current = this.getPointer(id);
    const last = this.getLastPosition(id);

    if (current && last) {
      return {
        x: current.point.x - last.x,
        y: current.point.y - last.y,
      };
    }

    return { x: 0, y: 0 };
  }

  getTotalMovement(id: number): Point {
    const current = this.getPointer(id);
    const down = this.getDownPosition(id);

    if (current && down) {
      return {
        x: current.point.x - down.x,
        y: current.point.y - down.y,
      };
    }

    return { x: 0, y: 0 };
  }

  subscribe(callback: (event: PointerEventData) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  unsubscribe(callback: (event: PointerEventData) => void): void {
    this.subscribers.delete(callback);
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerup", this.handlePointerUp);
    this.container.addEventListener("pointercancel", this.handlePointerCancel);
    this.container.addEventListener("pointerleave", this.handlePointerUp);
  }

  private removeEventListeners(): void {
    if (!this.container) return;

    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerup", this.handlePointerUp);
    this.container.removeEventListener(
      "pointercancel",
      this.handlePointerCancel,
    );
    this.container.removeEventListener("pointerleave", this.handlePointerUp);
  }

  private handlePointerDown = (e: globalThis.PointerEvent): void => {
    const pointerInfo: PointerInfo = this.createPointerInfo(e);
    this.activePointers.set(e.pointerId, pointerInfo);
    this.downPosition.set(e.pointerId, { ...pointerInfo.point });
    this.lastPosition.set(e.pointerId, { ...pointerInfo.point });

    this.dispatchEvent({
      type: "pointer_down",
      pointer: pointerInfo,
      timestamp: Date.now(),
    });
  };

  private handlePointerMove = (e: globalThis.PointerEvent): void => {
    if (!this.activePointers.has(e.pointerId)) return;

    const pointerInfo: PointerInfo = this.createPointerInfo(e);
    this.lastPosition.set(
      e.pointerId,
      this.activePointers.get(e.pointerId)!.point,
    );
    this.activePointers.set(e.pointerId, pointerInfo);

    this.dispatchEvent({
      type: "pointer_move",
      pointer: pointerInfo,
      timestamp: Date.now(),
    });
  };

  private handlePointerUp = (e: globalThis.PointerEvent): void => {
    const pointerInfo = this.activePointers.get(e.pointerId);
    if (!pointerInfo) return;

    const finalInfo = this.createPointerInfo(e);

    this.dispatchEvent({
      type: "pointer_up",
      pointer: finalInfo,
      timestamp: Date.now(),
    });

    this.activePointers.delete(e.pointerId);
    this.lastPosition.delete(e.pointerId);
    this.downPosition.delete(e.pointerId);
  };

  private handlePointerCancel = (e: globalThis.PointerEvent): void => {
    const pointerInfo = this.activePointers.get(e.pointerId);
    if (!pointerInfo) return;

    const finalInfo = this.createPointerInfo(e);

    this.dispatchEvent({
      type: "pointer_cancel",
      pointer: finalInfo,
      timestamp: Date.now(),
    });

    this.activePointers.delete(e.pointerId);
    this.lastPosition.delete(e.pointerId);
    this.downPosition.delete(e.pointerId);
  };

  private createPointerInfo(e: globalThis.PointerEvent): PointerInfo {
    let button: "left" | "middle" | "right" | null = null;

    if (e.button === 0) button = "left";
    if (e.button === 1) button = "middle";
    if (e.button === 2) button = "right";

    return {
      id: e.pointerId,
      type: this.getPointerType(e.pointerType),
      point: this.getCanvasPoint(e),
      pressure: e.pressure,
      timestamp: e.timeStamp,
      button: button,
    };
  }

  private getPointerType(pointerType: string): PointerType {
    if (pointerType === "mouse") return "mouse";
    if (pointerType === "touch") return "touch";
    if (pointerType === "pen") return "pen";
    return "mouse"; // Default to mouse for unknown types
  }

  private getCanvasPoint(e: globalThis.PointerEvent): Point {
    if (!this.container) {
      return { x: e.clientX, y: e.clientY };
    }

    const rect = this.container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private dispatchEvent(event: PointerEventData): void {
    this.subscribers.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in pointer event handler:", error);
      }
    });
  }
}

export class DragDetector {
  private isDragging: boolean = false;
  private dragStart: Point | null = null;
  private dragEnd: Point | null = null;
  private minDragDistance: number = 5;

  constructor(private pointerManager: PointerManager) {
    pointerManager.subscribe(this.handlePointerEvent.bind(this));
  }

  setMinDragDistance(distance: number): void {
    this.minDragDistance = distance;
  }

  getMinDragDistance(): number {
    return this.minDragDistance;
  }

  isDraggingState(): boolean {
    return this.isDragging;
  }

  getDragStart(): Point | null {
    return this.dragStart;
  }

  getDragEnd(): Point | null {
    return this.dragEnd;
  }

  getDragDistance(): number {
    if (this.dragStart && this.dragEnd) {
      const dx = this.dragEnd.x - this.dragStart.x;
      const dy = this.dragEnd.y - this.dragStart.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    return 0;
  }

  private handlePointerEvent(event: PointerEventData): void {
    switch (event.type) {
      case "pointer_down":
        this.dragStart = event.pointer.point;
        this.dragEnd = event.pointer.point;
        this.isDragging = false;
        break;

      case "pointer_move":
        if (this.dragStart) {
          this.dragEnd = event.pointer.point;

          if (!this.isDragging) {
            const distance = this.getDragDistance();
            this.isDragging = distance >= this.minDragDistance;
          }
        }
        break;

      case "pointer_up":
      case "pointer_cancel":
        this.dragStart = null;
        this.dragEnd = null;
        this.isDragging = false;
        break;
    }
  }
}
