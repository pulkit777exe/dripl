import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES, parseDriplDocument } from '@/utils/export/native';

/**
 * The byte ceiling in `parseDriplDocument`.
 *
 * This guard exists to bound work, not to police content, and the two properties
 * that make it work are both about *where* it sits rather than *what* it says:
 *
 * 1. It runs before `JSON.parse`, so an oversized document is rejected without
 *    ever being materialised as objects. Moving it one line down would still
 *    produce the same rejection for a valid document, and would silently give up
 *    the property for a malformed one.
 * 2. It is a strict `>` against a length, so the boundary case is a document of
 *    exactly `MAX_IMPORT_BYTES` and it must be accepted.
 *
 * `MAX_IMPORT_BYTES` is imported rather than retyped so the fixtures cannot drift
 * from the constant, and every length below is computed from it.
 */

/** A document of exactly `length` characters that is otherwise a valid empty scene. */
function documentOfLength(length: number): string {
  const base = JSON.stringify({ version: 1, type: 'dripl-scene', elements: [], appState: {} });
  expect(base.length).toBeLessThanOrEqual(length);
  // Trailing whitespace is ignored by JSON.parse, so padding cannot change the
  // document's meaning — only its size.
  return base + ' '.repeat(length - base.length);
}

describe('parseDriplDocument — the byte ceiling', () => {
  it('rejects a document one character over the ceiling', () => {
    expect(() => parseDriplDocument(documentOfLength(MAX_IMPORT_BYTES + 1))).toThrow(/too large/i);
  });

  it('accepts a document of exactly the ceiling', () => {
    // The boundary. `raw.length > MAX_IMPORT_BYTES` is strict, so a file of
    // precisely the limit is allowed through and parsed normally. Asserting the
    // ceiling case as well as the over case is what pins `>` against `>=`.
    const result = parseDriplDocument(documentOfLength(MAX_IMPORT_BYTES));
    expect(result.elements).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.dropped).toBe(0);
  });

  it('rejects on size before parsing, so an oversized document is never materialised', () => {
    // The distinguishing case. This is NOT valid JSON, so a guard that ran after
    // `JSON.parse` would surface a syntax error instead of the size refusal —
    // which is what proves the ordering. Without it, the other two tests would
    // still pass with the guard moved below the parse.
    const oversizedGarbage = '{'.padEnd(MAX_IMPORT_BYTES + 1, 'x');
    expect(() => parseDriplDocument(oversizedGarbage)).toThrow(/too large/i);
    // The same garbage under the ceiling *is* a parse error, so the two
    // messages are distinguishable and the assertion above is not vacuous.
    expect(() => parseDriplDocument('{'.padEnd(MAX_IMPORT_BYTES, 'x'))).toThrow(
      /JSON|Unexpected|JSONInput/i
    );
  });

  it('measures length in characters, not bytes, so multi-byte content is bounded by string length', () => {
    // `String.prototype.length` counts UTF-16 code units, and a surrogate pair is
    // two of them. So a string of `n` astral characters has `length === 2n` and
    // is measured as `2n` characters even though it occupies `4n` bytes of UTF-8.
    // This is the actual behaviour of the guard as written, recorded rather than
    // endorsed: the ceiling is a bound on parse cost (which tracks characters),
    // not on file size on disk (which tracks bytes). A single-character-over
    // ceiling built from astral characters must therefore still be rejected.
    const half = Math.ceil(MAX_IMPORT_BYTES / 2) + 1;
    const astral = '\u{1F600}'.repeat(half);
    expect(astral.length).toBeGreaterThan(MAX_IMPORT_BYTES);
    expect(() => parseDriplDocument(astral)).toThrow(/too large/i);
  });
});
