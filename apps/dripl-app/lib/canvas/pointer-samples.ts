/**
 * Pointer-sample coalescing — pure helper extracted from
 * `InteractiveCanvas`.
 *
 * Pointer moves are deferred to the next animation frame; a fast stroke
 * can queue more samples than one frame should replay. Past the cap, the
 * samples are evenly decimated with the latest always preserved, so
 * freehand curves keep their endpoints and stay smooth.
 */

export const MAX_POINTER_SAMPLES_PER_FRAME = 64;
export const MAX_PENDING_POINTER_SAMPLES = 128;

export function capPointerSamples<T>(samples: T[], latest: T): T[] {
  if (samples.length <= MAX_POINTER_SAMPLES_PER_FRAME) return samples;

  const step = (samples.length - 1) / (MAX_POINTER_SAMPLES_PER_FRAME - 1);
  const capped: T[] = Array.from(
    { length: MAX_POINTER_SAMPLES_PER_FRAME - 1 },
    (_, index) => samples[Math.round(index * step)] as T
  );
  capped.push(latest);
  return capped;
}
