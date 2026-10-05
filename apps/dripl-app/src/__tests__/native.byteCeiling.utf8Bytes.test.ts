import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES, parseDriplDocument } from '@/utils/export/native';

/**
 * `MAX_IMPORT_BYTES` is a ceiling on *encoded* bytes, not on UTF-16 code units.
 *
 * `String.prototype.length` counts code units, and it undercounts every
 * multi-byte character — a surrogate pair is 2 units and a 4-byte encoding, so
 * an astral-heavy document measures at half its true size. A limit named
 * `..._BYTES` that silently admits twice the payload it promises is a trap for
 * the next caller who reuses it as an upload limit, which is why the guard
 * encodes with `TextEncoder` before comparing.
 *
 * The property that makes these tests bite is that the *unit* changed while the
 * number did not. A guard reading `raw.length` passes every fixture here whose
 * length is under the ceiling, so the tests are built around documents that are
 * over the ceiling in bytes and under it in code units — the one region where
 * the two readings disagree.
 *
 * Fixtures are sized by derivation from `MAX_IMPORT_BYTES` (imported, never
 * retyped) and every fixture asserts its own two measurements before the
 * behaviour under test, so a fixture that stops landing where it is meant to
 * fails loudly instead of silently becoming easy to pass.
 */

/** An astral-plane character: 2 UTF-16 code units, 4 UTF-8 bytes. */
const ASTRAL = '\u{1F600}';
const ASTRAL_CODE_UNITS = 2;
const ASTRAL_BYTES = 4;

/** The size the guard compares against, measured the way the guard measures it. */
const byteLengthOf = (value: string) => new TextEncoder().encode(value).byteLength;

/**
 * A valid, otherwise-empty scene carrying `filler` in an `appState` field the
 * parser passes through without reading. Padding lives inside the document
 * rather than after it so the padding's own encoding is what varies: trailing
 * whitespace can only be ASCII and so cannot carry a multi-byte fixture.
 */
function documentWithFiller(filler: string): string {
  return JSON.stringify({
    version: 1,
    type: 'dripl-scene',
    elements: [],
    appState: { padding: filler },
  });
}

const BASE_LENGTH = documentWithFiller('').length;

/**
 * The smallest astral count that puts the document *over* the ceiling.
 *
 * `ASTRAL_BYTES * ceil((MAX - BASE_LENGTH) / ASTRAL_BYTES)` is at least
 * `MAX - BASE_LENGTH` on its own, so the encoded filler already reaches the
 * ceiling; the `+ 1` makes it strictly over, which is what a `>` (rather than
 * `>=`) guard needs to refuse. Its code-unit count is roughly half that, so
 * the document lands under the ceiling in `length` — the disagreement the fix
 * exists to resolve.
 */
const ASTRAL_COUNT = Math.ceil((MAX_IMPORT_BYTES - BASE_LENGTH) / ASTRAL_BYTES) + 1;

/** A valid document of exactly `bytes` UTF-8 bytes, built from astral filler. */
function astralDocumentOfBytes(bytes: number): string {
  // The remainder is 0..3 characters, which an ASCII tail pays for one code
  // unit *and* one byte each, so the total lands on `bytes` exactly.
  const astralCount = Math.floor((bytes - BASE_LENGTH) / ASTRAL_BYTES);
  const remainder = bytes - BASE_LENGTH - astralCount * ASTRAL_BYTES;
  return documentWithFiller(ASTRAL.repeat(astralCount) + 'a'.repeat(remainder));
}

describe('parseDriplDocument — the ceiling is counted in UTF-8 bytes', () => {
  it('refuses an astral document that is over the ceiling in bytes but under it in code units', () => {
    // The case a `raw.length` guard gets wrong, and the reason for the fix.
    const astral = documentWithFiller(ASTRAL.repeat(ASTRAL_COUNT));

    // Both measurements asserted, because the test is only meaningful in the
    // region where they disagree. If either stops holding, the refusal below
    // is no longer evidence about byte-vs-code-unit accounting.
    expect(astral.length).toBeLessThan(MAX_IMPORT_BYTES);
    expect(byteLengthOf(astral)).toBeGreaterThan(MAX_IMPORT_BYTES);

    expect(() => parseDriplDocument(astral)).toThrow(/too large/i);
  });

  it('accepts an ASCII document of exactly the same length as the astral one', () => {
    // The controlled pair for the test above: identical structure and identical
    // `length`, differing only in how the filler encodes. Two ASCII characters
    // cost what one astral character costs in code units, so matching the astral
    // fixture's length here is what makes the comparison a fair one.
    const astral = documentWithFiller(ASTRAL.repeat(ASTRAL_COUNT));
    const ascii = documentWithFiller('a'.repeat(ASTRAL_COUNT * ASTRAL_CODE_UNITS));

    expect(ascii.length).toBe(astral.length);
    expect(byteLengthOf(ascii)).toBe(ascii.length);

    const result = parseDriplDocument(ascii);
    expect(result.elements).toEqual([]);
    expect(result.partial).toBe(false);
  });

  it('accepts a document of exactly the ceiling in bytes', () => {
    // The boundary, decided in bytes. `> MAX_IMPORT_BYTES` is strict, so a file
    // of precisely the limit is allowed through. Asserting the ceiling alongside
    // the over case is what pins `>` against `>=`; asserting the encoded length
    // alongside the parse is what pins it in *bytes*, since this document's
    // code-unit count is roughly half the limit.
    const atLimit = astralDocumentOfBytes(MAX_IMPORT_BYTES);
    expect(byteLengthOf(atLimit)).toBe(MAX_IMPORT_BYTES);
    expect(atLimit.length).toBeLessThan(MAX_IMPORT_BYTES);

    const result = parseDriplDocument(atLimit);
    expect(result.elements).toEqual([]);
    expect(result.partial).toBe(false);
  });

  it('refuses a document one byte over the ceiling', () => {
    // The other side of the same boundary: a single byte of difference must be
    // enough, in a multi-byte document whose code-unit count is nowhere near
    // the limit. Under a `raw.length` guard this document would be accepted.
    const overLimit = astralDocumentOfBytes(MAX_IMPORT_BYTES + 1);
    expect(byteLengthOf(overLimit)).toBe(MAX_IMPORT_BYTES + 1);
    expect(overLimit.length).toBeLessThan(MAX_IMPORT_BYTES);

    expect(() => parseDriplDocument(overLimit)).toThrow(/too large/i);
  });

  it('refuses on measured size before parsing, so an oversized astral document is never materialised', () => {
    // The ordering property, which now has to survive the encoding step that sits
    // above `JSON.parse`. This text is not JSON, so a guard that ran after the
    // parse would surface a syntax error instead of the size refusal. Sized to be
    // over the ceiling in bytes and under it in code units, so it is also a
    // boundary the old `raw.length` reading never reached.
    const oversizedGarbage = `{${ASTRAL.repeat(MAX_IMPORT_BYTES / ASTRAL_BYTES + 1)}`;
    expect(byteLengthOf(oversizedGarbage)).toBeGreaterThan(MAX_IMPORT_BYTES);
    expect(oversizedGarbage.length).toBeLessThan(MAX_IMPORT_BYTES);

    expect(() => parseDriplDocument(oversizedGarbage)).toThrow(/too large/i);

    // The same shape comfortably under the ceiling is a parse error, so the two
    // messages are distinguishable and the assertion above is not vacuous.
    expect(() => parseDriplDocument(`[${ASTRAL.repeat(4)}`)).toThrow(/JSON|Unexpected|JSONInput/i);
  });
});
