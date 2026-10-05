import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PerfModule = typeof import('../../utils/performance');

/**
 * `utils/performance.ts` is three timing utilities plus a module-level kill
 * switch. The kill switch is the part with real risk: `perfEnabled` is computed
 * once at module load, so a change to how it is computed (or to `NODE_ENV`)
 * silently stops every measurement -- with no error anywhere. These tests load
 * the module fresh under each condition rather than mocking the flag.
 *
 * Fake timers are scoped to `debounce`/`throttle`. Vitest's fake clock replaces
 * `performance` with its own shim, and that shim does not reproduce the real
 * `performance.measure` behaviour for missing marks -- so the `perfMeasure`
 * tests deliberately run on real timers and real performance marks.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  performance.clearMarks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * Import a fresh instance of the module.
 *
 * `vi.resetModules()` is what makes this meaningful: `perfEnabled` is a `const`
 * evaluated at load time, so without the reset the second and third imports
 * would reuse the first one's value and the production/SSR cases would silently
 * be testing the development path.
 */
async function loadPerformance(options: { production?: boolean; noWindow?: boolean } = {}) {
  vi.resetModules();
  if (options.production) {
    vi.stubEnv('NODE_ENV', 'production');
  }
  if (options.noWindow) {
    vi.stubGlobal('window', undefined);
  }
  const mod: PerfModule = await import('../../utils/performance');
  return mod;
}

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Regression: `debounce` is what keeps a pointer drag from writing a scene
  // snapshot on every frame. Invoking the wrapped function eagerly would defeat
  // the whole utility.
  it('waits for the full delay before invoking the wrapped function', async () => {
    const { debounce } = await loadPerformance();
    const spy = vi.fn<(value: string) => void>();
    const debounced = debounce(spy, 100);

    debounced('a');
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('a');
  });

  // Regression: without the `if (timeout) clearTimeout(timeout)` reset, every
  // call in a burst would fire its own timer and a drag would write N snapshots
  // instead of one.
  it('collapses a burst of calls into a single invocation carrying the last arguments', async () => {
    const { debounce } = await loadPerformance();
    const spy = vi.fn<(n: number) => void>();
    const debounced = debounce(spy, 100);

    debounced(1);
    vi.advanceTimersByTime(60);
    debounced(2);
    vi.advanceTimersByTime(60);
    debounced(3);
    // The first call's deadline was 100ms ago; if it had not been reset the spy
    // would already have fired.
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
  });

  // Regression: the debounced wrapper must stay usable after it has fired. A
  // variant that latches a permanently-set handle, or early-returns when one is
  // present, would work exactly once.
  it('fires again on a later call after the previous one has run', async () => {
    const { debounce } = await loadPerformance();
    const spy = vi.fn<(n: number) => void>();
    const debounced = debounce(spy, 50);

    debounced(1);
    vi.advanceTimersByTime(50);
    expect(spy).toHaveBeenCalledTimes(1);

    debounced(2);
    vi.advanceTimersByTime(50);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls).toEqual([[1], [2]]);
  });

  // Regression: `later` is a closure over its own `args`, so the arguments of the
  // *winning* call are what gets passed on. Capturing args from the first call
  // would save stale pointer coordinates.
  it('forwards every argument of the surviving call', async () => {
    const { debounce } = await loadPerformance();
    const spy = vi.fn<(x: number, y: number, label: string) => void>();
    const debounced = debounce(spy, 10);

    debounced(9, 9, 'stale');
    vi.advanceTimersByTime(5);
    debounced(1, 2, 'fresh');
    vi.advanceTimersByTime(10);

    expect(spy).toHaveBeenCalledWith(1, 2, 'fresh');
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Regression: `throttle` is leading-edge, not trailing. A trailing-edge
  // implementation drops the first event of an interaction, so the first click
  // of a gesture would do nothing.
  it('invokes the wrapped function immediately on the leading edge', async () => {
    const { throttle } = await loadPerformance();
    const spy = vi.fn<(value: string) => void>();
    const throttled = throttle(spy, 100);

    throttled('first');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('first');
  });

  // Regression: the `setTimeout(() => (inThrottle = false), limit)` rearm is the
  // only thing that lets the throttle recover. Without it the throttle latches
  // off after the first event, forever.
  it('drops calls inside the window and admits the next one after it elapses', async () => {
    const { throttle } = await loadPerformance();
    const spy = vi.fn<(n: number) => void>();
    const throttled = throttle(spy, 100);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(spy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    throttled(4);
    expect(spy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    throttled(5);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls).toEqual([[1], [5]]);
  });

  // Regression: the rearm must clear only the throttle flag, not re-invoke the
  // wrapped function. A `setTimeout(func, limit)` would double-fire every event.
  it('does not re-invoke the wrapped function when the throttle re-arms', async () => {
    const { throttle } = await loadPerformance();
    const spy = vi.fn<(value: string) => void>();
    const throttled = throttle(spy, 20);

    throttled('x');
    vi.advanceTimersByTime(500);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('perfMark / perfMeasure with instrumentation enabled', () => {
  // Regression: `perfMark` is a no-op wrapper; if the name were dropped on the
  // way to `performance.mark` every measure would fail to find its endpoints.
  it('forwards the name to performance.mark', async () => {
    const { perfMark } = await loadPerformance();
    const mark = vi.spyOn(performance, 'mark');

    perfMark('draw:start');

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith('draw:start');
  });

  // Regression: `perfMeasure` returns `entry.duration`, not the entry itself and
  // not a constant. Pinning the exact value proves the return value is read off
  // the measure entry rather than defaulted.
  it('returns the duration of the measure entry it created', async () => {
    const { perfMeasure } = await loadPerformance();
    vi.spyOn(performance, 'measure').mockReturnValue({ duration: 12.5 } as PerformanceMeasure);
    const clearMarks = vi.spyOn(performance, 'clearMarks');

    const duration = perfMeasure('draw', 'draw:start', 'draw:end');

    expect(duration).toBe(12.5);
    expect(performance.measure).toHaveBeenCalledWith('draw', 'draw:start', 'draw:end');
    expect(clearMarks).toHaveBeenCalledWith('draw:start');
    expect(clearMarks).toHaveBeenCalledWith('draw:end');
  });

  // Regression: the endpoint marks are cleared after every measure. Leaving them
  // in the buffer grows it without bound on a render loop that marks every frame.
  it('clears both endpoint marks so the buffer does not grow per frame', async () => {
    const { perfMark, perfMeasure } = await loadPerformance();
    const clearMarks = vi.spyOn(performance, 'clearMarks');

    perfMark('draw:start');
    perfMark('draw:end');
    perfMeasure('draw', 'draw:start', 'draw:end');

    expect(clearMarks.mock.calls).toEqual([['draw:start'], ['draw:end']]);
    // And the marks really are gone from the buffer, not merely asked to be.
    expect(() => performance.measure('draw', 'draw:start', 'draw:end')).toThrow();
  });

  // Regression: a measure whose endpoints were never marked throws. That is the
  // reason for the try/catch -- an unguarded `performance.measure` would take
  // down the render path that called `useRenderTiming`.
  it('returns 0 when an endpoint mark was never set', async () => {
    const { perfMeasure } = await loadPerformance();

    expect(() => perfMeasure('m', 'never-marked-start', 'never-marked-end')).not.toThrow();
    expect(perfMeasure('m', 'never-marked-start', 'never-marked-end')).toBe(0);
  });

  // Regression: the catch must not leave a non-zero placeholder behind -- callers
  // use the return value as a duration.
  it('returns a finite non-negative duration on the success path', async () => {
    const { perfMark, perfMeasure } = await loadPerformance();

    perfMark('t:start');
    perfMark('t:end');
    const duration = perfMeasure('t', 't:start', 't:end');

    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

describe('useRenderTiming', () => {
  // Regression: the hook's contract is a start mark now and an end mark plus a
  // measure when the returned cleanup runs. The measure name and the two mark
  // names are the whole linkage between the two ends.
  it('marks the start immediately and the end plus a measure when the cleanup runs', async () => {
    const { useRenderTiming } = await loadPerformance();
    const mark = vi.spyOn(performance, 'mark');
    const measure = vi.spyOn(performance, 'measure');

    const done = useRenderTiming('CanvasBoard');
    expect(typeof done).toBe('function');

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith('CanvasBoard:render:start');
    expect(measure).not.toHaveBeenCalled();

    done?.();

    expect(mark).toHaveBeenCalledWith('CanvasBoard:render:end');
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith(
      'CanvasBoard:render',
      'CanvasBoard:render:start',
      'CanvasBoard:render:end'
    );
  });

  // Regression: the component name is interpolated into every mark. A hard-coded
  // name would make every component's measure collide on the same endpoints, so
  // the duration returned would be meaningless while still looking plausible.
  it('namespaces the marks by component name', async () => {
    const { useRenderTiming } = await loadPerformance();
    const mark = vi.spyOn(performance, 'mark');

    useRenderTiming('Alpha')?.();
    useRenderTiming('Beta')?.();

    expect(mark.mock.calls.map(call => call[0])).toEqual([
      'Alpha:render:start',
      'Alpha:render:end',
      'Beta:render:start',
      'Beta:render:end',
    ]);
  });

  // Regression: the hook runs during render, so the start mark must be emitted
  // synchronously rather than in an effect. Moving it into an effect would make
  // the first frame's start mark land after the end mark.
  it('emits the start mark during the hook call itself', async () => {
    const { useRenderTiming } = await loadPerformance();
    const mark = vi.spyOn(performance, 'mark');

    const before = mark.mock.calls.length;
    useRenderTiming('Sync');

    expect(mark.mock.calls.length).toBe(before + 1);
  });
});

describe('performance instrumentation in a production build', () => {
  // Regression: `perfEnabled` is a module-load-time constant. Dropping the
  // `NODE_ENV !== 'production'` term would make every production render
  // accumulate measures in the user timing buffer with nothing reading them.
  it('neither marks nor measures when NODE_ENV is production', async () => {
    const { perfMark } = await loadPerformance({ production: true });
    const mark = vi.spyOn(performance, 'mark');
    const measure = vi.spyOn(performance, 'measure').mockImplementation((): PerformanceMeasure => {
      throw new Error('performance.measure must not be reached in production');
    });

    expect(() => perfMark('prod:start')).not.toThrow();
    expect(mark).not.toHaveBeenCalled();
    // The early return must short-circuit before the call, not swallow its
    // failure in the catch.
    expect(measure).not.toHaveBeenCalled();
  });

  // Regression: with instrumentation off, `perfMeasure` must return 0 through the
  // early return rather than through the catch, and must not clear marks that
  // belong to someone else.
  it('reports a zero duration without touching performance.measure', async () => {
    const { perfMeasure } = await loadPerformance({ production: true });
    const measure = vi.spyOn(performance, 'measure');
    const clearMarks = vi.spyOn(performance, 'clearMarks');

    expect(perfMeasure('m', 'a', 'b')).toBe(0);
    expect(measure).not.toHaveBeenCalled();
    expect(clearMarks).not.toHaveBeenCalled();
  });

  // Regression: `useRenderTiming` must still return a usable cleanup when
  // instrumentation is off. Returning undefined unconditionally would break every
  // `useEffect(() => useRenderTiming(...), [...])` call site in production.
  it('still returns a callable cleanup with instrumentation disabled', async () => {
    const { useRenderTiming } = await loadPerformance({ production: true });
    const mark = vi.spyOn(performance, 'mark');

    const done = useRenderTiming('Prod');
    expect(typeof done).toBe('function');

    expect(() => done?.()).not.toThrow();
    expect(mark).not.toHaveBeenCalled();
  });
});

describe('useRenderTiming without a window', () => {
  // Regression: `useRenderTiming` guards on `typeof window` because it runs during
  // render, which also happens on the server. Returning a cleanup that closes
  // over `performance` would touch an undefined global there.
  it('returns undefined so a server render never touches performance', async () => {
    const { useRenderTiming } = await loadPerformance({ noWindow: true });
    const mark = vi.spyOn(performance, 'mark');

    const done = useRenderTiming('Server');

    expect(done).toBeUndefined();
    expect(mark).not.toHaveBeenCalled();
  });

  // Regression: with no window there is no `window.performance`, so `perfEnabled`
  // is false and the module-level functions degrade instead of throwing. Calling
  // them must not blow up the render that happened to invoke them.
  it('degrades perfMark and perfMeasure to no-ops with no window', async () => {
    const { perfMark, perfMeasure } = await loadPerformance({ noWindow: true });
    const measure = vi.spyOn(performance, 'measure');
    const mark = vi.spyOn(performance, 'mark');

    expect(() => perfMark('ssr')).not.toThrow();
    expect(perfMeasure('m', 'a', 'b')).toBe(0);
    expect(mark).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
  });
});
