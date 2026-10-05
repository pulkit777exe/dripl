import { describe, expect, it } from 'vitest';
import { normalizeImportedElement } from '@/utils/export/normalize';

/**
 * The `groupId` branch of the import normalizer.
 *
 * `normalize.ts` reads a group membership from two places, in precedence order:
 * the current `groupId` string, and a legacy `groupIds` array from older files.
 * The existing suite (`exportNormalize.test.ts`) exercises the legacy array and
 * the `remapElementReferences` path, but never the primary field — so the branch
 * a current Dripl file actually takes was untested, while the fallback for a
 * format this version of Dripl no longer writes was pinned.
 *
 * That ordering is load-bearing in both directions. Group membership is
 * projected onto `groupId` alone, so a payload carrying both a `groupId` and a
 * `groupIds` array resolves to whichever the source checks first, and a payload
 * whose `groupId` is a non-string has to fall through to the array rather than be
 * trusted. Each test below asserts the winner and the loser together, because a
 * test that only checked "the group survived" would pass under either precedence.
 */

/** A minimal valid rectangle, so each test can vary exactly one field. */
const imported = (over: Record<string, unknown> = {}) =>
  normalizeImportedElement(
    { id: 'e1', type: 'rectangle', x: 0, y: 0, width: 20, height: 30, ...over },
    {}
  );

describe('normalizeImportedElement — group membership', () => {
  it('reads groupId from the current string field', () => {
    expect(imported({ groupId: 'g1' })!.groupId).toBe('g1');
  });

  it('keeps groupId empty rather than reaching for the legacy array', () => {
    // The precedence assertion. A file written by this version carries `groupId`;
    // one written by an older one carries `groupIds`. If a file somehow carries
    // both, `groupId` is the field the producer meant, so `groupIds` must not win.
    // Swapping the two branches makes this fail while every other test in the
    // file still passes — the array-only cases do not discriminate.
    const element = imported({ groupId: 'current', groupIds: ['legacy'] });
    expect(element!.groupId).toBe('current');
    expect(element!.groupId).not.toBe('legacy');
  });

  it('falls back to the first legacy groupIds entry when groupId is absent', () => {
    // Same reason as above from the other side: dropping the `else if` would leave
    // this ungrouped, and the current-field tests would not notice.
    expect(imported({ groupIds: ['g1', 'g2'] })!.groupId).toBe('g1');
  });

  it('falls back to the legacy array when groupId is not a string', () => {
    // The `typeof` guard, not truthiness. A numeric or null `groupId` is
    // unusable — `ElementSchema.groupId` is `z.string()`, so keeping it would
    // fail the final `safeParse` and drop the element entirely, losing the user's
    // whole shape over a malformed group field. Coercing is the intended repair.
    expect(imported({ groupId: 7, groupIds: ['legacy'] })!.groupId).toBe('legacy');
    expect(imported({ groupId: null, groupIds: ['legacy'] })!.groupId).toBe('legacy');
    // With nothing to fall back to, the element survives and stays ungrouped.
    // An assertion that this returned null instead would also be satisfied by a
    // normalizer that dropped every ungrouped element — hence the explicit
    // check that the element came back at all.
    expect(imported({ groupId: 7 })?.groupId).toBeUndefined();
    expect(imported({ groupId: 7 })).not.toBeNull();
  });

  it('ignores a legacy array whose first entry is not a string', () => {
    // Only index 0 is inspected, and only for its type. Falling through to a
    // later valid entry would be inventing a membership the file never stated.
    expect(imported({ groupIds: [7, 'g1'] })?.groupId).toBeUndefined();
    expect(imported({ groupIds: [] })?.groupId).toBeUndefined();
  });

  it('leaves an element with no group information ungrouped', () => {
    expect(imported()?.groupId).toBeUndefined();
  });
});
