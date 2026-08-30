import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShareLink } from '@/hooks/useShareLink';

const FILE_ID = 'file-abc-123';
const ORIGIN = 'https://dripl.test';

describe('useShareLink', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { ...window, location: { ...window.location, origin: ORIGIN } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with no URL and not loading', () => {
    const { result } = renderHook(() => useShareLink(FILE_ID));
    expect(result.current.url).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('generates a view-only deep link with `?p=v` for the default permission', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tok_view_xyz' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useShareLink(FILE_ID));

    await act(async () => {
      await result.current.generate('view');
    });

    expect(result.current.url).toBe(`${ORIGIN}/share/${FILE_ID}?p=v&t=tok_view_xyz`);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('generates an edit deep link with `?p=e` when permission is "edit"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tok_edit_abc' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useShareLink(FILE_ID));

    await act(async () => {
      await result.current.generate('edit');
    });

    expect(result.current.url).toBe(`${ORIGIN}/share/${FILE_ID}?p=e&t=tok_edit_abc`);
  });

  it('POSTs to /api/share with the file id and the requested permission', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tok_123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useShareLink(FILE_ID));

    await act(async () => {
      await result.current.generate('edit');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/share',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: FILE_ID, permission: 'edit' }),
      })
    );
  });

  it('surfaces an error message from a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Not signed in' }),
      })
    );

    const { result } = renderHook(() => useShareLink(FILE_ID));

    await act(async () => {
      await result.current.generate('view');
    });

    expect(result.current.url).toBeNull();
    expect(result.current.error).toBe('Not signed in');
  });

  it('surfaces a generic error when the response has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const { result } = renderHook(() => useShareLink(FILE_ID));

    await act(async () => {
      await result.current.generate('view');
    });

    expect(result.current.error).toMatch(/share/i);
  });

  it('flags isLoading while the request is in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }))
    );

    const { result } = renderHook(() => useShareLink(FILE_ID));

    // Kick off generate() but don't await it yet — the promise stays
    // pending on the in-flight fetch.
    act(() => {
      void result.current.generate('view');
    });

    // The hook sets isLoading=true synchronously before the fetch
    // await, so the state is observable without polling.
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ token: 'tok' }) });
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('copy() places the URL on the clipboard and reports copied=true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok' }) }));

    const { result } = renderHook(() => useShareLink(FILE_ID));

    await act(async () => {
      await result.current.generate('view');
    });
    await act(async () => {
      await result.current.copy();
    });

    expect(writeText).toHaveBeenCalledWith(result.current.url);
    expect(result.current.copied).toBe(true);
  });

  it('copy() without a generated URL is a no-op and reports a friendly error', async () => {
    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.copy();
    });
    expect(result.current.copied).toBe(false);
    expect(result.current.error).toMatch(/generate.*first|copy.*url/i);
  });
});
