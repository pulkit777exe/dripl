import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { validateTicket } from '../auth';

describe('validateTicket', () => {
  beforeEach(() => {
    vi.stubEnv('HTTP_SERVER_URL', 'http://http-server:3002');
    vi.stubEnv('INTERNAL_SECRET', 'internal-test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts a user principal from the internal validator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ kind: 'user', userId: 'user-1' }),
      })
    );

    await expect(validateTicket('ticket-user')).resolves.toEqual({
      kind: 'user',
      userId: 'user-1',
    });
  });

  it('accepts a scoped public-share principal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          kind: 'share',
          fileId: 'file-1',
          token: 'share-token',
          permission: 'edit',
        }),
      })
    );

    await expect(validateTicket('ticket-share')).resolves.toEqual({
      kind: 'share',
      fileId: 'file-1',
      token: 'share-token',
      permission: 'edit',
    });
  });

  it('rejects malformed or rejected principals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ kind: 'share', fileId: 'file-1', permission: 'admin' }),
      })
    );
    await expect(validateTicket('bad-share')).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(validateTicket('expired')).resolves.toBeNull();
  });
});
