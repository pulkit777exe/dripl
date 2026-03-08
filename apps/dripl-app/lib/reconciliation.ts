import type { DriplElement } from "@dripl/common";
import type { AppState } from "@/types/canvas";
import { normalizeElement } from "@/utils/canvasUtils";

export interface ReconciliationResult {
  accepted: DriplElement[];
  rejected: DriplElement[];
  needsRender: boolean;
}

export interface ReconcileOptions {
  /**
   * ID of the element currently being actively edited locally (e.g. being
   * dragged, resized, or rotated). Any remote update for this ID is
   * unconditionally rejected — the local edit always wins.
   */
  editingElementId?: string | null;

  /**
   * ID of the draft element currently being drawn. Remote messages must never
   * overwrite the draft; it is not yet in the committed elements[] array so
   * this acts as a safety guard in case the IDs somehow collide (shouldn't
   * happen with uuid-v4, but we protect it anyway).
   */
  draftElementId?: string | null;
}

// ---------------------------------------------------------------------------
// Core per-element decision
// ---------------------------------------------------------------------------

/**
 * Decides whether to discard an incoming remote element.
 *
 * Resolution rules (applied in priority order):
 *
 * 1. **Active edit lock** – If the element is being interactively edited
 *    locally (`editingElementId`), *always* reject the remote version.
 *    The user's in-flight gesture owns that element until pointer-up.
 *
 * 2. **Draft protection** – If the incoming ID matches `draftElementId`,
 *    reject unconditionally (the draft is not committed yet).
 *
 * 3. **Higher version wins** – If local version > remote version, discard
 *    remote. The higher version represents more recent mutations.
 *
 * 4. **Tie-break on equal versions** – When versions are equal,
 *    *lower* versionNonce wins. This is deterministic across all peers
 *    (every client running the same comparison will reach the same outcome).
 *
 * 5. **No local copy** – Always accept (new element from remote).
 */
const getDiscardReason = (
  local: DriplElement | undefined,
  remote: DriplElement,
  options: ReconcileOptions = {},
): string => {
  const { editingElementId, draftElementId } = options;

  if (editingElementId && remote.id === editingElementId) {
    return 'active_edit_lock';
  }

  if (draftElementId && remote.id === draftElementId) {
    return 'draft_protection';
  }

  if (local) {
    const localV = local.version ?? 0;
    const remoteV = remote.version ?? 0;

    if (localV > remoteV) {
      return 'higher_version';
    }

    if (localV === remoteV) {
      const localN = local.versionNonce ?? 0;
      const remoteN = remote.versionNonce ?? 0;
      if (localN <= remoteN) {
        return 'lower_nonce';
      }
    }
  }

  return 'accept';
};

export const shouldDiscardRemoteElement = (
  local: DriplElement | undefined,
  remote: DriplElement,
  options: ReconcileOptions = {},
): boolean => {
  const discard = getDiscardReason(local, remote, options) !== 'accept';
  
  console.log('[RECONCILE] shouldDiscardRemoteElement', {
    id: remote.id,
    localVersion: local?.version,
    remoteVersion: remote.version,
    localNonce: local?.versionNonce,
    remoteNonce: remote.versionNonce,
    discard,
    reason: getDiscardReason(local, remote, options)
  });

  return discard;
};

// ---------------------------------------------------------------------------
// Main reconcile function
// ---------------------------------------------------------------------------

/**
 * Reconciles an array of incoming remote elements against the current local
 * snapshot.
 *
 * - Elements with no local counterpart are always accepted (new additions).
 * - Existing elements follow the conflict resolution rules in
 *   `shouldDiscardRemoteElement`.
 * - `draftElement` is never touched regardless of what the remote sends.
 */
export function reconcileElements(
  localElements: DriplElement[],
  incomingElements: DriplElement[],
  /** @deprecated Pass options instead — kept for backwards compat */
  localAppState: AppState | ReconcileOptions = {} as AppState,
  options: ReconcileOptions = {},
): ReconciliationResult {
  // Support the old (localAppState, no extra options) and new
  // (localAppState + options) call signatures seamlessly.
  const resolvedOptions: ReconcileOptions =
    "editingElementId" in localAppState || "draftElementId" in localAppState
      ? (localAppState as ReconcileOptions)
      : options;

  const localMap = new Map<string, DriplElement>();
  localElements.forEach((el) => localMap.set(el.id, el));

  const accepted: DriplElement[] = [];
  const rejected: DriplElement[] = [];
  let needsRender = false;

  for (const incoming of incomingElements) {
    // Normalize incoming element before processing
    const normalizedIncoming = normalizeElement(incoming);
    const local = localMap.get(normalizedIncoming.id);

    const discard = shouldDiscardRemoteElement(
      local,
      normalizedIncoming,
      resolvedOptions,
    );

    if (discard) {
      rejected.push(normalizedIncoming);
    } else {
      accepted.push(normalizedIncoming);
      // Only mark as needsRender if element is new or different
      if (!local || JSON.stringify(local) !== JSON.stringify(normalizedIncoming)) {
        needsRender = true;
      }
    }
  }

  console.log('[RECONCILE] reconcileElements', {
    localCount: localElements.length,
    incomingCount: incomingElements.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    needsRender: needsRender
  });

  return { accepted, rejected, needsRender };
}

export function shouldAcceptUpdate(
  localVersion: number,
  incomingVersion: number,
  localVersionNonce: number,
  incomingVersionNonce: number,
): boolean {
  if (incomingVersion > localVersion) return true;
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
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
    updated: Date.now(),
  };
}

export function mergeElement(
  local: DriplElement,
  incoming: DriplElement,
): DriplElement {
  const localVersion = local.version ?? 0;
  const incomingVersion = incoming.version ?? 0;

  if (incomingVersion > localVersion) {
    return {
      ...incoming,
      version: incomingVersion,
      updated: Date.now(),
    };
  }

  if (incomingVersion === localVersion) {
    const localNonce = local.versionNonce ?? 0;
    const incomingNonce = incoming.versionNonce ?? 0;
    
    if (incomingNonce < localNonce) {
      return {
        ...incoming,
        version: incomingVersion,
        updated: Date.now(),
      };
    }
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

// ---------------------------------------------------------------------------
// ReconciliationManager
// ---------------------------------------------------------------------------

export class ReconciliationManager {
  private localVersion: Map<string, number> = new Map();
  private localVersionNonce: Map<string, number> = new Map();

  process(
    localElements: DriplElement[],
    incomingElements: DriplElement[],
    options: ReconcileOptions = {},
  ): DriplElement[] {
    const result = reconcileElements(localElements, incomingElements, options);

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
