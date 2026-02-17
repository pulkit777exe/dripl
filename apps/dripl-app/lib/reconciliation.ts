import type { DriplElement } from "@dripl/common";

/**
 * Reconciliation Manager
 * 
 * Per TDD Section 5.4 & 10.2:
 * - Validates versions before applying updates
 * - Uses version-based conflict resolution
 * - Marks dirty regions for partial re-render
 * 
 * Reconciliation Rule:
 * if incoming.version > local.version → accept
 * else → discard
 */

export interface ReconciliationResult {
  accepted: DriplElement[];
  rejected: DriplElement[];
  needsRender: boolean;
}

/**
 * Reconcile incoming elements with local elements based on version
 */
export function reconcileElements(
  localElements: DriplElement[],
  incomingElements: DriplElement[],
): ReconciliationResult {
  const localMap = new Map<string, DriplElement>();
  
  // Build local element map for O(1) lookup
  localElements.forEach((el) => {
    localMap.set(el.id, el);
  });

  const accepted: DriplElement[] = [];
  const rejected: DriplElement[] = [];
  let needsRender = false;

  for (const incoming of incomingElements) {
    const local = localMap.get(incoming.id);

    if (!local) {
      // New element - always accept
      accepted.push(incoming);
      needsRender = true;
      continue;
    }

    // Version-based reconciliation (per TDD)
    const incomingVersion = incoming.version ?? 0;
    const localVersion = local.version ?? 0;

    if (incomingVersion > localVersion) {
      // Accept if incoming version is newer
      accepted.push(incoming);
      needsRender = true;
    } else {
      // Discard if local version is same or newer
      rejected.push(incoming);
    }
  }

  return { accepted, rejected, needsRender };
}

/**
 * Check if an element update should be accepted based on version
 */
export function shouldAcceptUpdate(
  localVersion: number,
  incomingVersion: number,
): boolean {
  return incomingVersion > localVersion;
}

/**
 * Get the next version number for an element
 */
export function getNextVersion(currentVersion: number | undefined): number {
  return (currentVersion ?? 0) + 1;
}

/**
 * Apply version to element when updating
 */
export function withVersion<T extends DriplElement>(
  element: T,
  version?: number,
): T {
  return {
    ...element,
    version: version ?? 1,
    updated: Date.now(),
  };
}

/**
 * Create a new element with initial version
 */
export function createWithInitialVersion<T extends DriplElement>(
  element: T,
): T {
  return {
    ...element,
    version: 1,
    versionNonce: Math.random(),
    updated: Date.now(),
  };
}

/**
 * Merge element updates - accepts the newer version
 */
export function mergeElement(
  local: DriplElement,
  incoming: DriplElement,
): DriplElement {
  const localVersion = local.version ?? 0;
  const incomingVersion = incoming.version ?? 0;

  if (incomingVersion >= localVersion) {
    return {
      ...incoming,
      version: incomingVersion,
      updated: Date.now(),
    };
  }

  return local;
}

/**
 * Calculate dirty regions for elements that changed
 * Per TDD Section 12.1 - enables partial re-render
 */
export function calculateDirtyRegions(
  elements: DriplElement[],
  previousElements: Map<string, DriplElement>,
): Array<{ x: number; y: number; width: number; height: number }> {
  const regions: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const element of elements) {
    const previous = previousElements.get(element.id);

    // Element is new or changed
    if (!previous || previous.version !== element.version) {
      // Include element bounds plus some padding for stroke
      const padding = (element.strokeWidth ?? 1) / 2 + 5;
      regions.push({
        x: element.x - padding,
        y: element.y - padding,
        width: element.width + padding * 2,
        height: element.height + padding * 2,
      });
    }
  }

  return regions;
}

/**
 * Reconciliation Manager class for more complex scenarios
 */
export class ReconciliationManager {
  private localVersion: Map<string, number> = new Map();
  private pendingUpdates: DriplElement[] = [];

  /**
   * Process incoming elements and return reconciled list
   */
  process(
    localElements: DriplElement[],
    incomingElements: DriplElement[],
  ): DriplElement[] {
    const result = reconcileElements(localElements, incomingElements);
    
    // Update local version tracking
    result.accepted.forEach((el) => {
      this.localVersion.set(el.id, el.version ?? 0);
    });

    if (result.accepted.length > 0) {
      // Merge accepted elements with local
      const localMap = new Map(localElements.map((el) => [el.id, el]));
      
      // Apply accepted updates
      result.accepted.forEach((el) => {
        localMap.set(el.id, el);
      });

      return Array.from(localMap.values());
    }

    return localElements;
  }

  /**
   * Get local version for an element
   */
  getLocalVersion(elementId: string): number {
    return this.localVersion.get(elementId) ?? 0;
  }

  /**
   * Check if update should be accepted
   */
  shouldAccept(elementId: string, incomingVersion: number): boolean {
    const localVersion = this.getLocalVersion(elementId);
    return shouldAcceptUpdate(localVersion, incomingVersion);
  }
}

export default ReconciliationManager;
