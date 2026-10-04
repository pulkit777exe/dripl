/**
 * `isValidSceneContent` — the single gate that decides what may be stored as, and
 * served as, a canvas scene.
 *
 * Both file routes and both room routes funnel every scene through this function
 * before it reaches the database, and `ShareService.resolveShare` runs it again on
 * the way out. So it is simultaneously the write-side validator and the read-side
 * filter, which means a false *accept* is both a storage problem and a disclosure:
 * whatever passes is serialised into the `content` column and handed to every
 * viewer of a share link.
 *
 * It had no direct test. Every existing case reaches it through a route with a
 * convenient scene, so the shape-handling — which is where the function actually
 * branches — was never exercised, including the `{ elements: [...] }` envelope that
 * ADR-004 introduced and the element-count ceiling.
 *
 * WHAT IS WORTH PINNING
 *
 *   1. **The three accepted shapes.** A bare array, and an object carrying
 *      `elements`. Everything else — a JSON string, a number, `null`, an object whose
 *      `elements` is not an array — is refused.
 *   2. **The element-count ceiling, at the boundary.** `MAX_SCENE_ELEMENTS` is a
 *      DoS control: a scene of 5,001 valid elements is refused. At exactly the limit
 *      it is accepted, because an off-by-one here either lets a 5,001-element scene
 *      through or refuses a legitimate one.
 *   3. **Per-element validation.** One malformed element refuses the whole scene.
 *      A validator that stopped checking elements would accept `[42]`, store it, and
 *      hand it to a renderer that would throw on the reader's side.
 */

import { describe, expect, it } from 'vitest';
import { MAX_SCENE_ELEMENTS } from '@dripl/common';
import { isValidSceneContent } from '../../lib/sceneValidation';

/** A minimal valid element. */
const element = (id: string): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

describe('the shapes it accepts', () => {
  it('accepts a bare array of valid elements', () => {
    expect(isValidSceneContent([element('a'), element('b')])).toBe(true);
  });

  /**
   * The envelope shape, which is what ADR-004 stores.
   *
   * `FileService` writes `serializeStoredFileContent(...)`, i.e.
   * `{ elements, encryptedPayload, encryptedAt }`, and `updateFile` re-reads the
   * stored row through this function. A validator that only understood bare arrays
   * would refuse every scene the service itself had written — which reads as "all
   * saves are invalid" rather than as a validator bug, so it is worth naming.
   */
  it('accepts an object carrying an elements array', () => {
    expect(isValidSceneContent({ elements: [element('a')] })).toBe(true);
  });

  /**
   * An empty scene is valid.
   *
   * This is the default for a new file (`createFile` passes `[]`), so a validator
   * that treated emptiness as invalid would make it impossible to create a canvas.
   */
  it('accepts an empty scene in both shapes', () => {
    expect(isValidSceneContent([])).toBe(true);
    expect(isValidSceneContent({ elements: [] })).toBe(true);
  });

  /**
   * Extra keys alongside `elements` do not disqualify the envelope.
   *
   * The real envelope carries `encryptedPayload`, `encryptedAt` and `appState`, none
   * of which this function inspects. Refusing them would refuse every encrypted
   * canvas, so the leniency is load-bearing rather than an oversight.
   */
  it('accepts the full stored envelope, including the encrypted fields', () => {
    expect(
      isValidSceneContent({
        elements: [element('a')],
        encryptedPayload: { iv: 'aXY=', data: 'Y2lwaGVy' },
        encryptedAt: '2026-01-01T00:00:00.000Z',
        appState: { zoom: 1 },
      })
    ).toBe(true);
  });
});

describe('the shapes it refuses', () => {
  /**
   * Everything that is not one of the two accepted shapes.
   *
   * Asserted as a table because the function's shape handling is three separate
   * ternaries, and a change to any one of them (accepting a bare object, accepting a
   * string) is a distinct way for arbitrary JSON to be treated as a scene.
   */
  it('refuses anything that is not a scene in one of the two shapes', () => {
    const refused: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['a bare string', '[]'],
      ['a JSON string holding a scene', '[{"id":"a"}]'],
      ['a boolean', true],
      ['an object with no elements key', { nope: [] }],
      ['an object whose elements is not an array', { elements: { a: 1 } }],
      ['an object whose elements is null', { elements: null }],
      ['an array of primitives', [1, 2, 3]],
      ['an array containing null', [null]],
      ['an empty object', {}],
    ];

    for (const [label, value] of refused) {
      expect(isValidSceneContent(value), label).toBe(false);
    }
  });

  /**
   * A JSON string holding a *valid* scene is still refused.
   *
   * This is the shape an implementation mistake produces: `JSON.parse` once in the
   * route and then validating the unparsed string. Accepting it would mean the stored
   * `content` column could hold a doubly-encoded scene, and every reader downstream
   * — `parseStoredFileContent`, the renderer, `resolveShare` — would have to know
   * which of the two encodings it is looking at.
   */
  it('refuses a scene that arrived as a JSON string rather than as a value', () => {
    expect(isValidSceneContent(JSON.stringify([element('a')]))).toBe(false);
  });

  /**
   * One bad element refuses the whole scene.
   *
   * A validator that checked only the first element, or only the array-ness, would
   * accept a scene the renderer would then throw on. Asserted with the bad element in
   * each position — first, middle and last — because "checks the first" and "checks
   * the last" are both plausible partial implementations.
   */
  it('refuses a scene where any single element is invalid', () => {
    const valid = [element('a'), element('b'), element('c')];

    for (const [label, scene] of [
      ['first', [{ id: 'bad' }, element('b')]],
      ['middle', [element('a'), { id: 'bad' }, element('c')]],
      ['last', [element('a'), element('b'), { id: 'bad' }]],
    ] as Array<[string, unknown[]]>) {
      expect(isValidSceneContent(scene), label).toBe(false);
    }

    // The control: the same shape with every element valid is accepted.
    expect(isValidSceneContent(valid)).toBe(true);
  });

  /**
   * An element of a plausible-but-unknown type is refused.
   *
   * `DriplElementSchema` is a discriminated union, so a type the renderer does not
   * implement cannot validate. Accepting unknown types would put a row in the `content`
   * column that no client can draw.
   */
  it('refuses an element whose type the union does not define', () => {
    expect(isValidSceneContent([{ ...element('a'), type: 'not-a-real-type' }])).toBe(false);
  });

  /**
   * An element missing a required field is refused.
   *
   * A partial element reaching storage produces a scene that throws on render, so
   * the required-field check is the difference between a rejected write and a
   * support ticket.
   */
  it('refuses an element missing a required field', () => {
    for (const missing of ['id', 'type', 'x', 'y', 'width', 'height']) {
      const incomplete: Record<string, unknown> = { ...element('a') };
      delete incomplete[missing];
      expect(isValidSceneContent([incomplete]), `missing ${missing}`).toBe(false);
    }
  });
});

describe('the element-count ceiling, at the boundary', () => {
  /**
   * `MAX_SCENE_ELEMENTS` is the DoS control, and the boundary is the whole point:
   *
   *   - At exactly the limit, accepted. A scene that large is a legitimate large
   *     canvas, and an off-by-one refusing it is a data-loss bug for the user who
   *     built it.
   *   - At one over, refused. This is the side that matters: 5,001 elements is what a
   *     caller sends to make every reader parse and lay out one more element than the
   *     budget allows.
   *
   * Asserted on both sides, and the counts are read from the constant rather than
   * written out, so raising the constant does not silently turn this into a test that
   * checks a different number.
   */
  it('accepts exactly MAX_SCENE_ELEMENTS and refuses one more', () => {
    const atLimit = Array.from({ length: MAX_SCENE_ELEMENTS }, (_, index) => element(`e${index}`));
    const overLimit = [...atLimit, element('one-too-many')];

    expect(isValidSceneContent(atLimit)).toBe(true);
    expect(isValidSceneContent(overLimit)).toBe(false);
  });

  /**
   * The ceiling applies to the envelope too.
   *
   * `isValidSceneContent` is called on `parsedContent.elements` after
   * `parseStoredFileContent` has already unwrapped the envelope, so the count is the
   * same either way — but only because the unwrapping happens first. Asserted on the
   * envelope shape directly so a change that counted the wrapper's own keys would
   * fail here rather than in a route test with a 2 MB body.
   */
  it('applies the same ceiling to the envelope shape', () => {
    const atLimit = Array.from({ length: MAX_SCENE_ELEMENTS }, (_, index) => element(`e${index}`));

    expect(isValidSceneContent({ elements: atLimit })).toBe(true);
    expect(isValidSceneContent({ elements: [...atLimit, element('one-too-many')] })).toBe(false);
  });

  /**
   * A count over the ceiling is refused even when every element is valid.
   *
   * The control for the two cases above, so "refuses one over the limit" cannot be
   * satisfied by a validator that simply rejects large arrays for an unrelated
   * reason.
   */
  it('refuses an over-limit scene whose elements are all individually valid', () => {
    const overLimit = Array.from({ length: MAX_SCENE_ELEMENTS + 1 }, (_, index) =>
      element(`e${index}`)
    );

    // One of them on its own is a valid one-element scene.
    expect(isValidSceneContent([overLimit[0]])).toBe(true);
    expect(isValidSceneContent(overLimit)).toBe(false);
  });
});
