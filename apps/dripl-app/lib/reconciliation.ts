import type { DriplElement } from "@dripl/common";
import type { AppState } from "@/types/canvas";

export interface ReconciliationResult {
  accepted: DriplElement[];
  rejected: DriplElement[];
  needsRender: boolean;
}

export const shouldDiscardRemoteElement = (
  localAppState: AppState,
  local: DriplElement | undefined,
  remote: DriplElement,
): boolean => {
  if (
    local &&
    ((local.version ?? 0) > (remote.version ?? 0) ||
      ((local.version ?? 0) === (remote.version ?? 0) &&
        (local.versionNonce ?? 0) <= (remote.versionNonce ?? 0)))
  ) {
    return true;
  }
  return false;
};

export function reconcileElements(
  localElements: DriplElement[],
  incomingElements: DriplElement[],
  localAppState: AppState = {} as AppState,
): ReconciliationResult {
  const localMap = new Map<string, DriplElement>();

  localElements.forEach((el) => {
    localMap.set(el.id, el);
  });

  const accepted: DriplElement[] = [];
  const rejected: DriplElement[] = [];
  let needsRender = false;

  for (const incoming of incomingElements) {
    const local = localMap.get(incoming.id);

    if (!local) {
      accepted.push(incoming);
      needsRender = true;
      continue;
    }

    const discardRemoteElement = shouldDiscardRemoteElement(
      localAppState,
      local,
      incoming,
    );

    if (discardRemoteElement) {
      rejected.push(incoming);
    } else {
      accepted.push(incoming);
      needsRender = true;
    }
  }

  return { accepted, rejected, needsRender };
}

export function shouldAcceptUpdate(
  localVersion: number,
  incomingVersion: number,
  localVersionNonce: number,
  incomingVersionNonce: number,
): boolean {
  if (incomingVersion > localVersion) {
    return true;
  }
  if (
    incomingVersion === localVersion &&
    incomingVersionNonce < localVersionNonce
  ) {
    return true;
  }
  return false;
}

export function getNextVersion(currentVersion: number | undefined): number {
  return (currentVersion ?? 0) + 1;
}

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

export function calculateDirtyRegions(
  elements: DriplElement[],
  previousElements: Map<string, DriplElement>,
): Array<{ x: number; y: number; width: number; height: number }> {
  const regions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];

  for (const element of elements) {
    const previous = previousElements.get(element.id);

    if (!previous || previous.version !== element.version) {
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

export class ReconciliationManager {
  private localVersion: Map<string, number> = new Map();
  private localVersionNonce: Map<string, number> = new Map();
  private pendingUpdates: DriplElement[] = [];

  process(
    localElements: DriplElement[],
    incomingElements: DriplElement[],
  ): DriplElement[] {
    const result = reconcileElements(localElements, incomingElements);

    result.accepted.forEach((el) => {
      this.localVersion.set(el.id, el.version ?? 0);
      this.localVersionNonce.set(el.id, el.versionNonce ?? 0);
    });

    if (result.accepted.length > 0) {
      const localMap = new Map(localElements.map((el) => [el.id, el]));

      result.accepted.forEach((el) => {
        localMap.set(el.id, el);
      });

      return Array.from(localMap.values());
    }

    return localElements;
  }

  getLocalVersion(elementId: string): number {
    return this.localVersion.get(elementId) ?? 0;
  }

  getLocalVersionNonce(elementId: string): number {
    return this.localVersionNonce.get(elementId) ?? 0;
  }

  shouldAccept(
    elementId: string,
    incomingVersion: number,
    incomingVersionNonce: number = 0,
  ): boolean {
    const localVersion = this.getLocalVersion(elementId);
    const localVersionNonce = this.getLocalVersionNonce(elementId);
    return shouldAcceptUpdate(
      localVersion,
      incomingVersion,
      localVersionNonce,
      incomingVersionNonce,
    );
  }
}

export default ReconciliationManager;
