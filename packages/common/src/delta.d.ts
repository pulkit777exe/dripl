import type { DriplElement } from "./types/element";
import { Scene } from "./scene";
export type DeltaOperation = "add" | "update" | "delete" | "restore";
export interface Delta {
    id: string;
    operation: DeltaOperation;
    elementId: string;
    timestamp: number;
    before?: Partial<DriplElement>;
    after?: Partial<DriplElement>;
}
export declare class DeltaManager {
    private deltas;
    private maxHistorySize;
    createAddDelta(element: DriplElement): Delta;
    createUpdateDelta(elementId: string, before: Partial<DriplElement>, after: Partial<DriplElement>): Delta;
    createDeleteDelta(elementId: string, before: Partial<DriplElement>): Delta;
    createRestoreDelta(elementId: string, after: Partial<DriplElement>): Delta;
    applyDelta(scene: Scene, delta: Delta): Scene;
    applyDeltas(scene: Scene, deltas: Delta[]): Scene;
    revertDelta(scene: Scene, delta: Delta): Scene;
    revertDeltas(scene: Scene, deltas: Delta[]): Scene;
    getDeltas(): Delta[];
    getDeltasSince(index: number): Delta[];
    getDelta(id: string): Delta | undefined;
    clear(): void;
    getSize(): number;
    isEmpty(): boolean;
    private addDelta;
    private generateId;
}
export declare class SceneHistory {
    private states;
    private currentIndex;
    private maxHistorySize;
    constructor(initialScene?: Scene);
    pushState(scene: Scene, delta?: Delta): void;
    undo(): Scene | null;
    redo(): Scene | null;
    canUndo(): boolean;
    canRedo(): boolean;
    getCurrentState(): Scene | null;
    getCurrentIndex(): number;
    getStateCount(): number;
    clear(): void;
    getCurrentDelta(): Delta | undefined;
    getDeltaAt(index: number): Delta | undefined;
}
//# sourceMappingURL=delta.d.ts.map