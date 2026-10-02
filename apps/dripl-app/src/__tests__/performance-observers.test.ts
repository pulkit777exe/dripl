import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPerformanceSnapshot, startPerformanceObservers } from '@/utils/performance-observers';

type ObservedInit = { type: string; buffered?: boolean; durationThreshold?: number };

class MockPerformanceObserver {
  static supportedEntryTypes = ['longtask', 'event', 'long-animation-frame'];
  static instances: MockPerformanceObserver[] = [];
  readonly observed: ObservedInit[] = [];
  disconnect = vi.fn();

  constructor(_callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {
    MockPerformanceObserver.instances.push(this);
  }

  observe(init: ObservedInit) {
    this.observed.push(init);
  }
}

describe('performance observers', () => {
  beforeEach(() => {
    MockPerformanceObserver.instances = [];
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collects supported browser entry types in development', () => {
    const cleanup = startPerformanceObservers();
    const windowWithPerf = window as Window & {
      __driplPerformance?: { snapshot: () => unknown; clear: () => void };
    };

    expect(windowWithPerf.__driplPerformance).toBeDefined();
    expect(MockPerformanceObserver.instances).toHaveLength(3);
    expect(MockPerformanceObserver.instances.map(instance => instance.observed[0]?.type)).toEqual([
      'longtask',
      'event',
      'long-animation-frame',
    ]);
    expect(getPerformanceSnapshot().samples).toEqual([]);

    cleanup();
    expect(windowWithPerf.__driplPerformance).toBeUndefined();
  });
});
