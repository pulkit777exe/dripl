/**
 * Reconnect backoff — pure helper extracted from `useCollaboration`.
 *
 * Exponential base (`1000 * 2^attempt`, capped at 30s) with ±jitter
 * (`0.5×–1.0×`) so a fleet of dropped clients does not thundering-herd the
 * ticket endpoint and gateway on recovery. `random` is injectable for tests.
 */

export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export function computeReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** safeAttempt);
  return base * (0.5 + random() * 0.5);
}

export function shouldGiveUpReconnecting(attempt: number): boolean {
  return attempt >= MAX_RECONNECT_ATTEMPTS;
}
