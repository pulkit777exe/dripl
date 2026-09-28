import { afterEach, describe, expect, it, vi } from 'vitest';
import { signToken, verifyToken } from './auth';

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
