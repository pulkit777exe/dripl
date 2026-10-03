import { PerformanceObserver } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * GC observability for the render-path harness.
 *
 * WHY
 * ---
 * Canvas call counts say how much work crosses the 2D API. They say nothing
 * about short-lived JavaScript objects, and the render path allocates result
 * objects per element per frame (one in `getOrCreateElementCanvas`, one in
 * `drawElement`) that exist only to be read once and dropped. At ~945 visible
 * elements that is ~1,890 short-lived objects per frame, ~113k per second at
 * 60 Hz — invisible to a draw-call count and visible only as GC.
 *
 * GC is also worth measuring directly rather than through a proxy for it: a
 * scavenge pause lands inside a frame, in a browser exactly as here. So this
 * reports a count (`gcEvents`) and a duration (`gcPauseMs`) rather than trying
 * to count object allocations, which Node does not expose deterministically.
 */

export interface GcMeasurement {
  gcEvents: number;
  gcPauseMs: number;
}

/**
 * Run `body` and report the GC it caused.
 *
 * The observer is asynchronous, so macrotask ticks are awaited afterwards to
 * drain the entries it queued. Without that, the last collection of a run is
 * attributed to whatever happens to run next — which is precisely how an
 * allocation measurement ends up flattering itself.
 */
export async function measureGc(body: () => void): Promise<GcMeasurement> {
  let gcEvents = 0;
  let gcPauseMs = 0;
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      gcEvents += 1;
      gcPauseMs += entry.duration;
    }
  });
  observer.observe({ entryTypes: ['gc'] });

  try {
    body();
    await sleep(0);
    // A second tick: the observer callback for the first tick's collections is
    // itself queued, so one tick is not always enough to see them.
    await sleep(0);
  } finally {
    observer.disconnect();
  }

  return { gcEvents, gcPauseMs: Number(gcPauseMs.toFixed(3)) };
}
