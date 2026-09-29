import { describe, it, expect } from 'vitest';
import {
  AiResponseError,
  extractBalancedArray,
  parseJsonCandidate,
  parseModelElements,
  responseText,
} from '@/lib/ai/parse';
import { isRetryableGeminiError, serializeError } from '@/lib/ai/errors';

describe('extractBalancedArray', () => {
  it('pulls the first balanced array out of prose', () => {
    expect(extractBalancedArray('here you go [{"a":1}] enjoy')).toBe('[{"a":1}]');
  });

  it('ignores brackets inside strings', () => {
    expect(extractBalancedArray('text "[not an array]" then [1,2]')).toBe('[1,2]');
  });

  it('returns null when nothing balances', () => {
    expect(extractBalancedArray('no brackets here')).toBeNull();
    expect(extractBalancedArray('[[[ oops')).toBeNull();
  });
});

describe('parseJsonCandidate', () => {
  it('accepts raw arrays and {elements} envelopes', () => {
    expect(parseJsonCandidate('[1,2]')).toEqual([1, 2]);
    expect(parseJsonCandidate('{"elements":[3]}')).toEqual([3]);
  });

  it('rejects non-arrays and garbage', () => {
    expect(parseJsonCandidate('{"a":1}')).toBeNull();
    expect(parseJsonCandidate('not json')).toBeNull();
  });
});

describe('parseModelElements', () => {
  it('unfences markdown code blocks', () => {
    expect(parseModelElements('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it('throws AiResponseError on oversize and unusable input', () => {
    expect(() => parseModelElements('x'.repeat(200_001))).toThrow(AiResponseError);
    expect(() => parseModelElements('just prose')).toThrow(AiResponseError);
  });
});

describe('responseText', () => {
  const textResult = (text: string) => ({
    response: { candidates: [{ finishReason: 'STOP' }], text },
  });

  it('returns body text and rejects blocked/empty responses', () => {
    expect(responseText(textResult('[{"a":1}]'))).toBe('[{"a":1}]');
    expect(() => responseText({ response: { promptFeedback: { blockReason: 'SAFETY' } } })).toThrow(
      AiResponseError
    );
    expect(() => responseText(textResult('   '))).toThrow(AiResponseError);
    expect(() =>
      responseText({ response: { candidates: [{ finishReason: 'MAX_TOKENS' }] } })
    ).toThrow(expect.objectContaining({ code: 'AI_INCOMPLETE' }));
  });
});

describe('isRetryableGeminiError', () => {
  it('retries transient failures but never quota exhaustion', () => {
    expect(isRetryableGeminiError({ status: 503 })).toBe(true);
    expect(isRetryableGeminiError({ status: 429 })).toBe(false);
    expect(isRetryableGeminiError(new Error('temporarily overloaded'))).toBe(true);
    expect(isRetryableGeminiError(new Error('nope'))).toBe(false);
  });
});

describe('serializeError', () => {
  it('shapes errors without leaking stacks', () => {
    expect(serializeError(new Error('boom'))).toBe('boom');
    const shaped = serializeError({ name: 'N', message: 'm', status: 500 });
    expect(JSON.parse(shaped)).toMatchObject({ name: 'N', message: 'm', status: 500 });
    expect(serializeError(42)).toBe('42');
  });
});
