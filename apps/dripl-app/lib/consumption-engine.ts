import type { DriplElement } from "@dripl/common";
import {
  ReconciliationManager,
  reconcileElements,
  calculateDirtyRegions,
  getNextVersion,
  withVersion,
} from "./reconciliation";

/**
 * Consumption Engine
 * 
 * Per TDD Section 5.4:
 * - Accepts new/updated elements
 * - Validates versions
 * - Applies reconciliation rules
 * - Marks dirty regions
 * - Schedules partial re-render
 * 
 * Flow:
 * Incoming Diff → Reconciliation → Scene Store Update → Dirty Marking → Engine Paint
 */

export interface ConsumptionOptions {
  autoVersion?: boolean;
  enableDirtyTracking?: boolean;
}

export interface ConsumptionResult {
  elements: DriplElement[];
  dirtyRegions: Array<{ x: number; y: number; width: number; height: number }>;
  version: number;
}

export type ConsumptionCallback = (result: ConsumptionResult) => void;

export class ConsumptionEngine {
  private reconciliationManager: ReconciliationManager;
  private localElements: Map<string, DriplElement> = new Map();
  private currentVersion: number = 0;
  private options: ConsumptionOptions;
  private callbacks: Set<ConsumptionCallback> = new Set();
  private dirtyRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
  private pendingRender: boolean = false;

  constructor(options: ConsumptionOptions = {}) {
    this.reconciliationManager = new ReconciliationManager();
    this.options = {
      autoVersion: true,
      enableDirtyTracking: true,
      ...options,
    };
  }

  /**
   * Initialize with existing elements (e.g., on room join)
   */
  initialize(elements: DriplElement[]): void {
    this.localElements.clear();
    elements.forEach((el) => {
      this.localElements.set(el.id, el);
      if ((el.version ?? 0) > this.currentVersion) {
        this.currentVersion = el.version ?? 0;
      }
    });
  }

  /**
   * Process incoming diff from WebSocket
   * Per TDD flow: Incoming Diff → Reconciliation → Scene Store Update → Dirty Marking → Engine Paint
   */
  consume(incomingElements: DriplElement[]): ConsumptionResult {
    const localArray = Array.from(this.localElements.values());
    
    // Step 1: Reconciliation (per TDD Section 5.4)
    const reconciliationResult = reconcileElements(localArray, incomingElements);
    
    if (reconciliationResult.accepted.length === 0) {
      return {
        elements: localArray,
        dirtyRegions: [],
        version: this.currentVersion,
      };
    }

    // Step 2: Apply auto-versioning if enabled
    let processedElements = reconciliationResult.accepted;
    if (this.options.autoVersion) {
      processedElements = processedElements.map((el) => {
        const local = this.localElements.get(el.id);
        const nextVersion = getNextVersion(local?.version);
        return withVersion(el, nextVersion);
      });
    }

    // Step 3: Update local elements map
    processedElements.forEach((el) => {
      this.localElements.set(el.id, el);
      if ((el.version ?? 0) > this.currentVersion) {
        this.currentVersion = el.version ?? 0;
      }
    });

    // Step 4: Calculate dirty regions for partial re-render (per TDD Section 12.1)
    if (this.options.enableDirtyTracking) {
      this.dirtyRegions = calculateDirtyRegions(
        processedElements,
        new Map(localArray.map((el) => [el.id, el])),
      );
      this.pendingRender = true;
    }

    // Step 5: Notify subscribers
    const result: ConsumptionResult = {
      elements: Array.from(this.localElements.values()),
      dirtyRegions: this.dirtyRegions,
      version: this.currentVersion,
    };

    this.notifyCallbacks(result);

    return result;
  }

  /**
   * Apply a single element update
   */
  consumeElement(element: DriplElement): ConsumptionResult {
    return this.consume([element]);
  }

  /**
   * Delete elements
   */
  deleteElements(elementIds: string[]): ConsumptionResult {
    elementIds.forEach((id) => {
      this.localElements.delete(id);
    });

    this.pendingRender = true;
    this.dirtyRegions = []; // Full re-render needed on delete

    const result: ConsumptionResult = {
      elements: Array.from(this.localElements.values()),
      dirtyRegions: this.dirtyRegions,
      version: this.currentVersion,
    };

    this.notifyCallbacks(result);
    return result;
  }

  /**
   * Get current elements
   */
  getElements(): DriplElement[] {
    return Array.from(this.localElements.values());
  }

  /**
   * Get current version
   */
  getVersion(): number {
    return this.currentVersion;
  }

  /**
   * Get dirty regions for partial re-render
   */
  getDirtyRegions(): Array<{ x: number; y: number; width: number; height: number }> {
    return this.dirtyRegions;
  }

  /**
   * Check if pending render needed
   */
  hasPendingRender(): boolean {
    return this.pendingRender;
  }

  /**
   * Clear pending render flag
   */
  clearPendingRender(): void {
    this.pendingRender = false;
  }

  /**
   * Subscribe to consumption events
   */
  subscribe(callback: ConsumptionCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers
   */
  private notifyCallbacks(result: ConsumptionResult): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(result);
      } catch (error) {
        console.error("[ConsumptionEngine] Callback error:", error);
      }
    });
  }

  /**
   * Validate element schema
   * Per TDD: schema validation for AI-generated content
   */
  validateElement(element: unknown): element is DriplElement {
    if (!element || typeof element !== "object") return false;
    
    const el = element as Record<string, unknown>;
    return (
      typeof el.id === "string" &&
      typeof el.type === "string" &&
      typeof el.x === "number" &&
      typeof el.y === "number" &&
      typeof el.width === "number" &&
      typeof el.height === "number"
    );
  }

  /**
   * Validate array of elements
   */
  validateElements(elements: unknown[]): DriplElement[] {
    return elements.filter((el): el is DriplElement => this.validateElement(el));
  }
}

/**
 * Create a consumption engine instance
 */
export function createConsumptionEngine(options?: ConsumptionOptions): ConsumptionEngine {
  return new ConsumptionEngine(options);
}

export default ConsumptionEngine;
