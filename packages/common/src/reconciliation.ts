import type { DriplElement } from './types/element';

export type VersionedElement = Pick<DriplElement, 'version' | 'versionNonce'>;

/**
 * Fractional-index comparator, single owner. The app's display order
 * (`sortElementsByZIndex`) and the server's persisted order
 * (`elementsToArray`) were two hand-written copies of this `''`-last logic;
 * a change to one silently reordered rooms on reload. `undefined` and `''`
 * sort before any key so unindexed elements stay at the back.
 */
export function compareFractionalIndex(a?: string, b?: string): number {
  const ai = a ?? '';
  const bi = b ?? '';
  if (ai === bi) return 0;
  if (ai === '') return -1;
  if (bi === '') return 1;
  return ai < bi ? -1 : 1;
}

/** Compare the deterministic per-element ordering metadata used by the editor. */
export function compareElementFreshness(
  incoming: VersionedElement,
  existing: VersionedElement
): number {
  const incomingVersion = incoming.version ?? 0;
  const existingVersion = existing.version ?? 0;
  if (incomingVersion !== existingVersion) return incomingVersion - existingVersion;
  // Excalidraw v0.18.1 resolves equal versions in favor of the lower
  // versionNonce. Keep the same deterministic tie-break in the live JSON path.
  return (existing.versionNonce ?? 0) - (incoming.versionNonce ?? 0);
}

/**
 * Decide whether an incoming element may replace the local copy. Legacy
 * elements without version metadata remain interoperable; versioned clients
 * use a strict version-then-nonce comparison.
 */
export function shouldAcceptElement(
  incoming: VersionedElement,
  existing: VersionedElement | undefined
): boolean {
  if (!existing) return true;
  const bothLegacy =
    incoming.version === undefined &&
    incoming.versionNonce === undefined &&
    existing.version === undefined &&
    existing.versionNonce === undefined;
  return bothLegacy || compareElementFreshness(incoming, existing) > 0;
}
