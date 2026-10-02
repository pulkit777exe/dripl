import type { DriplElement } from './types/element';

export type VersionedElement = Pick<DriplElement, 'version' | 'versionNonce'>;

/**
 * CONVERGENCE: WHAT IS PROVEN, AND THE ONE WAY IT DOES NOT HOLD.
 *
 * Everything in the product's merge path reduces to the two comparators below.
 * `compareElementFreshness` is a *strict total order* on the key
 * `(version ?? 0, -(versionNonce ?? 0))` — antisymmetric, irreflexive and
 * transitive, so no cycle exists and "which of these two elements is newer" has
 * one answer in every process. That much is established, not assumed;
 * `src/__tests__/reconciliation.properties.test.ts` proves each of the three
 * properties over generated inputs.
 *
 * A total order on the *key* is not the same as convergence, because the key is
 * not injective over payloads. `shouldAcceptElement` admits an element only when
 * it is *strictly* fresher than what is stored, so two distinct payloads that
 * share a freshness key both "lose" to each other and the first one delivered
 * wins. The merge is therefore a function of the update *set* if and only if no
 * element id has two distinct payloads tied at its maximal key. Pinned as a
 * characterisation, with the two-update minimal repro, in that test file.
 *
 * The precondition lives with the producers, not here: `versionNonce` is minted
 * with `Math.floor(Math.random() * 2**31)` in `mutateElement` and
 * `apps/dripl-app`, and with a deterministic `0` by the `.dripl` import path,
 * so key collisions are rare rather than impossible and nothing enforces their
 * absence. Closing it means either a uniqueness guarantee at every mint site or
 * a content-derived tie-break, which needs the whole element rather than the
 * two ordering fields this module is given.
 *
 * What is NOT claimed, and cannot be fixed here: concurrent edits to the same
 * element discard one of the two edits (convergence is not preservation), and
 * reconciliation is per element id with no transaction across related elements,
 * so a bound-text edit can leave a label attached to a shape whose text has
 * moved on. Both are properties of last-writer-wins over JSON deltas; making
 * them disappear means a CRDT, which is a rewrite rather than a patch.
 */

/**
 * Fractional-index comparator, single owner. The app's display order
 * (`sortElementsByZIndex`) and the server's persisted order
 * (`elementsToArray`) were two hand-written copies of this `''`-last logic;
 * a change to one silently reordered rooms on reload. `undefined` and `''`
 * sort before any key so unindexed elements stay at the back.
 *
 * Note the `''` sentinel makes this a total order but NOT the lexicographic
 * one: `''` is pinned below every real key, so `"zz"` precedes `""` here even
 * though the string compare says otherwise. It is still transitive, because
 * the empty key is a bottom element — nothing beats it and every real key
 * does — which is the property z-order actually needs.
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
  // Equal versions resolve in favor of the lower versionNonce. The tie-break
  // must stay deterministic: every replica has to reach the same answer. It is
  // deterministic per *pair*, which is weaker than it looks — two payloads
  // under one key are a tie with no winner, see the note above.
  return (existing.versionNonce ?? 0) - (incoming.versionNonce ?? 0);
}

/**
 * Decide whether an incoming element may replace the local copy. Legacy
 * elements without version metadata remain interoperable; versioned clients
 * use a strict version-then-nonce comparison.
 *
 * The `bothLegacy` escape is last-writer-wins rather than first-writer-wins, so
 * it is order-dependent where the versioned path rejects the tie. That is
 * deliberate and it is NOT a fixable convergence hole: replacing it with a
 * plain tie rejection would make the legacy path first-writer-wins, which is
 * equally order-dependent, while breaking the one case legacy interop exists to
 * serve — a client that edits an element it created without ever bumping
 * `version`. Leave it. The neighbouring asymmetry is intentional too: `{version:
 * 0}` and `{}` describe the same key and are treated as a tie, while two
 * metadata-free payloads are treated as an overwrite.
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
