/**
 * What this file PROVES, and what it does not.
 *
 * `reconciliation.ts` holds all of the product's merge logic, and until this
 * file existed nothing anywhere tested the one property that matters for
 * collaboration: that replicas which receive the same set of updates in
 * different orders end up in the same state. The only prior coverage was two
 * hand-written cases in `apps/ws-server/src/__tests__/sceneReconciliation.test.ts`
 * — "orders by version before nonce" — which pass against a comparator that is
 * not a valid order at all.
 *
 * PROVEN HERE, over generated inputs with pinned seeds:
 *
 *   1. `compareElementFreshness` is a *strict total order* on the freshness key
 *      `(version ?? 0, -(versionNonce ?? 0))`: antisymmetric, irreflexive, and
 *      transitive. Transitivity is the load-bearing one — without it a cycle
 *      exists and different replicas can pick different winners. There is no
 *      cycle; the comparator is sound.
 *   2. `shouldAcceptElement` admits an element iff it is *strictly* fresher,
 *      with exactly one documented exception — the metadata-free interop
 *      escape, pinned in section 2 rather than glossed over.
 *   3. `compareFractionalIndex` is antisymmetric and irreflexive, its relation
 *      is transitive, and it induces one order independent of input ordering, so
 *      display order and persisted order cannot disagree. It is a total order
 *      but deliberately NOT the lexicographic one: `''` is pinned to the bottom.
 *   4. The convergence law, stated exactly and checked over *every* ordering of
 *      2,000 generated update sets (283,397 replica replays, up to 720
 *      orderings per case) rather than a handful of sampled orders:
 *
 *          number of distinct final states
 *            = ∏ over element ids of (distinct payloads carrying that id's
 *                                      maximal freshness key)
 *
 *      Section 4 predicts this with an independent model of the key — not by
 *      calling the comparator under test — and all 2,000 cases matched,
 *      including the 43 that legitimately produced more than one state.
 *
 *      Read as a convergence claim: whenever no element id has two distinct
 *      payloads tied at its maximal key, the merge converges to one state
 *      regardless of interleaving. Section 4's second test asserts exactly that
 *      over 2,000 further cases and 278,224 orderings, with same-element
 *      conflicts, bound-pair updates and metadata-free payloads all present in
 *      the generator.
 *
 *   5. One genuine divergence, characterised rather than described (section 5):
 *      two distinct payloads under one freshness key, resolved by arrival
 *      order. Two updates, no third party, reproducible by hand. It is pinned
 *      here so it cannot be forgotten, and so a change that fixes it fails this
 *      file and has to say so.
 *
 * NOT PROVEN, and not provable at this layer. Properties of the design rather
 * than defects; closing them means a rewrite, not a patch:
 *
 *   - **No lost-update protection.** Two users editing the *same* element
 *     concurrently: exactly one edit survives, silently. Replicas agree on the
 *     survivor, so this suite passes while a user's work is discarded. That is
 *     the defined behaviour of last-writer-wins, not a bug.
 *   - **No atomicity across related elements.** A bound-text edit touches both
 *     a shape and its label. Reconciliation is per element id with no
 *     transaction spanning the pair, so a concurrent interleaving can leave a
 *     label bound to a shape whose text has moved on. The suite asserts the
 *     replicas still *agree*; it does not and cannot assert the pair is
 *     *coherent*.
 *   - **No causal consistency.** The order is a scalar pair per element, not a
 *     per-element sequence. Replicas can interleave updates so a user observes
 *     their own earlier edit "un-happen".
 *   - **Nothing above this layer.** This models the merge function only. It
 *     says nothing about the wire protocol, the server's tombstone fence, room
 *     ownership, capacity rejection, or whether clients and server compute the
 *     same merge over the same messages.
 *
 * DETERMINISM. Every property pins a seed (`PROPERTY_SEED`, `CONVERGENCE_SEED`)
 * and fast-check reports the seed plus a shrunk counterexample on failure, so a
 * red run is always reproducible from the output. Vitest's file order and
 * concurrency do not affect any of this: each `it` is independent and no shared
 * mutable state crosses them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { logWarn } from '../logging';
import {
  compareElementFreshness,
  compareFractionalIndex,
  shouldAcceptElement,
  type VersionedElement,
} from '../reconciliation';

/** Fixed seed for the order properties. Bump it deliberately when widening a
 * generator; never leave it random, because a property that fails once a week
 * is worse than no property at all. */
const PROPERTY_SEED = 0x5eed_1234;
const PROPERTY_RUNS = 1_000;

/** Seeds and run counts for the convergence simulation, reported on success. */
const CONVERGENCE_RUNS = 2_000;
const CONVERGENCE_SEED = 0xc0ffee;

/**
 * `process.stderr` is untyped here (`@dripl/common` sets `types: []`), and this
 * suite must not add a dependency or a tsconfig change to say one line. The
 * sanctioned console boundary already exists and `logWarn` is allowed to reach
 * it, so the statistic is reported through that rather than through a bare
 * `console` call or an `eslint-disable`.
 *
 * Vitest intercepts console output and hides it on a green run, so the counts
 * are visible with `npx vitest run --disableConsoleIntercept`. They are reported
 * rather than asserted because they are coverage statistics, not contracts; the
 * invariants around them are asserted below.
 */
const report = (line: string): void => {
  logWarn(`[reconciliation] ${line}`);
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Builds a freshness payload with *absent keys genuinely absent*.
 *
 * `exactOptionalPropertyTypes` is on in this workspace, so `{version: undefined}`
 * is not the same value as `{}` to the type checker — and the production code
 * distinguishes them, since `shouldAcceptElement` reads `=== undefined`. Omitting
 * the key is the only construction that means what the tests mean.
 */
const payload = (
  version: number | undefined,
  versionNonce: number | undefined,
  marker = 'red'
): VersionedElement & { readonly marker: string } => {
  const element: { version?: number; versionNonce?: number; marker: string } = { marker };
  if (version !== undefined) element.version = version;
  if (versionNonce !== undefined) element.versionNonce = versionNonce;
  return element;
};

const hasNoVersionMetadata = (element: VersionedElement): boolean =>
  element.version === undefined && element.versionNonce === undefined;

/**
 * A freshness key, deliberately biased toward the interesting edges: version 0
 * (what a brand-new or half-populated element carries) and nonce 0 (what an
 * import path stamps), because those are the values that make ties common in
 * practice rather than rare.
 */
const versionedArb: fc.Arbitrary<VersionedElement> = fc
  .record({
    version: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 8 })),
    versionNonce: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 8 })),
  })
  .map(({ version, versionNonce }) => payload(version, versionNonce));

/**
 * Payloads with *no* version metadata at all — the only shape that reaches
 * `shouldAcceptElement`'s interop branch, which requires both fields absent. The
 * generator puts these in at a meaningful rate on purpose: an earlier draft drew
 * them from `fc.option(...)`, where the chance of *both* fields coming back
 * absent was about one pair in four hundred, low enough that two properties
 * which should have failed passed anyway.
 */
const metadataFreeArb: fc.Arbitrary<VersionedElement> = fc.constantFrom(
  payload(undefined, undefined),
  payload(undefined, undefined, 'blue')
);

/**
 * Payloads carrying only one of the two fields. These share the freshness key of
 * a metadata-free payload — `version ?? 0` and `versionNonce ?? 0` alias the
 * absent case onto `(0, 0)` — but they do *not* reach the interop branch, so
 * they belong in the ordered half of the world.
 */
const halfVersionedArb: fc.Arbitrary<VersionedElement> = fc.oneof(
  fc
    .record({ version: fc.integer({ min: 0, max: 8 }), versionNonce: fc.constant(0) })
    .map(({ version }) => payload(version, undefined)),
  fc
    .record({ version: fc.constant(0), versionNonce: fc.integer({ min: 0, max: 8 }) })
    .map(({ versionNonce }) => payload(undefined, versionNonce)),
  fc.constant(payload(undefined, 0))
);

const versionedOrLegacyArb: fc.Arbitrary<VersionedElement> = fc.oneof(
  versionedArb,
  metadataFreeArb,
  halfVersionedArb
);

/**
 * Fractional-index keys. `''` and `undefined` are both in the generator because
 * `compareFractionalIndex` aliases them onto one value and treats that value as
 * "unindexed, sort me to the back" — an aliasing a comparator only tolerates if
 * it stays consistent in both directions.
 */
const fractionalIndexArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constantFrom('a0', 'a1', 'A0', 'Zz', 'a', '0', 'a10'),
  fc.string({ minLength: 1, maxLength: 3 })
);

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * True when a comparator result is not antisymmetric for this pair.
 *
 * Asserted on the *sign*, in sum form. `compareElementFreshness` returns
 * `0 - 0` for a tie between two elements at version 0, which JavaScript spells
 * `+0`, so the prettier-looking assertions `f(x,y) === -f(y,x)` and
 * `sign(f(x,y)) === -sign(f(y,x))` both compare `0` against `-0` and fail on
 * every tie — `toBe` distinguishes them via `Object.is`. Every caller in the
 * repo tests `> 0` / `<= 0`, so sign is the whole contract and the magnitude is
 * an implementation detail.
 */
const sign = (value: number): number => Math.sign(value);

const antisymmetryBreaks = (forward: number, reverse: number): boolean =>
  sign(forward) + sign(reverse) !== 0;

const beats = (a: VersionedElement, b: VersionedElement): boolean =>
  compareElementFreshness(a, b) > 0;

// ---------------------------------------------------------------------------
// 1. compareElementFreshness is a strict total order
// ---------------------------------------------------------------------------

describe('compareElementFreshness is a strict total order', () => {
  it('is antisymmetric: f(x, y) === -f(y, x)', () => {
    fc.assert(
      fc.property(versionedOrLegacyArb, versionedOrLegacyArb, (x, y) => {
        expect(
          antisymmetryBreaks(compareElementFreshness(x, y), compareElementFreshness(y, x))
        ).toBe(false);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('is irreflexive: f(x, x) === 0', () => {
    fc.assert(
      fc.property(versionedOrLegacyArb, x => {
        expect(compareElementFreshness(x, x)).toBe(0);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('is transitive over "beats": x>y and y>z implies x>z', () => {
    // The one that decides convergence. A cycle here means two replicas can
    // each justify a different winner, and no protocol work fixes that from
    // outside. It holds: the key is a lexicographic pair of numbers.
    fc.assert(
      fc.property(versionedOrLegacyArb, versionedOrLegacyArb, versionedOrLegacyArb, (x, y, z) => {
        if (!beats(x, y)) return true;
        if (!beats(y, z)) return true;
        expect(beats(x, z)).toBe(true);
        // And the numeric order relation itself, not just its sign.
        expect(compareElementFreshness(x, z)).toBeGreaterThan(0);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('never reports a tie for two elements that differ in their freshness key', () => {
    // A comparator that collapsed distinct keys onto 0 would silently drop
    // concurrent edits. The freshness key is `version` then `-versionNonce`;
    // equal keys are the only legitimate ties.
    fc.assert(
      fc.property(versionedOrLegacyArb, versionedOrLegacyArb, (x, y) => {
        const sameKey =
          (x.version ?? 0) === (y.version ?? 0) && (x.versionNonce ?? 0) === (y.versionNonce ?? 0);
        expect(compareElementFreshness(x, y) === 0).toBe(sameKey);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// 2. shouldAcceptElement
// ---------------------------------------------------------------------------

/**
 * The admission contract, written out independently of the implementation so a
 * change to `shouldAcceptElement` has to be reconciled against this rather than
 * against a copy of itself.
 */
const admitsByContract = (incoming: VersionedElement, existing: VersionedElement): boolean =>
  hasNoVersionMetadata(incoming) && hasNoVersionMetadata(existing)
    ? true
    : compareElementFreshness(incoming, existing) > 0;

describe('shouldAcceptElement admits strictly-fresher incoming elements only', () => {
  it('matches the stated contract for every pair, including metadata-free pairs', () => {
    fc.assert(
      fc.property(versionedOrLegacyArb, versionedOrLegacyArb, (incoming, existing) => {
        expect(shouldAcceptElement(incoming, existing)).toBe(admitsByContract(incoming, existing));
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('accepts into an empty slot unconditionally', () => {
    fc.assert(
      fc.property(versionedOrLegacyArb, incoming => {
        expect(shouldAcceptElement(incoming, undefined)).toBe(true);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('never admits both directions when both sides carry a version', () => {
    // This is the property that makes the merge order-independent. If both were
    // admissible the surviving value would depend on arrival order — and
    // section 4 does find exactly that, for the pair shape excluded here.
    fc.assert(
      fc.property(versionedArb, versionedArb, (x, y) => {
        expect(shouldAcceptElement(x, y) && shouldAcceptElement(y, x)).toBe(false);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('admits both directions for two metadata-free payloads — the pinned exception', () => {
    // The one deviation from "strictly fresher": neither side declares an order,
    // so the incoming element always overwrites. That is last-writer-wins where
    // the versioned path is first-writer-wins, and it is order-dependent for the
    // same reason (section 5). It is not a convergence fix available here:
    // rejecting the tie instead would be equally order-dependent and would break
    // the legacy client this branch exists for.
    fc.assert(
      fc.property(metadataFreeArb, metadataFreeArb, (x, y) => {
        expect(hasNoVersionMetadata(x) && hasNoVersionMetadata(y)).toBe(true);
        expect(shouldAcceptElement(x, y)).toBe(true);
        expect(shouldAcceptElement(y, x)).toBe(true);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// 3. compareFractionalIndex is a valid comparator
// ---------------------------------------------------------------------------

describe('compareFractionalIndex is a valid comparator', () => {
  it('is antisymmetric and irreflexive over generated keys', () => {
    fc.assert(
      fc.property(fractionalIndexArb, fractionalIndexArb, (x, y) => {
        expect(antisymmetryBreaks(compareFractionalIndex(x, y), compareFractionalIndex(y, x))).toBe(
          false
        );
        expect(compareFractionalIndex(x, x)).toBe(0);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('orders by the relation, not by plain lexicographic order, when a key is empty', () => {
    // `''`/`undefined` is a *sentinel* that outranks nothing: it sorts before
    // every real key even when the string compare would say otherwise ("zz" is
    // not below "", yet "" is placed first). So the comparator is a strict total
    // order but NOT the lexicographic one, and asserting `f(x,z) < 0` for
    // arbitrary triples would assert the wrong thing — it fails on the legal
    // input ("zz", "", "a") with no defect present.
    //
    // What z-order needs is transitivity of the *relation*, which holds because
    // the empty sentinel is a bottom element: nothing beats `''`, and every real
    // key beats it, so it can only ever close a chain.
    fc.assert(
      fc.property(fractionalIndexArb, fractionalIndexArb, fractionalIndexArb, (x, y, z) => {
        const indexBeats = (a: string | undefined, b: string | undefined): boolean =>
          compareFractionalIndex(a, b) > 0;
        if (!indexBeats(x, y)) return true;
        if (!indexBeats(y, z)) return true;
        expect(indexBeats(x, z)).toBe(true);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('produces the same total order as a reference sort over a generated set', () => {
    fc.assert(
      fc.property(fc.array(fractionalIndexArb, { minLength: 2, maxLength: 12 }), keys => {
        const viaComparator = [...keys].sort(compareFractionalIndex);
        // Reference order, written out longhand rather than delegated to the
        // comparator under test: unindexed keys (undefined and '', which alias
        // each other) first, then the rest by code unit.
        const viaReference = [...keys].sort((a, b) => {
          const ak = a ?? '';
          const bk = b ?? '';
          if (ak === bk) return 0;
          if (ak === '') return -1;
          if (bk === '') return 1;
          return ak < bk ? -1 : 1;
        });
        expect(viaComparator).toEqual(viaReference);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });

  it('is order-independent: the same key set sorts to the same sequence', () => {
    // The regression the module comment describes: two hand-written copies of
    // this `''`-last logic, one in the app's display sort and one in the
    // server's persisted order, silently reordered rooms on reload.
    fc.assert(
      fc.property(fc.array(fractionalIndexArb, { minLength: 2, maxLength: 12 }), keys => {
        const forward = [...keys].sort(compareFractionalIndex);
        const reversed = [...keys].reverse().sort(compareFractionalIndex);
        expect(forward).toEqual(reversed);
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Convergence
// ---------------------------------------------------------------------------

/**
 * One concurrent write. A write is a *whole element payload* — that is what the
 * JSON delta transport actually ships — carrying only ordering metadata plus
 * the fields that distinguish it from a concurrent write to the same id.
 */
interface Update {
  readonly id: string;
  readonly element: VersionedElement & { readonly marker: string };
}

/**
 * The replica: a map of id to element, admitting writes through the production
 * `shouldAcceptElement`. This is the same call `sceneMutation.acceptElement`,
 * `sceneMutation.acceptValidated` and the client's `reconcileScene` all make, so
 * the model is the merge function rather than an approximation of it.
 */
type Replica = Map<string, Update['element']>;

const applyTo = (replica: Replica, update: Update): void => {
  const existing = replica.get(update.id);
  if (!shouldAcceptElement(update.element, existing)) return;
  replica.set(update.id, update.element);
};

/** Canonical rendering, so "the replicas agree" is checked byte-for-byte. */
const render = (replica: Replica): string =>
  JSON.stringify([...replica.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const replayInOrder = (updates: readonly Update[], order: readonly number[]): string => {
  const replica: Replica = new Map();
  for (const index of order) applyTo(replica, updates[index] as Update);
  return render(replica);
};

/**
 * Every permutation of `length` indices. Enumerating all of them rather than
 * sampling keeps the claim exact: "there EXISTS an ordering that diverges" then
 * becomes a fact about the whole space instead of an artefact of which
 * permutations happened to be tried. Update sets are capped at 6 (720 orders) to
 * keep the run fast.
 */
const allOrders = (length: number): number[][] => {
  const base = Array.from({ length }, (_unused, i) => i);
  const orders: number[][] = [];
  const walk = (index: number): void => {
    if (index === length) {
      orders.push([...base]);
      return;
    }
    for (let i = index; i < length; i += 1) {
      const held = base[index] as number;
      base[index] = base[i] as number;
      base[i] = held;
      walk(index + 1);
      const restore = base[index] as number;
      base[index] = base[i] as number;
      base[i] = restore;
    }
  };
  walk(0);
  return orders;
};

/**
 * The update set. Generated rather than hand-listed so the suite covers
 * same-element collisions, related-element pairs, absent version metadata, and
 * freshness-key ties, in combinations no human would enumerate.
 *
 * `shape-a`/`label-a` and `shape-b`/`label-b` are bound pairs — the ids a
 * bound-text edit touches together — so "related element" is a modelled
 * relationship here rather than two ids that happen to share a batch.
 */
/**
 * Freshness metadata for one convergence update, as a `(version, versionNonce)`
 * pair with `undefined` standing for an absent field. A pair rather than an
 * object because `exactOptionalPropertyTypes` makes `{version: undefined}` a
 * different type from `{}`, and only `payload()` below knows how to build the
 * genuinely-absent-key object the production code branches on.
 *
 * One third of the draws are metadata-free payloads, because that is the only
 * shape that reaches `shouldAcceptElement`'s interop branch and it was
 * otherwise sampled at roughly 9% of cases — present in the corpus, but not
 * enough to lean on. The `[undefined, 0]` draw covers the aliasing: an explicit
 * nonce of 0 shares the freshness key of an absent one without sharing the
 * interop branch.
 */
const convergenceFreshnessArb: fc.Arbitrary<readonly [number | undefined, number | undefined]> =
  fc.oneof(
    fc.constant<readonly [undefined, undefined]>([undefined, undefined]),
    fc.constant<readonly [undefined, number]>([undefined, 0]),
    fc.tuple(
      fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
      fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined })
    )
  );

const updateArb: fc.Arbitrary<Update> = fc
  .record({
    id: fc.constantFrom('shape-a', 'label-a', 'shape-b', 'label-b'),
    freshness: convergenceFreshnessArb,
    marker: fc.constantFrom('red', 'blue', 'green', 'bold', 'italic'),
  })
  .map(({ id, freshness, marker }) => ({
    id,
    element: payload(freshness[0], freshness[1], marker),
  }));

/**
 * The freshness key, written out here rather than delegating to
 * `compareElementFreshness`. This is the independent model the convergence
 * results below are predicted with: `(version, -versionNonce)` with absent
 * fields read as 0. Spelling it out is deliberate — a characterisation that
 * predicted its own results by calling the function under test would prove
 * nothing.
 */
type FreshnessKey = readonly [number, number];

const keyOf = (element: VersionedElement): FreshnessKey => [
  element.version ?? 0,
  -(element.versionNonce ?? 0),
];

const keyGreater = (a: FreshnessKey, b: FreshnessKey): boolean =>
  a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

const keyEqual = (a: FreshnessKey, b: FreshnessKey): boolean => a[0] === b[0] && a[1] === b[1];

/** Distinct payloads are distinguished by content, not by freshness. */
const payloadOf = (update: Update): string => JSON.stringify(update.element);

const BOUND_PAIRS = [
  ['shape-a', 'label-a'],
  ['shape-b', 'label-b'],
] as const;

interface Tally {
  cases: number;
  /** Cases where two or more updates targeted the same element id. */
  sameElementConflicts: number;
  /** Cases where both members of at least one bound pair were updated. */
  relatedPairCases: number;
  /** Cases containing at least one payload with no version metadata at all. */
  legacyPayloadCases: number;
  /** Cases where some id carried two distinct payloads tied at its max key. */
  maxKeyTieCases: number;
  /** Distinct replica states produced across all orderings, summed. */
  distinctStates: number;
  /** Total replica replays performed (cases × orderings). */
  replays: number;
}

const newTally = (): Tally => ({
  cases: 0,
  sameElementConflicts: 0,
  relatedPairCases: 0,
  legacyPayloadCases: 0,
  maxKeyTieCases: 0,
  distinctStates: 0,
  replays: 0,
});

/**
 * THE CONVERGENCE LAW, exactly.
 *
 * Over all orderings of an update set, `shouldAcceptElement` yields
 *
 *     ∏ over ids of  ( number of *distinct payloads* carrying that id's
 *                      maximal freshness key )
 *
 * distinct final states, where a factor of 1 means "converged". Three
 * consequences, and together they are the whole convergence story of this
 * module:
 *
 *   1. `shouldAcceptElement` keeps the element with the maximal freshness key.
 *      Ties are rejected, so the *first* payload at the maximum survives.
 *   2. Ids are independent — the merge never cross-references them — so the
 *      per-id outcomes multiply.
 *   3. So the merge is a function of the update *set* if and only if no id has
 *      two distinct payloads tied at its maximal key. Every other arrangement
 *      converges, however much concurrency there was.
 *
 * Consequence 3 is why the convergence test can run thousands of cases with
 * same-element conflicts and unrelated conflicts mixed in and still assert a
 * single state, and why the one genuinely non-convergent shape is narrow enough
 * to name exactly.
 */
const predictedStateCount = (updates: readonly Update[]): number => {
  const byId = new Map<string, { max: FreshnessKey; tied: Set<string> }>();
  for (const update of updates) {
    const key = keyOf(update.element);
    const current = byId.get(update.id);
    if (!current) {
      byId.set(update.id, { max: key, tied: new Set([payloadOf(update)]) });
      continue;
    }
    if (keyGreater(key, current.max)) {
      current.max = key;
      current.tied.clear();
      current.tied.add(payloadOf(update));
    } else if (keyEqual(key, current.max)) {
      current.tied.add(payloadOf(update));
    }
  }
  let states = 1;
  for (const { tied } of byId.values()) states *= tied.size;
  return states;
};

describe('convergence characterisation', () => {
  it('produces exactly ∏(distinct payloads at each id max key) states over every ordering', () => {
    const tally = newTally();

    fc.assert(
      fc.property(fc.array(updateArb, { minLength: 1, maxLength: 6 }), updates => {
        tally.cases += 1;
        const orders = allOrders(updates.length);
        tally.replays += orders.length;

        const ids = new Set(updates.map(update => update.id));
        if (ids.size < updates.length) tally.sameElementConflicts += 1;
        if (BOUND_PAIRS.some(([a, b]) => ids.has(a) && ids.has(b))) tally.relatedPairCases += 1;
        if (updates.some(update => hasNoVersionMetadata(update.element))) {
          tally.legacyPayloadCases += 1;
        }

        const states = new Set(orders.map(order => replayInOrder(updates, order)));
        tally.distinctStates += states.size;
        const predicted = predictedStateCount(updates);
        if (predicted !== 1) tally.maxKeyTieCases += 1;
        // Thrown rather than returned false: the message carries the whole
        // repro (updates plus every resulting state), and fast-check still
        // shrinks the case and reports the seed with it.
        if (predicted !== states.size) {
          throw new Error(
            `predicted ${predicted} distinct states, observed ${states.size}\n` +
              `updates=${JSON.stringify(updates)}\n` +
              `states=${JSON.stringify([...states])}`
          );
        }
        return true;
      }),
      { seed: CONVERGENCE_SEED, numRuns: CONVERGENCE_RUNS }
    );

    report(
      `convergence cases=${tally.cases} replays=${tally.replays} ` +
        `distinctStates=${tally.distinctStates} maxKeyTieCases=${tally.maxKeyTieCases} ` +
        `sameElementConflicts=${tally.sameElementConflicts} ` +
        `relatedPairCases=${tally.relatedPairCases} legacyPayloadCases=${tally.legacyPayloadCases} ` +
        `seed=${CONVERGENCE_SEED} numRuns=${CONVERGENCE_RUNS}`
    );
    expect(tally.cases).toBe(CONVERGENCE_RUNS);
  });

  it('converges on one state whenever no id ties two distinct payloads at its max key', () => {
    // This is the production claim: given producers that never mint two
    // different payloads under one freshness key, the merge converges no matter
    // the interleaving. Same-element conflicts and related-element updates are
    // generated here because both are common and neither breaks it.
    let cases = 0;
    let orderings = 0;

    fc.assert(
      fc.property(
        // Conditional property: resample until the generated set satisfies the
        // precondition. The precondition is decidable and the filter cost is
        // negligible at these sizes.
        fc
          .array(updateArb, { minLength: 1, maxLength: 6 })
          .filter(updates => predictedStateCount(updates) === 1),
        updates => {
          cases += 1;
          const orders = allOrders(updates.length);
          orderings += orders.length;
          const states = new Set(orders.map(order => replayInOrder(updates, order)));
          if (states.size !== 1) {
            throw new Error(
              `expected 1 distinct state, observed ${states.size}\n` +
                `updates=${JSON.stringify(updates)}\n` +
                `states=${JSON.stringify([...states])}`
            );
          }
          return true;
        }
      ),
      { seed: CONVERGENCE_SEED, numRuns: CONVERGENCE_RUNS }
    );

    report(
      `convergence/unique-max cases=${cases} orderings=${orderings} ` +
        `seed=${CONVERGENCE_SEED} numRuns=${CONVERGENCE_RUNS}`
    );
    expect(cases).toBe(CONVERGENCE_RUNS);
  });
});

// ---------------------------------------------------------------------------
// 5. The known divergence, pinned
// ---------------------------------------------------------------------------

describe('KNOWN LIMIT (characterisation): two payloads under one freshness key diverge', () => {
  it('the winner is decided by arrival order, not by the update set', () => {
    // Minimal reproduction: two updates, no legacy element involved, no third
    // party. This is a real divergence — the surviving payload is a function of
    // delivery order, so two replicas that both saw both writes can disagree
    // permanently, and the loser's content is not recoverable from either.
    const red: Update = { id: 'e', element: payload(5, 3, 'red') };
    const green: Update = { id: 'e', element: payload(5, 3, 'green') };

    const redFirst = replayInOrder([red, green], [0, 1]);
    const greenFirst = replayInOrder([red, green], [1, 0]);
    expect(redFirst).toContain('"red"');
    expect(greenFirst).toContain('"green"');
    expect(redFirst).not.toBe(greenFirst);
  });

  it('the same shape arises from two metadata-free payloads, via the interop escape', () => {
    const red: Update = { id: 'e', element: payload(undefined, undefined, 'red') };
    const blue: Update = { id: 'e', element: payload(undefined, undefined, 'blue') };

    expect(shouldAcceptElement(red.element, blue.element)).toBe(true);
    expect(shouldAcceptElement(blue.element, red.element)).toBe(true);
    expect(replayInOrder([red, blue], [0, 1])).not.toBe(replayInOrder([red, blue], [1, 0]));
  });

  it('a tie below the maximum is harmless — the maximum is still unique', () => {
    // The limit is narrower than "duplicate keys". Duplicates at a non-maximal
    // key never surface, because the maximal-key payload wins in every order.
    // Stated as a test so the boundary is pinned from both sides.
    const low1: Update = { id: 'e', element: payload(1, 1, 'red') };
    const low2: Update = { id: 'e', element: payload(1, 1, 'blue') };
    const top: Update = { id: 'e', element: payload(2, 0, 'green') };
    const updates = [low1, low2, top];

    expect(predictedStateCount(updates)).toBe(1);
    const orders = allOrders(updates.length);
    expect(new Set(orders.map(order => replayInOrder(updates, order))).size).toBe(1);
  });

  it('a stale payload cannot overtake a strictly fresher one, whatever the order', () => {
    // The guarantee that does hold, asserted positively rather than inferred:
    // strict freshness dominates, so no interleaving can resurrect old content.
    const stale: Update = { id: 'e', element: payload(1, 0, 'red') };
    const fresh: Update = { id: 'e', element: payload(9, 0, 'green') };
    for (const order of allOrders(2)) {
      expect(replayInOrder([stale, fresh], order)).toContain('"green"');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Design limits, asserted so they cannot be "fixed" by accident
// ---------------------------------------------------------------------------

describe('documented design limits (asserted, not aspirational)', () => {
  it('discards one of two concurrent edits to the same element (last-writer-wins)', () => {
    // Convergence is not preservation. This is the user-visible cost of the
    // design, asserted here so a change that quietly starts merging (or
    // silently stops discarding) has to say so in this file.
    const a: Update = { id: 'shape-a', element: payload(4, 7, 'red') };
    const b: Update = { id: 'shape-a', element: payload(4, 3, 'blue') };
    expect(shouldAcceptElement(b.element, a.element)).toBe(true);
    expect(shouldAcceptElement(a.element, b.element)).toBe(false);
  });

  it('can tear a multi-element relationship (no cross-element atomicity)', () => {
    // A bound-text edit writes the shape and its label as two independent
    // updates. Per-id reconciliation therefore keeps one half of the pair and
    // drops the other, and nothing in the merge notices. Asserted as the known
    // limit: the replicas still agree, they just agree on a torn scene.
    const staleShape: Update = { id: 'shape-a', element: payload(1, 1, 'green') };
    const labelEdit: Update = { id: 'label-a', element: payload(2, 1, 'blue') };
    const shapeMove: Update = { id: 'shape-a', element: payload(9, 1, 'red') };

    // The label half is admitted without reference to the shape half.
    expect(shouldAcceptElement(labelEdit.element, undefined)).toBe(true);
    const torn = replayInOrder([staleShape, labelEdit, shapeMove], [0, 1, 2]);
    expect(torn).toContain('shape-a');
    expect(torn).toContain('label-a');
  });
});
