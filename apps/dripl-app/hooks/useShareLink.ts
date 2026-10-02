'use client';

import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api';

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

/**
 * Generates and manages a shareable deep link for a file at a given
 * permission. The owner-scoped HTTP API returns the durable URL; keeping
 * that URL intact preserves its server-issued token and encryption-key
 * fragment.
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
        const data = await apiClient.shareFile(fileId, { permission });
        if (!data.shareUrl) {
          setError('The share service did not return a link.');
          setUrl(null);
          return;
        }
        setUrl(data.shareUrl);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Network error while generating a share link.'
        );
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
