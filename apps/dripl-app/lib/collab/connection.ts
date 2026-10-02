'use client';

import { apiClient } from '@/lib/api';

/** Allowlist a stored cursor color; fall back when it is not a hex color. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/** Exchange an optional public share token for a short-lived WS ticket. */
export async function getWsTicket(
  shareToken?: string | null,
  signal?: AbortSignal
): Promise<string> {
  return shareToken
    ? apiClient.getShareWsTicket(shareToken, signal)
    : apiClient.getWsTicket(signal);
}
