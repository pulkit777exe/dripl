import { describe, expect, it } from 'vitest';
import {
  AiResponseError,
  extractBalancedArray,
  parseModelElements,
  responseText,
} from '@/lib/ai/parse';
import { MAX_MODEL_RESPONSE_LENGTH } from '@/lib/ai/constants';

/**
 * The unhappy half of the AI response parser.
 *
 * `lib/ai/parse.ts` has one job beyond "read the text": decide what to do with
 * output that is *not* a clean JSON array, which is the overwhelmingly common
 * case. Model output arrives fenced, wrapped in prose, truncated mid-array, or
 * carrying a bracket inside a quoted label — and every one of those decisions is
 * a branch the route's error envelope is built from.
 *
 * Two things are pinned here that a "does it parse the happy path" suite misses:
 *
 * 1. **String-aware scanning.** `extractBalancedArray` tracks `inString` and
 *    `escaped` so that a `]` inside a quoted label does not close the array. The
 *    escaped-quote handling is the subtle half: without it, `"a\"b"]` unbalances
 *    and the parser returns `null`, so a perfectly good diagram is reported as
 *    unusable. Both halves are exercised against text where a broken scanner
 *    produces a *different* answer, never merely "an error".
 *
 * 2. **Which error, with which code.** A parser that throws `AiResponseError`
 *    from four different places is four different machine-readable outcomes for
 *    the route to relay. Asserting only `toThrow(AiResponseError)` would let all
 *    four collapse into one, so every case below asserts `code` and `status`
 *    separately.
 */

/** Run `fn`, return the `AiResponseError` it raised, and fail if it did not raise one. */
function captureAiError(run: () => unknown): AiResponseError {
  try {
    run();
  } catch (error) {
    if (error instanceof AiResponseError) return error;
    throw error;
  }
  throw new Error('expected an AiResponseError, but the call returned normally');
}

/* ------------------------------------------------------------------ *
 * extractBalancedArray — the scanner must respect quoted text
 * ------------------------------------------------------------------ */

describe('extractBalancedArray — escape handling inside strings', () => {
  it('does not let an escaped quote close the string', () => {
    // The fixture is a label holding an escaped double quote, followed by real
    // trailing prose with its own array. A scanner that ignored the backslash
    // would end its string at the escaped quote, then read the `]` as a real
    // close — and the trailing `[99]` would become the answer.
    const text = '["a\\"b"] trailing prose [99]';

    expect(extractBalancedArray(text)).toBe('["a\\"b"]');
  });

  it('does not let a `]` inside a quoted label close the array', () => {
    // Same scanner, different hazard: the closing bracket is *inside* the
    // string. A scanner that tracked depth but not `inString` would stop here
    // and hand back a truncated, unparseable array.
    const text = '["step ] three"] tail [7]';

    expect(extractBalancedArray(text)).toBe('["step ] three"]');
    // And the array it did not return is the one a broken scanner would give.
    expect(extractBalancedArray(text)).not.toBe('[7]');
  });

  it('treats an escaped backslash as a literal, not as escaping the next quote', () => {
    // `"back\\"` closes the string on the *second* backslash's following quote.
    // If `escaped` were set by the second backslash and cleared by the quote,
    // the string would stay open and the trailing `[7]` would never balance.
    const text = '["back\\\\"] trailing [7]';

    expect(extractBalancedArray(text)).toBe('["back\\\\"]');
  });

  it('returns null for an array that never closes, escaped or not', () => {
    // The negative direction: escaping must not be able to *invent* a close.
    expect(extractBalancedArray('["unterminated\\" still open')).toBeNull();
  });

  it('tracks depth across nested arrays rather than returning at the first close', () => {
    const text = '[[1,2],[3,4]] then [5]';

    expect(extractBalancedArray(text)).toBe('[[1,2],[3,4]]');
  });
});

/* ------------------------------------------------------------------ *
 * parseModelElements — the size cap is a boundary, not a threshold
 * ------------------------------------------------------------------ */

describe('parseModelElements — response size boundary', () => {
  /**
   * A syntactically valid array of exactly `length` characters.
   *
   * Padding goes *inside* the brackets as whitespace rather than as filler
   * values, because JSON permits whitespace between tokens and the parser must
   * therefore accept a response that is mostly padding — which is exactly the
   * shape a padded oversize response has when it slips under the cap.
   */
  function validJsonOfLength(length: number): string {
    // `'[{"a":1}'` (8) + padding + `']'` (1).
    const padding = length - 9;
    return `[{"a":1}${' '.repeat(padding)}]`;
  }

  it('accepts a response at exactly the cap', () => {
    const text = validJsonOfLength(MAX_MODEL_RESPONSE_LENGTH);
    expect(text).toHaveLength(MAX_MODEL_RESPONSE_LENGTH);

    expect(parseModelElements(text)).toEqual([{ a: 1 }]);
  });

  it('refuses a response one character over the cap, with the too-large code', () => {
    const text = validJsonOfLength(MAX_MODEL_RESPONSE_LENGTH + 1);
    expect(text).toHaveLength(MAX_MODEL_RESPONSE_LENGTH + 1);

    // It parses perfectly well as JSON; only the size refuses it. So the error
    // must be the size error and not the generic "unusable" one, or the route
    // would tell the user their prompt was bad rather than that the answer
    // would not fit.
    const error = captureAiError(() => parseModelElements(text));
    expect(error.code).toBe('AI_RESPONSE_ERROR');
    expect(error.message).toBe('The AI response was too large to process.');
  });

  it('reports the unusable-output failure distinctly from the size failure', () => {
    // Both raise the same `code`; the *message* is what separates them, and the
    // route relays `error.message` verbatim into the response body. Pinning the
    // message keeps the two from being collapsed into one unhelpful answer.
    const unusable = captureAiError(() => parseModelElements('the model apologised instead'));
    expect(unusable.code).toBe('AI_RESPONSE_ERROR');
    expect(unusable.message).toBe('The AI returned an unusable diagram.');
    expect(unusable.status).toBe(502);
  });
});

/* ------------------------------------------------------------------ *
 * responseText — a malformed envelope is a typed outcome, not a TypeError
 * ------------------------------------------------------------------ */

/** The shape the SDK returns when it has text to give. */
function withText(response: Record<string, unknown>): unknown {
  return { response };
}

describe('responseText — malformed envelopes', () => {
  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'a bare string', value: 'text' },
    { label: 'an array', value: ['text'] },
    { label: 'an object with no response', value: { text: 'text' } },
    // An array is an object but not a record, so `isRecord` must refuse it;
    // otherwise `response.candidates` would be read off the array itself.
    { label: 'a response that is an array', value: { response: [] } },
    { label: 'a response that is a string', value: { response: 'text' } },
  ])('raises the empty-response error for $label', ({ value }) => {
    const error = captureAiError(() => responseText(value));

    expect(error.code).toBe('AI_RESPONSE_ERROR');
    expect(error.message).toBe('The AI returned an empty response.');
    expect(error.status).toBe(502);
  });

  it('raises the empty-response error when reading the text throws', () => {
    // The SDK's `text()` is a thunk over the stream; it can raise when the
    // stream is already torn down. Without the guard that TypeError would
    // escape as a generic 502 INTERNAL_ERROR, telling the user nothing and
    // telling the operator it was an unexpected crash.
    const error = captureAiError(() =>
      responseText(
        withText({
          text: () => {
            throw new Error('stream already closed');
          },
        })
      )
    );

    expect(error.code).toBe('AI_RESPONSE_ERROR');
    expect(error.message).toBe('The AI returned an empty response.');
  });

  it('calls a text thunk with `response` as its receiver', () => {
    // `text()` is read off the response object, so it needs `this`. An unbound
    // call raises, which is the branch asserted above — which is only a
    // meaningful test if the bound call is the one that succeeds here.
    const response = {
      marker: 'the-response-object',
      text(this: { marker: string }) {
        return this.marker;
      },
    };

    expect(responseText({ response })).toBe('the-response-object');
  });

  it('refuses a blocked prompt as CONTENT_BLOCKED at 422, not the generic error', () => {
    const error = captureAiError(() =>
      responseText({ response: { promptFeedback: { blockReason: 'SAFETY' } } })
    );

    expect(error.code).toBe('CONTENT_BLOCKED');
    expect(error.status).toBe(422);
  });

  it('does not treat an unspecified block reason as a block', () => {
    // The sentinel means "no reason given", so it must fall through to the text
    // and succeed. Refusing it would blank every diagram from a model that
    // simply omits the field.
    expect(
      responseText(
        withText({
          promptFeedback: { blockReason: 'BLOCKED_REASON_UNSPECIFIED' },
          text: 'rendered',
        })
      )
    ).toBe('rendered');
  });
});
