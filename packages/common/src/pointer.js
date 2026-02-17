export class PointerManager {
    container;
    activePointers = new Map();
    subscribers = new Set();
    lastPosition = new Map();
    downPosition = new Map();
    constructor(container = null) {
        this.container = container;
        if (container) {
            this.setupEventListeners();
        }
    }
    setContainer(container) {
        if (this.container) {
            this.removeEventListeners();
        }
        this.container = container;
        this.setupEventListeners();
    }
    getActivePointerCount() {
        return this.activePointers.size;
    }
    getActivePointers() {
        return Array.from(this.activePointers.values());
    }
    getPointer(id) {
        return this.activePointers.get(id);
    }
    getLastPosition(id) {
        return this.lastPosition.get(id);
    }
    getDownPosition(id) {
        return this.downPosition.get(id);
    }
    getMovement(id) {
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
    getTotalMovement(id) {
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
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }
    unsubscribe(callback) {
        this.subscribers.delete(callback);
    }
    setupEventListeners() {
        if (!this.container)
            return;
        this.container.addEventListener("pointerdown", this.handlePointerDown);
        this.container.addEventListener("pointermove", this.handlePointerMove);
        this.container.addEventListener("pointerup", this.handlePointerUp);
        this.container.addEventListener("pointercancel", this.handlePointerCancel);
        this.container.addEventListener("pointerleave", this.handlePointerUp);
    }
    removeEventListeners() {
        if (!this.container)
            return;
        this.container.removeEventListener("pointerdown", this.handlePointerDown);
        this.container.removeEventListener("pointermove", this.handlePointerMove);
        this.container.removeEventListener("pointerup", this.handlePointerUp);
        this.container.removeEventListener("pointercancel", this.handlePointerCancel);
        this.container.removeEventListener("pointerleave", this.handlePointerUp);
    }
    handlePointerDown = (e) => {
        const pointerInfo = this.createPointerInfo(e);
        this.activePointers.set(e.pointerId, pointerInfo);
        this.downPosition.set(e.pointerId, { ...pointerInfo.point });
        this.lastPosition.set(e.pointerId, { ...pointerInfo.point });
        this.dispatchEvent({
            type: "pointer_down",
            pointer: pointerInfo,
            timestamp: Date.now(),
        });
    };
    handlePointerMove = (e) => {
        if (!this.activePointers.has(e.pointerId))
            return;
        const pointerInfo = this.createPointerInfo(e);
        this.lastPosition.set(e.pointerId, this.activePointers.get(e.pointerId).point);
        this.activePointers.set(e.pointerId, pointerInfo);
        this.dispatchEvent({
            type: "pointer_move",
            pointer: pointerInfo,
            timestamp: Date.now(),
        });
    };
    handlePointerUp = (e) => {
        const pointerInfo = this.activePointers.get(e.pointerId);
        if (!pointerInfo)
            return;
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
    handlePointerCancel = (e) => {
        const pointerInfo = this.activePointers.get(e.pointerId);
        if (!pointerInfo)
            return;
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
    createPointerInfo(e) {
        let button = null;
        if (e.button === 0)
            button = "left";
        if (e.button === 1)
            button = "middle";
        if (e.button === 2)
            button = "right";
        return {
            id: e.pointerId,
            type: this.getPointerType(e.pointerType),
            point: this.getCanvasPoint(e),
            pressure: e.pressure,
            timestamp: e.timeStamp,
            button: button,
        };
    }
    getPointerType(pointerType) {
        if (pointerType === "mouse")
            return "mouse";
        if (pointerType === "touch")
            return "touch";
        if (pointerType === "pen")
            return "pen";
        return "mouse"; // Default to mouse for unknown types
    }
    getCanvasPoint(e) {
        if (!this.container) {
            return { x: e.clientX, y: e.clientY };
        }
        const rect = this.container.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }
    dispatchEvent(event) {
        this.subscribers.forEach((callback) => {
            try {
                callback(event);
            }
            catch (error) {
                console.error("Error in pointer event handler:", error);
            }
        });
    }
}
export class DragDetector {
    pointerManager;
    isDragging = false;
    dragStart = null;
    dragEnd = null;
    minDragDistance = 5;
    constructor(pointerManager) {
        this.pointerManager = pointerManager;
        pointerManager.subscribe(this.handlePointerEvent.bind(this));
    }
    setMinDragDistance(distance) {
        this.minDragDistance = distance;
    }
    getMinDragDistance() {
        return this.minDragDistance;
    }
    isDraggingState() {
        return this.isDragging;
    }
    getDragStart() {
        return this.dragStart;
    }
    getDragEnd() {
        return this.dragEnd;
    }
    getDragDistance() {
        if (this.dragStart && this.dragEnd) {
            const dx = this.dragEnd.x - this.dragStart.x;
            const dy = this.dragEnd.y - this.dragStart.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        return 0;
    }
    handlePointerEvent(event) {
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
//# sourceMappingURL=pointer.js.map