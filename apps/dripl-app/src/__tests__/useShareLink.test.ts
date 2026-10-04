import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShareLink } from '@/hooks/useShareLink';
import { apiClient } from '@/lib/api';

const FILE_ID = 'file-abc-123';
const ORIGIN = 'https://dripl.test';

function shareUrl(token: string): string {
  return `${ORIGIN}/share/${token}#key=server-issued-key`;
}

describe('useShareLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with no URL and not loading', () => {
    const { result } = renderHook(() => useShareLink(FILE_ID));
    expect(result.current.url).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('uses the durable owner-scoped URL returned by the API', async () => {
    const shareFile = vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
      token: 'tok_view_xyz',
      permission: 'view',
      expiresAt: null,
      shareUrl: shareUrl('tok_view_xyz'),
    });

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('view');
    });

    expect(shareFile).toHaveBeenCalledWith(FILE_ID, { permission: 'view' });
    expect(result.current.url).toBe(shareUrl('tok_view_xyz'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('passes edit permission to the owner-scoped API', async () => {
    const shareFile = vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
      token: 'tok_edit_abc',
      permission: 'edit',
      expiresAt: null,
      shareUrl: shareUrl('tok_edit_abc'),
    });

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('edit');
    });

    expect(shareFile).toHaveBeenCalledWith(FILE_ID, { permission: 'edit' });
    expect(result.current.url).toBe(shareUrl('tok_edit_abc'));
  });

  it('surfaces an API error', async () => {
    vi.spyOn(apiClient, 'shareFile').mockRejectedValue(new Error('Not signed in'));

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('view');
    });

    expect(result.current.url).toBeNull();
    expect(result.current.error).toBe('Not signed in');
  });

  it('flags isLoading while the request is in flight', async () => {
    let resolveShare: (value: {
      token: string;
      permission: 'view' | 'edit';
      expiresAt: string | null;
      shareUrl: string;
    }) => void = () => {};
    vi.spyOn(apiClient, 'shareFile').mockReturnValue(
      new Promise(resolve => {
        resolveShare = resolve;
      })
    );

    const { result } = renderHook(() => useShareLink(FILE_ID));
    act(() => {
      void result.current.generate('view');
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveShare({
        token: 'tok',
        permission: 'view',
        expiresAt: null,
        shareUrl: shareUrl('tok'),
      });
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('copy() places the URL on the clipboard and reports copied=true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
      token: 'tok',
      permission: 'view',
      expiresAt: null,
      shareUrl: shareUrl('tok'),
    });

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

describe('useShareLink failure handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports an error when the API returns a response with no link', async () => {
    // Regression: `generate` stores the payload unconditionally, so a 200
    // response missing `shareUrl` publishes a Copy button that copies `null`.
    vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
      token: 'tok',
      permission: 'view',
      expiresAt: null,
      shareUrl: undefined as unknown as string,
    });

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('view');
    });

    expect(result.current.url).toBeNull();
    expect(result.current.error).toMatch(/did not return a link/i);
    expect(result.current.isLoading).toBe(false);
  });

  it('falls back to a generic message when the rejection is not an Error', async () => {
    // Regression: the catch assumes `error.message` exists, so a thrown string
    // or a failed `fetch` payload surfaces "undefined" to the user.
    vi.spyOn(apiClient, 'shareFile').mockRejectedValue('boom');

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('view');
    });

    expect(result.current.error).toMatch(/network error/i);
    expect(result.current.url).toBeNull();
  });

  it('does not claim the link was copied when the clipboard write fails', async () => {
    // Regression: `copied` is the only signal the Share button uses to show
    // "Copied!", so a rejected clipboard write (insecure context, denied
    // permission) must not leave the UI lying about the clipboard.
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
      token: 'tok',
      permission: 'view',
      expiresAt: null,
      shareUrl: shareUrl('tok'),
    });

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('view');
    });
    await act(async () => {
      await result.current.copy();
    });

    expect(writeText).toHaveBeenCalledWith(shareUrl('tok'));
    expect(result.current.copied).toBe(false);
    expect(result.current.error).toMatch(/clipboard/i);
    // A later successful generate must clear the stale failure message.
    await act(async () => {
      await result.current.generate('edit');
    });
    expect(result.current.error).toBeNull();
  });

  it('reset() drops the url, the copied flag and the error together', async () => {
    // Regression: reset() is how the Share dialog revokes/closes its state.
    // Leaving any one field behind re-opens the dialog showing "Copied!" for
    // a link that is no longer on screen, or keeps an error from a previous
    // attempt visible.
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
      token: 'tok',
      permission: 'view',
      expiresAt: null,
      shareUrl: shareUrl('tok'),
    });

    const { result } = renderHook(() => useShareLink(FILE_ID));
    await act(async () => {
      await result.current.generate('view');
    });
    await act(async () => {
      await result.current.copy();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current).toMatchObject({
      url: null,
      copied: false,
      error: null,
      isLoading: false,
    });
  });
});
