import type { CanvasStoreState } from './types';

/**
 * Store selectors that exist to keep a subscription inert.
 *
 * Each of these returns a value that is *stable* while the underlying state churns, so
 * Zustand's reference check skips the re-render. That makes them a performance mechanism
 * rather than a convenience, and a convenience can be inlined at the call site — these are
 * exported so the intent is named, reviewable, and directly testable, instead of being a
 * ternary buried in a component that a test cannot reach without mounting a canvas.
 */

/**
 * The eraser ring's position, or `null` unless the eraser is the active tool.
 *
 * `cursorPosition` is written on **every** pointer move. Its only consumer is a 40px ring
 * that renders for the eraser alone, so subscribing to the raw field re-rendered the
 * canvas subtree on every mouse move with any other tool selected — to produce `null`.
 * Returning a stable `null` makes the selector's result unchanged, so nothing re-renders.
 *
 * Upstream avoids the question by drawing the ring on the canvas rather than in the DOM.
 * This gets the same result without moving render ownership away from React.
 */
export function selectEraserCursorPosition(
  state: CanvasStoreState
): CanvasStoreState['cursorPosition'] {
  return state.activeTool === 'eraser' ? state.cursorPosition : null;
}
