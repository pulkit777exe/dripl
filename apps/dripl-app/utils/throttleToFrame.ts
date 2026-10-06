/**
 * Rate-limit a function to one call per animation frame.
 *
 * The pointer and wheel streams both deliver events far faster than the display can
 * show them: a high-polling-rate mouse emits `pointermove` at its polling rate, and a
 * trackpad emits `wheel` at roughly 100-200 events per second. Work done per event is
 * therefore done several times per frame and thrown away — on a 120Hz display, a
 * trackpad zoom gesture runs about twice the state updates there are frames to draw
 * them.
 *
 * Collapsing to the last event of each frame is what makes the *result* match the
 * display: intermediate positions are not observable, so computing them is waste. This
 * is a trailing-edge throttle, so the final value always lands — dropping the trailing
 * call instead would leave the viewport one increment short of the user's gesture.
 *
 * The leading call is **not** fired immediately. Deferring the first event costs at most
 * one frame of latency and buys a real benefit: a burst that arrives entirely inside a
 * single frame does exactly one unit of work instead of one per event. Firing eagerly
 * would give that case nothing.
 *
 * `cancel()` exists because a deferred call is work that can outlive its reason. A
 * pointerup arriving before the scheduled frame would otherwise still run a move handler
 * against a released pointer.
 */
export interface ThrottledToFrame<TArgs extends unknown[]> {
  (...args: TArgs): void;
  /** Drop any pending call. Safe to call when nothing is scheduled. */
  cancel(): void;
  /** Run any pending call immediately, then clear it. */
  flush(): void;
  /** True when a call is scheduled and not yet run. Read-only, for tests. */
  readonly pending: boolean;
}

export function throttleToFrame<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void
): ThrottledToFrame<TArgs> {
  let frameId: number | null = null;
  let latestArgs: TArgs | null = null;

  const run = () => {
    frameId = null;
    // Cleared before the call, so a `fn` that re-enters through this same wrapper
    // schedules a fresh frame instead of being swallowed by the one in flight.
    const args = latestArgs;
    latestArgs = null;
    if (args) fn(...args);
  };

  const throttled = ((...args: TArgs) => {
    latestArgs = args;
    // Already scheduled: keep only the newest args and let the pending frame apply them.
    if (frameId !== null) return;
    frameId = requestAnimationFrame(run);
  }) as ThrottledToFrame<TArgs>;

  throttled.cancel = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    latestArgs = null;
  };

  throttled.flush = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    run();
  };

  Object.defineProperty(throttled, 'pending', {
    get: () => frameId !== null,
  });

  return throttled;
}
