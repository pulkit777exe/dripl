import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPerformanceSnapshot, startPerformanceObservers } from '@/utils/performance-observers';

type ObservedInit = { type: string; buffered?: boolean; durationThreshold?: number };

/**
 * `scripts` is not a declared `PerformanceEntry` property: the module reaches it
 * through a cast, because only long-animation-frame entries carry it. Fixtures widen
 * the type the same way rather than being cast at each use.
 */
type PerfEntry = Partial<PerformanceEntry> & { scripts?: Array<Record<string, unknown>> };

/**
 * Captures the observer callback so entries can actually be delivered.
 *
 * The previous mock discarded it, which is why every line from `addSample` onward was
 * unreachable: no test could ever make the observer fire, so the sample collection,
 * the attribution mapping and the ring-buffer trim had no way to be exercised.
 */
const SUPPORTED = ['longtask', 'event', 'long-animation-frame'];

class MockPerformanceObserver {
  static supportedEntryTypes: readonly string[] = SUPPORTED;
  static instances: MockPerformanceObserver[] = [];
  readonly observed: ObservedInit[] = [];
  readonly disconnected: boolean[] = [];
  disconnect = vi.fn(() => {
    this.disconnected.push(true);
  });

  constructor(private readonly callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {
    MockPerformanceObserver.instances.push(this);
  }

  observe(init: ObservedInit) {
    this.observed.push(init);
  }

  /** Deliver entries as the browser would on a callback tick. */
  emit(...entries: PerfEntry[]) {
    this.callback({ getEntries: () => entries as PerformanceEntry[] });
  }
}

function observerFor(type: string): MockPerformanceObserver {
  const found = MockPerformanceObserver.instances.find(instance =>
    instance.observed.some(init => init.type === type)
  );
  if (!found) throw new Error(`no observer registered for "${type}"`);
  return found;
}

function entry(over: PerfEntry = {}): PerfEntry {
  return {
    entryType: 'longtask',
    name: 'canvas:render',
    startTime: 12.5,
    duration: 34,
    ...over,
  };
}

/** jsdom has no measure buffer; the module reads it defensively, so it is stubbed. */
function stubMeasures(measures: PerfEntry[]) {
  const getEntriesByType = vi.fn((type: string) => (type === 'measure' ? measures : []));
  const clearMeasures = vi.fn();
  Object.defineProperty(globalThis, 'performance', {
    value: { ...globalThis.performance, getEntriesByType, clearMeasures },
    configurable: true,
    writable: true,
  });
  return { getEntriesByType, clearMeasures };
}

describe('performance observers', () => {
  /**
   * The module holds `started`, `observers` and `samples` at module scope, so a test
   * that starts the collector must stop it or the next test inherits a started module
   * and silently registers nothing. Tracked here rather than left to each test.
   */
  let cleanup: (() => void) | null = null;
  const start = () => {
    cleanup = startPerformanceObservers();
    return cleanup;
  };

  beforeEach(() => {
    MockPerformanceObserver.instances = [];
    // Restored, not just cleared: two tests narrow `supportedEntryTypes`, and because
    // it is a static, leaving it narrowed made every later test register only `event`
    // and fail with "no observer registered".
    MockPerformanceObserver.supportedEntryTypes = SUPPORTED;
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    stubMeasures([]);
  });

  afterEach(() => {
    // Clear BEFORE stopping: `stop()` deletes `window.__driplPerformance`, so reading
    // the handle afterwards yields undefined and the clear silently never runs --
    // leaving one test's samples to be asserted on by the next.
    const perf = (window as Window & { __driplPerformance?: { clear: () => void } })
      .__driplPerformance;
    perf?.clear();
    cleanup?.();
    cleanup = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('collects supported browser entry types in development', () => {
    const stop = start();
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

    stop();
    cleanup = null;
    expect(windowWithPerf.__driplPerformance).toBeUndefined();
  });

  it('passes buffered and a duration threshold only where one applies', () => {
    start();
    expect(observerFor('event').observed[0]).toEqual({
      type: 'event',
      buffered: true,
      durationThreshold: 16,
    });
    // A threshold on a long-animation-frame observer would drop most frames, so it is
    // deliberately omitted rather than defaulted.
    expect(observerFor('long-animation-frame').observed[0]).toEqual({
      type: 'long-animation-frame',
      buffered: true,
    });
  });

  it('skips an entry type the browser does not advertise', () => {
    MockPerformanceObserver.supportedEntryTypes = ['event'];
    start();
    expect(MockPerformanceObserver.instances).toHaveLength(1);
    expect(MockPerformanceObserver.instances[0]!.observed[0]!.type).toBe('event');
  });

  it('survives a browser that advertises a type it cannot observe', () => {
    // A throwing `observe` must not take the editor down with it.
    MockPerformanceObserver.supportedEntryTypes = ['event'];
    const boom = vi.spyOn(MockPerformanceObserver.prototype, 'observe').mockImplementation(() => {
      throw new Error('not observable here');
    });
    expect(() => startPerformanceObservers()).not.toThrow();
    expect(boom).toHaveBeenCalled();
  });

  it('returns a stop function instead of starting twice', () => {
    start();
    const before = MockPerformanceObserver.instances.length;

    // A second start must not register a duplicate set of observers, which would
    // double-count every sample.
    const second = startPerformanceObservers();
    expect(MockPerformanceObserver.instances.length).toBe(before);
    second();
    cleanup = null;
  });

  it('records an entry the observer delivers', () => {
    start();
    observerFor('longtask').emit(entry({ name: 'canvas:draw', duration: 41 }));

    const snapshot = getPerformanceSnapshot();
    expect(snapshot.samples).toHaveLength(1);
    expect(snapshot.samples[0]).toMatchObject({
      type: 'longtask',
      name: 'canvas:draw',
      startTime: 12.5,
      duration: 41,
    });
  });

  it('maps per-script attribution from a long-animation-frame entry', () => {
    start();
    observerFor('long-animation-frame').emit(
      entry({
        entryType: 'long-animation-frame',
        name: 'canvas:frame',
        scripts: [
          { name: 'render', sourceURL: 'app.js', sourceFunctionName: 'drawScene', duration: 22 },
        ],
      })
    );

    // This is the whole point of the collector: turning "a frame was slow" into
    // "this function was slow".
    expect(getPerformanceSnapshot().samples[0]!.attribution).toEqual([
      { name: 'render', sourceURL: 'app.js', sourceFunctionName: 'drawScene', duration: 22 },
    ]);
  });

  it('defaults every missing attribution field rather than emitting undefined', () => {
    start();
    observerFor('long-animation-frame').emit(
      entry({ entryType: 'long-animation-frame', scripts: [{}] })
    );

    expect(getPerformanceSnapshot().samples[0]!.attribution).toEqual([
      { name: '', sourceURL: '', sourceFunctionName: '', duration: 0 },
    ]);
  });

  it('omits attribution for an entry type that carries none', () => {
    start();
    observerFor('longtask').emit(entry({ scripts: undefined }));
    expect(getPerformanceSnapshot().samples[0]).not.toHaveProperty('attribution');
  });

  it('omits attribution when scripts is present but not a list', () => {
    start();
    // A malformed entry from a browser that does not match the spec. The `isArray`
    // guard is the only thing between this and `.map` on a non-array, so the test has
    // to pass a non-array: with `scripts: undefined` a loosened `!scripts` guard would
    // behave identically and the branch would be untested.
    observerFor('long-animation-frame').emit(
      entry({
        entryType: 'long-animation-frame',
        scripts: { name: 'not-a-list' } as unknown as Array<Record<string, unknown>>,
      })
    );
    expect(getPerformanceSnapshot().samples[0]).not.toHaveProperty('attribution');
  });

  it('omits attribution for an empty script list', () => {
    start();
    observerFor('long-animation-frame').emit(
      entry({ entryType: 'long-animation-frame', scripts: [] })
    );
    expect(getPerformanceSnapshot().samples[0]).not.toHaveProperty('attribution');
  });

  it('keeps only the most recent samples', () => {
    start();
    const observer = observerFor('longtask');
    // One over the cap, emitted as a single batch: the oldest must be dropped.
    for (let i = 0; i < 201; i += 1) {
      observer.emit(entry({ name: `canvas:${i}`, duration: i }));
    }

    const samples = getPerformanceSnapshot().samples;
    expect(samples).toHaveLength(200);
    // The oldest went, so the first retained sample is #1 and the newest is #200.
    expect(samples[0]!.name).toBe('canvas:1');
    expect(samples[199]!.name).toBe('canvas:200');
  });

  it('reports canvas-prefixed measures and hides other measures', () => {
    stubMeasures([
      entry({ entryType: 'measure', name: 'canvas:render', duration: 5 }),
      entry({ entryType: 'measure', name: 'vendor:thing', duration: 9 }),
    ]);
    start();

    const measures = getPerformanceSnapshot().measures;
    expect(measures).toHaveLength(1);
    expect(measures[0]!.name).toBe('canvas:render');
  });

  it('returns a copy of the samples, so a caller cannot mutate module state', () => {
    start();
    observerFor('longtask').emit(entry({ name: 'canvas:a' }));

    const first = getPerformanceSnapshot();
    // A complete sample literal, not a partial entry: `samples` is typed
    // `PerformanceSample[]` with required fields, so a partial fixture needs a cast and
    // the cast would hide exactly the mismatch this test is about.
    first.samples.push({ type: 'measure', name: 'injected', startTime: 0, duration: 0 });
    expect(getPerformanceSnapshot().samples).toHaveLength(1);
  });

  it('clears the samples and the measure buffer', () => {
    const { clearMeasures } = stubMeasures([entry({ entryType: 'measure', name: 'canvas:x' })]);
    start();
    observerFor('longtask').emit(entry());
    expect(getPerformanceSnapshot().samples).toHaveLength(1);

    const windowWithPerf = window as Window & { __driplPerformance?: { clear: () => void } };
    windowWithPerf.__driplPerformance!.clear();

    expect(getPerformanceSnapshot().samples).toEqual([]);
    expect(clearMeasures).toHaveBeenCalled();
  });

  it('disconnects every observer when stopped', () => {
    const cleanup = start();
    const instances = [...MockPerformanceObserver.instances];
    cleanup();
    // A retained observer would keep buffering entries for a torn-down editor.
    expect(instances.every(instance => instance.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('reports no measures when the performance API is absent', () => {
    // SSR and hardened browser contexts. `currentMeasures` guards on the global
    // existing at all, which is a different check from the empty-buffer case.
    vi.stubGlobal('performance', undefined);
    expect(getPerformanceSnapshot().measures).toEqual([]);
  });

  it('still clears when the performance API is absent', () => {
    // `clear` guards the same way; without it a missing API would throw during teardown
    // in exactly the environment that cannot afford it.
    vi.stubGlobal('performance', undefined);
    const perf = (window as Window & { __driplPerformance?: { clear: () => void } })
      .__driplPerformance;
    expect(() => perf?.clear()).not.toThrow();
  });

  it('does nothing when PerformanceObserver is unavailable', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const cleanup = start();
    // SSR and older browsers land here; the editor must not depend on the collector.
    expect(() => cleanup()).not.toThrow();
    expect(getPerformanceSnapshot().samples).toEqual([]);
  });
});
