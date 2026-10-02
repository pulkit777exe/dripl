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
