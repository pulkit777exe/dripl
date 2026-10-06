import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { throttleToFrame } from '../../utils/throttleToFrame';

/**
 * `throttleToFrame` decides how much work the canvas does per frame, so its edge cases
 * are exactly where a "looks right, drops the last event" bug would hide. The suite drives
 * a fake `requestAnimationFrame` rather than real timing, so every case below is
 * deterministic instead of a race.
 */
describe('throttleToFrame', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run every scheduled callback once, as the browser would at the next frame. */
  function runFrame(): void {
    const scheduled = [...frames.entries()];
    frames.clear();
    for (const [, cb] of scheduled) cb(0);
  }

  it('collapses a burst inside one frame into a single call', () => {
    const spy = vi.fn();
    const throttled = throttleToFrame(spy);

    for (let i = 1; i <= 40; i++) throttled(i);

    // One frame's worth of work, not forty. This is the whole point: the canvas should
    // do per-*frame* work, not per-*event* work.
    runFrame();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Regression: a leading-edge throttle would call with `1` and then drop 2..40, leaving
  // the viewport one increment behind the gesture. A dropped trailing call is invisible
  // in isolation and very visible in use — the canvas stops short of where you pointed.
  it('applies the LAST value of a burst, not the first', () => {
    const seen: number[] = [];
    const throttled = throttleToFrame((n: number) => seen.push(n));

    throttled(1);
    throttled(2);
    throttled(3);
    runFrame();

    expect(seen).toEqual([3]);
  });

  it('does not fire on the leading event, only on the frame', () => {
    const spy = vi.fn();
    throttleToFrame(spy)(1);

    // Nothing has run yet, so an assertion here is what distinguishes a trailing-edge
    // throttle from an eager one.
    expect(spy).not.toHaveBeenCalled();
    runFrame();
    expect(spy).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('schedules a new frame after the previous one ran', () => {
    const spy = vi.fn();
    const throttled = throttleToFrame(spy);

    throttled(1);
    runFrame();
    throttled(2);
    runFrame();
    throttled(3);
    runFrame();

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(2, 2);
    expect(spy).toHaveBeenNthCalledWith(3, 3);
  });

  // Regression: `cancel` exists for the case where a pointerup lands before the scheduled
  // frame. Without it the move handler runs against a released pointer, which on a drag
  // means the element jumps one final increment after the user let go.
  it('drops the pending call on cancel', () => {
    const spy = vi.fn();
    const throttled = throttleToFrame(spy);

    throttled(1);
    throttled(2);
    expect(throttled.pending).toBe(true);

    throttled.cancel();
    runFrame();

    expect(spy).not.toHaveBeenCalled();
    expect(throttled.pending).toBe(false);
  });

  it('is safe to cancel with nothing scheduled', () => {
    const throttled = throttleToFrame(vi.fn());
    expect(() => throttled.cancel()).not.toThrow();
    expect(() => throttled.cancel()).not.toThrow();
  });

  it('runs the pending call immediately on flush', () => {
    const seen: number[] = [];
    const throttled = throttleToFrame((n: number) => seen.push(n));

    throttled(1);
    throttled(7);
    throttled.flush();

    expect(seen).toEqual([7]);
    // The scheduled frame must not fire a second time for the same work.
    runFrame();
    expect(seen).toEqual([7]);
  });

  it('is safe to flush with nothing scheduled', () => {
    const spy = vi.fn();
    const throttled = throttleToFrame(spy);
    throttled.flush();
    expect(spy).not.toHaveBeenCalled();
  });

  // Regression: if the frame callback cleared its own guard *after* invoking `fn`, then a
  // `fn` that calls back into the same wrapper would see "already scheduled" and have
  // its new value dropped — the new frame would never be requested, and the value would
  // be lost until some unrelated later event happened to schedule one.
  it('schedules a fresh frame when fn re-enters the wrapper', () => {
    const seen: number[] = [];
    const throttled = throttleToFrame((n: number) => {
      seen.push(n);
      if (n === 1) throttled(99);
    });

    throttled(1);
    runFrame();
    expect(seen).toEqual([1]);

    // The re-entrant call must have queued its own frame, not been swallowed.
    runFrame();
    expect(seen).toEqual([1, 99]);
  });

  it('reports pending false immediately after a frame runs', () => {
    const throttled = throttleToFrame(vi.fn());
    throttled(1);
    expect(throttled.pending).toBe(true);
    runFrame();
    expect(throttled.pending).toBe(false);
  });

  // Regression: this is the property the re-entrancy guard exists to protect, and it is
  // NOT observable through call counts. Dropping the guard still collapses a burst to one
  // call -- the duplicate frame callback finds `latestArgs` already consumed and does
  // nothing -- so a suite that only counts calls reports the mutation as undetected while
  // the throttle has quietly started requesting a frame per event, which is the exact
  // waste the throttle exists to remove. Count the frames instead.
  it('requests exactly one frame for a whole burst', () => {
    const throttled = throttleToFrame(vi.fn());

    for (let i = 0; i < 40; i++) throttled(i);
    expect(frames.size).toBe(1);

    runFrame();
    expect(frames.size).toBe(0);

    // And the next burst schedules exactly one more, rather than one per leftover frame.
    throttled(41);
    expect(frames.size).toBe(1);
  });

  // Regression: `flush` runs the pending work now, so leaving the frame scheduled would
  // leave the browser to invoke the callback a second time for work already done. With a
  // stubbed rAF the double-run is a silent no-op, so this asserts the *cancellation*
  // rather than the call count.
  it('cancels the scheduled frame when flushing', () => {
    const spy = vi.fn();
    const throttled = throttleToFrame(spy);

    throttled(1);
    expect(frames.size).toBe(1);

    throttled.flush();
    expect(spy).toHaveBeenCalledExactlyOnceWith(1);
    expect(frames.size).toBe(0);
  });

  it('forwards every argument, not just the first', () => {
    const spy = vi.fn();
    const throttled = throttleToFrame(spy);

    throttled(1, 'two', { three: true });
    runFrame();

    expect(spy).toHaveBeenCalledWith(1, 'two', { three: true });
  });
});
