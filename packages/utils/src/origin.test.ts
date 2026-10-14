import { describe, expect, it } from 'vitest';
import { normalizeOrigin, parseAllowedOrigins } from './origin';

describe('normalizeOrigin', () => {
  it('returns the origin for http and https URLs', () => {
    expect(normalizeOrigin('https://example.com/app?x=1')).toBe('https://example.com');
    expect(normalizeOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('returns null for falsy input', () => {
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigin('http://')).toBeNull();
  });

  it('rejects non-HTTP(S) schemes rather than echoing them', () => {
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('data:text/plain,hi')).toBeNull();
    expect(normalizeOrigin('ftp://example.com')).toBeNull();
  });

  it('strips paths, queries and credentials down to the origin', () => {
    expect(normalizeOrigin('https://user:pass@example.com:8443/a/b?c=d')).toBe(
      'https://example.com:8443'
    );
  });
});

describe('parseAllowedOrigins', () => {
  it('splits comma-separated values and trims entries', () => {
    expect(parseAllowedOrigins(['https://a.example, https://b.example '])).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('drops entries that do not normalize instead of widening the allowlist', () => {
    expect(parseAllowedOrigins(['https://good.example, bogus, javascript:alert(1)'])).toEqual([
      'https://good.example',
    ]);
  });

  it('ignores missing values', () => {
    expect(parseAllowedOrigins([undefined, undefined])).toEqual([]);
    expect(parseAllowedOrigins(['http://localhost:3000'])).toEqual(['http://localhost:3000']);
  });
});
