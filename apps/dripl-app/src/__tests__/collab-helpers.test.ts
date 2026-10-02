import { describe, expect, it } from 'vitest';
import {
  computeReconnectDelay,
  shouldGiveUpReconnecting,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
} from '@/lib/collab/reconnect';
import { enqueueOfflineMessage, OFFLINE_QUEUE_MAX } from '@/lib/collab/offlineQueue';

describe('computeReconnectDelay', () => {
  it('grows exponentially from the base', () => {
    expect(computeReconnectDelay(0, () => 1)).toBe(RECONNECT_BASE_MS);
    expect(computeReconnectDelay(1, () => 1)).toBe(RECONNECT_BASE_MS * 2);
    expect(computeReconnectDelay(2, () => 1)).toBe(RECONNECT_BASE_MS * 4);
  });

  it('caps at the maximum', () => {
    expect(computeReconnectDelay(99, () => 1)).toBe(RECONNECT_MAX_MS);
  });

  it('applies 0.5x–1.0x jitter', () => {
    expect(computeReconnectDelay(2, () => 0)).toBe(RECONNECT_BASE_MS * 4 * 0.5);
    const mid = computeReconnectDelay(2, () => 0.5);
    expect(mid).toBeGreaterThan(RECONNECT_BASE_MS * 4 * 0.5);
    expect(mid).toBeLessThanOrEqual(RECONNECT_BASE_MS * 4);
  });

  it('clamps negative attempts', () => {
    expect(computeReconnectDelay(-3, () => 1)).toBe(RECONNECT_BASE_MS);
  });
});

describe('shouldGiveUpReconnecting', () => {
  it('gives up at the max attempt count', () => {
    expect(shouldGiveUpReconnecting(MAX_RECONNECT_ATTEMPTS - 1)).toBe(false);
    expect(shouldGiveUpReconnecting(MAX_RECONNECT_ATTEMPTS)).toBe(true);
  });
});

describe('enqueueOfflineMessage', () => {
  it('appends with a timestamp', () => {
    const queue: Array<{ msg: string; timestamp: number }> = [];
    enqueueOfflineMessage(queue, 'a', OFFLINE_QUEUE_MAX, 1234);
    expect(queue).toEqual([{ msg: 'a', timestamp: 1234 }]);
  });

  it('evicts oldest first at capacity', () => {
    const queue = [1, 2].map(n => ({ msg: `m${n}`, timestamp: n }));
    enqueueOfflineMessage(queue, 'm3', 2, 3);
    expect(queue.map(q => q.msg)).toEqual(['m2', 'm3']);
  });
});
