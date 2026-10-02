import { describe, expect, it } from 'vitest';
import { normalizeLinkInput } from '@/lib/canvas/link';

describe('normalizeLinkInput', () => {
  it('reports no change for identical input', () => {
    expect(normalizeLinkInput('https://a.com', 'https://a.com')).toEqual({
      changed: false,
      value: undefined,
    });
  });

  it('clears on empty input', () => {
    expect(normalizeLinkInput('   ', 'https://a.com')).toEqual({ changed: true, value: undefined });
  });

  it('prepends https to bare domains', () => {
    expect(normalizeLinkInput('example.com', '')).toEqual({
      changed: true,
      value: 'https://example.com',
    });
  });

  it('keeps explicit schemes untouched', () => {
    expect(normalizeLinkInput('http://a.com', '')).toEqual({
      changed: true,
      value: 'http://a.com',
    });
    expect(normalizeLinkInput('mailto:a@b.com', '')).toEqual({
      changed: true,
      value: 'mailto:a@b.com',
    });
  });
});
