import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `utils/api/images.ts` — the one place the app talks to the blob store
 * directly.
 *
 * The upload is a raw binary POST rather than a JSON request, so it cannot go
 * through `lib/api.ts`'s `request` helper and therefore duplicates — and can
 * drift from — the CSRF and error-mapping contract. These tests pin both sides
 * of that contract against the server's actual responses.
 *
 * `utils/tools/image.ts` (the only caller) is tested in
 * `tools-image.test.ts`, which mocks this module; keeping the two files apart
 * is what lets this one exercise the real thing.
 */

/** Minimal Response stand-in: the client only reads status/json/ok/blob/clone. */
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (text === '') throw new SyntaxError('Unexpected end of JSON input');
      return JSON.parse(text) as unknown;
    },
    blob: async () => new Blob([text]),
    clone: () => jsonResponse(body, init),
  } as unknown as Response;
}

const PNG = () => new File(['bytes'], 'a.png', { type: 'image/png' });

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * Load `utils/api/images` fresh with a given `NEXT_PUBLIC_API_URL`.
 *
 * The base URL is computed once at module scope, so a test that wants a
 * different one has to re-import rather than just reassign a variable.
 */
async function loadImagesModule(apiUrl?: string) {
  if (apiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = apiUrl;
  return import('@/utils/api/images');
}

/** Stub `fetch` and the CSRF token the upload depends on. */
async function stubServer(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  const { apiClient } = await import('@/lib/api');
  vi.spyOn(apiClient, 'getCsrfToken').mockResolvedValue('csrf-token');
  return fetchMock;
}

describe('uploadImage: URL construction', () => {
  it('defaults to http://localhost:3002/api/images', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).resolves.toEqual({ id: 'a.png', url: 'u', size: 1 });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3002/api/images');
  });

  it('does not double the /api segment when the env var already has it', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule('https://api.example.com/api');
    await uploadImage(PNG());
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/images');
  });

  it('appends /api when the env var omits it', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule('https://api.example.com');
    await uploadImage(PNG());
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/images');
  });

  it('does not produce a double slash when the env var has a trailing slash', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule('https://api.example.com/');
    await uploadImage(PNG());
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/images');
  });

  it('handles a trailing slash before /api too', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule('https://api.example.com/api/');
    await uploadImage(PNG());
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/images');
  });

  /**
   * The same env var, read two different ways by two modules in one app.
   *
   * `utils/api/images.ts` normalises a bare origin to `<origin>/api`; `lib/api.ts`
   * takes it verbatim. So an operator who sets the variable without the suffix
   * gets working image URLs and a 404 for everything else. The documented value
   * includes `/api` (`.env.example`, `docker-compose.yml`), so this is a
   * divergence rather than a live failure — but it is a real disagreement, and
   * `apps/http-server/src/routes/images.ts:65` normalises the same way
   * `images.ts` does, which makes `lib/api.ts` the odd one out of three.
   */
  it('DIVERGES from lib/api.ts on a bare origin: /api here, nothing there', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    vi.resetModules();
    const images = await import('@/utils/api/images');
    const { apiClient } = await import('@/lib/api');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: null }));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.me();

    expect(images.getImageUrl('a.png')).toBe('https://api.example.com/api/images/a.png');
    // lib/api.ts resolves to the bare origin, so this 404s in production.
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/auth/me');
  });
});

describe('uploadImage: request shape', () => {
  it('POSTs the raw File as the body, not a multipart envelope', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule();
    const file = PNG();

    await uploadImage(file);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
    expect(init.credentials).toBe('include');
    // The server matches on the exact image mime and concatenates the raw
    // request bytes, so the content type is the file's own type.
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['x-csrf-token']).toBe('csrf-token');
  });

  it('sends the file mime through verbatim, including a parameterised one', async () => {
    const fetchMock = await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { uploadImage } = await loadImagesModule();
    await uploadImage(new File(['x'], 'a.png', { type: 'image/svg+xml' }));
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/svg+xml');
  });

  it('fetches the CSRF token through the shared api client, so both agree on it', async () => {
    await stubServer(jsonResponse({ id: 'a.png', url: 'u', size: 1 }));
    const { apiClient } = await import('@/lib/api');
    const getCsrfToken = vi.spyOn(apiClient, 'getCsrfToken');
    vi.mocked(getCsrfToken).mockResolvedValue('shared-token');
    const { uploadImage } = await loadImagesModule();
    await uploadImage(PNG());
    expect(getCsrfToken).toHaveBeenCalledTimes(1);
    expect(getCsrfToken).toHaveBeenCalledWith();
  });

  it('propagates a CSRF failure rather than uploading without a token', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { apiClient } = await import('@/lib/api');
    vi.spyOn(apiClient, 'getCsrfToken').mockRejectedValue(
      new Error('Failed to initialize security token')
    );
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).rejects.toThrow('Failed to initialize security token');
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('returns the parsed body on success, including the 201 the server sends', async () => {
    const payload = { id: 'f.png', url: 'http://x/f.png', size: 4096 };
    await stubServer(jsonResponse(payload, { status: 201 }));
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).resolves.toEqual(payload);
  });
});

describe('uploadImage: error mapping', () => {
  /**
   * `sendError(res, status, error, message)` on the server sets `error` to a
   * machine CODE and `message` to the human sentence (`ApiError` in
   * `@dripl/common` is `{ error, message, statusCode }`). `lib/api.ts`'s
   * `parseError` reads `message ?? error`, so `images.ts` must too — otherwise
   * every user and every log line sees "PAYLOAD_TOO_LARGE" where the server
   * meant "Image too large. Maximum size is 10MB.".
   *
   * This is the one test here that FAILED against the code as written; see the
   * fix in `utils/api/images.ts`.
   */
  it('surfaces the human message, not the machine code', async () => {
    await stubServer(
      jsonResponse(
        {
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Image too large. Maximum size is 10MB.',
          statusCode: 413,
        },
        { status: 413 }
      )
    );
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).rejects.toThrow('Image too large. Maximum size is 10MB.');
  });

  it('agrees with lib/api.ts on which field is the message', async () => {
    await stubServer(
      jsonResponse(
        { error: 'INVALID_CONTENT_TYPE', message: 'Allowed: png, jpeg, gif, webp' },
        { status: 400 }
      )
    );
    const { uploadImage } = await loadImagesModule();
    // lib/api.ts's own error mapping is covered in lib-api.test.ts; here the
    // point is that the SAME body resolves to the same human sentence in both
    // clients, so a caller cannot tell which endpoint answered.
    const imagesError = await uploadImage(PNG()).then(
      () => {
        throw new Error('expected a rejection');
      },
      (e: unknown) => e as Error
    );
    expect(imagesError.message).toBe('Allowed: png, jpeg, gif, webp');
  });

  it('falls back to the machine code when the server sends no message', async () => {
    await stubServer(jsonResponse({ error: 'NOT_FOUND' }, { status: 404 }));
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).rejects.toThrow('NOT_FOUND');
  });

  it('falls back to the status code when the body carries neither field', async () => {
    await stubServer(jsonResponse({}, { status: 500 }));
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).rejects.toThrow('Upload failed: 500');
  });

  it('falls back to the status code when the error body is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response)
    );
    const { apiClient } = await import('@/lib/api');
    vi.spyOn(apiClient, 'getCsrfToken').mockResolvedValue('t');
    const { uploadImage } = await loadImagesModule();
    await expect(uploadImage(PNG())).rejects.toThrow('Upload failed: 502');
  });

  it('never rejects with a raw Response', async () => {
    const response = jsonResponse({ error: 'X', message: 'boom' }, { status: 400 });
    await stubServer(response);
    const { uploadImage } = await loadImagesModule();
    const error = await uploadImage(PNG()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(response);
    expect((error as { json?: unknown }).json).toBeUndefined();
  });
});

describe('getImageUrl', () => {
  it('builds the download URL from the API base and the id', async () => {
    const { getImageUrl } = await loadImagesModule();
    expect(getImageUrl('abc.png')).toBe('http://localhost:3002/api/images/abc.png');
  });

  it('percent-encodes the id, so a traversal cannot escape the path', async () => {
    const { getImageUrl } = await loadImagesModule();
    expect(getImageUrl('../../secret')).toBe('http://localhost:3002/api/images/..%2F..%2Fsecret');
    expect(getImageUrl('a b.png')).toBe('http://localhost:3002/api/images/a%20b.png');
  });

  it('encodes a query separator so it cannot add a parameter', async () => {
    const { getImageUrl } = await loadImagesModule();
    expect(getImageUrl('a.png?x=1')).toBe('http://localhost:3002/api/images/a.png%3Fx%3D1');
  });
});

describe('fetchImageBlob', () => {
  it('GETs the image with credentials and returns the blob', async () => {
    const blob = new Blob(['bytes'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchImageBlob } = await loadImagesModule();
    await expect(fetchImageBlob('abc.png')).resolves.toBe(blob);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3002/api/images/abc.png');
    expect(fetchMock.mock.calls[0]![1]).toEqual({ credentials: 'include' });
  });

  it('reports the status code when the download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, blob: async () => new Blob() })
    );
    const { fetchImageBlob } = await loadImagesModule();
    await expect(fetchImageBlob('gone.png')).rejects.toThrow('Failed to fetch image: 404');
  });

  it('never resolves with a raw Response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, blob: async () => new Blob() })
    );
    const { fetchImageBlob } = await loadImagesModule();
    const error = await fetchImageBlob('x.png').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { blob?: unknown }).blob).toBeUndefined();
  });
});
