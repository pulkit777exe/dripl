import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractBearerToken, signToken, verifyToken } from './auth';

describe('auth token verification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifies a token signed by the configured secret', () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = signToken('user-1');

    expect(verifyToken(token)).toEqual({ userId: 'user-1' });
  });

  it('rejects a token with an unsigned or tampered payload', () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = signToken('user-1');
    const [header, payload, signature] = token.split('.');
    const forged = `${header}.${(payload ?? '').slice(0, -1)}x.${signature}`;

    expect(verifyToken(forged)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    const token = signToken('user-1');
    vi.stubEnv('JWT_SECRET', 'b'.repeat(32));

    expect(verifyToken(token)).toBeNull();
  });
});

describe('extractBearerToken', () => {
  it('extracts the token from a canonical Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts the scheme in any case per RFC 7235', () => {
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('BEARER abc')).toBe('abc');
    expect(extractBearerToken('BeArEr abc')).toBe('abc');
  });

  it('tolerates multi-space separators (1*SP) and token68 padding', () => {
    expect(extractBearerToken('Bearer  abc=')).toBe('abc=');
  });

  it('rejects non-Bearer schemes, bare tokens, and empty values', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken('bare-token-without-scheme')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});
