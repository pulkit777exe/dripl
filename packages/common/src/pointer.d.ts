import type { Point } from "./types/element";
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
export declare class PointerManager {
    private container;
    private activePointers;
    private subscribers;
    private lastPosition;
    private downPosition;
    constructor(container?: HTMLElement | null);
    setContainer(container: HTMLElement): void;
    getActivePointerCount(): number;
    getActivePointers(): PointerInfo[];
    getPointer(id: number): PointerInfo | undefined;
    getLastPosition(id: number): Point | undefined;
    getDownPosition(id: number): Point | undefined;
    getMovement(id: number): Point;
    getTotalMovement(id: number): Point;
    subscribe(callback: (event: PointerEventData) => void): () => void;
    unsubscribe(callback: (event: PointerEventData) => void): void;
    private setupEventListeners;
    private removeEventListeners;
    private handlePointerDown;
    private handlePointerMove;
    private handlePointerUp;
    private handlePointerCancel;
    private createPointerInfo;
    private getPointerType;
    private getCanvasPoint;
    private dispatchEvent;
}
export declare class DragDetector {
    private pointerManager;
    private isDragging;
    private dragStart;
    private dragEnd;
    private minDragDistance;
    constructor(pointerManager: PointerManager);
    setMinDragDistance(distance: number): void;
    getMinDragDistance(): number;
    isDraggingState(): boolean;
    getDragStart(): Point | null;
    getDragEnd(): Point | null;
    getDragDistance(): number;
    private handlePointerEvent;
}
//# sourceMappingURL=pointer.d.ts.map