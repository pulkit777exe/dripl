'use client';

import { useCallback, useState } from 'react';

export type SharePermission = 'view' | 'edit';

export interface ShareLinkState {
  url: string | null;
  isLoading: boolean;
  copied: boolean;
  error: string | null;
  generate: (permission: SharePermission) => Promise<void>;
  copy: () => Promise<void>;
  reset: () => void;
}

interface ShareApiResponse {
  token: string;
}

interface ShareApiError {
  error?: string;
}

const PERMISSION_QUERY_KEY: Record<SharePermission, 'v' | 'e'> = {
  view: 'v',
  edit: 'e',
};

/**
 * Generates and manages a shareable deep link for a file at a given
 * permission. The hook is the seam: callers (the share modal) wire
 * UI to its return value, the implementation owns the network call,
 * the URL shape, the clipboard write, and the loading / error
 * states.
 *
 * URL shape (stable contract — the `/share/[fileId]` page reads it):
 *
 *   `${origin}/share/${fileId}?p=<v|e>&t=<token>`
 *
 * The token is a server-issued, permission-scoped string that
 * `/share/[fileId]` will validate before showing the canvas.
 */
export function useShareLink(fileId: string): ShareLinkState {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (permission: SharePermission): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setCopied(false);
      try {
        const response = await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, permission }),
        });
        const data = (await response.json()) as ShareApiResponse & ShareApiError;
        if (!response.ok) {
          setError(data.error ?? 'Could not generate a share link.');
          setUrl(null);
          return;
        }
        const key = PERMISSION_QUERY_KEY[permission];
        const origin =
          typeof window !== 'undefined' && window.location
            ? window.location.origin
            : '';
        setUrl(`${origin}/share/${fileId}?p=${key}&t=${data.token}`);
      } catch {
        setError('Network error while generating a share link.');
        setUrl(null);
      } finally {
        setIsLoading(false);
      }
    },
    [fileId]
  );

  const copy = useCallback(async (): Promise<void> => {
    if (!url) {
      setError('Generate a share link first, then copy it.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }, [url]);

  const reset = useCallback(() => {
    setUrl(null);
    setIsLoading(false);
    setCopied(false);
    setError(null);
  }, []);

  return { url, isLoading, copied, error, generate, copy, reset };
}
