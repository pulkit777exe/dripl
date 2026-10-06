import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { selectEraserCursorPosition, useCanvasStore } from '@/lib/store';

/**
 * `RoughCanvas` subscribes to `cursorPosition`, which is written on every pointer move.
 * The only consumer is a ring that renders for the eraser tool alone, so the subscription
 * has to be inert for every other tool — otherwise moving the mouse re-renders the canvas
 * subtree to produce `null`.
 *
 * Counting renders is the only way to see this. The ring's own output is `null` either
 * way, so asserting on the DOM would pass for both a correct selector and a wasteful one.
 *
 * The probe subscribes through the **exported** `selectEraserCursorPosition`, not a copy
 * of it. An earlier draft inlined the same ternary in the probe, which would have kept
 * passing after `RoughCanvas` regressed to the raw field — the test would have been
 * measuring itself.
 */
describe('eraser cursor subscription', () => {
  /** Render-counting wrapper: increments on every React commit of the consumer. */
  let commits = 0;

  function Probe() {
    useCanvasStore(selectEraserCursorPosition);
    commits += 1;
    return null;
  }

  beforeEach(() => {
    commits = 0;
    useCanvasStore.setState({ activeTool: 'select', cursorPosition: null });
  });

  it('does not re-render on pointer moves while another tool is selected', () => {
    const mounted = render(<Probe />);
    const baseline = commits;

    // Twenty distinct positions, as a drag across the canvas would produce.
    for (let i = 0; i < 20; i++) {
      act(() => useCanvasStore.getState().setCursorPosition({ x: i * 10, y: i * 5 }));
    }

    // One commit from mounting; none from the moves.
    expect(commits - baseline).toBe(0);
    mounted.unmount();
  });

  // Regression: the selector is the only thing standing between a mouse move and a
  // re-render, so it has to actually be load-bearing. Reading `state.cursorPosition`
  // directly would re-render 20 times here.
  it('does re-render on pointer moves while the eraser is selected', () => {
    useCanvasStore.setState({ activeTool: 'eraser' });
    const mounted = render(<Probe />);
    const baseline = commits;

    for (let i = 0; i < 20; i++) {
      act(() => useCanvasStore.getState().setCursorPosition({ x: i * 10, y: i * 5 }));
    }

    expect(commits).toBeGreaterThan(baseline);
    mounted.unmount();
  });

  it('subscribes again when the eraser becomes the active tool', () => {
    const mounted = render(<Probe />);

    act(() => useCanvasStore.getState().setActiveTool('eraser'));
    const baseline = commits;
    act(() => useCanvasStore.getState().setCursorPosition({ x: 5, y: 5 }));

    expect(commits).toBeGreaterThan(baseline);
    mounted.unmount();
  });

  // Regression: `null` must mean "not tracking", not "the position happens to be null".
  // A selector returning the raw value would also be `null` before the first move, and a
  // test that only ever checked the pre-move state would pass for both.
  it('ignores the stored position until the eraser is selected', () => {
    useCanvasStore.setState({ activeTool: 'select', cursorPosition: { x: 99, y: 99 } });
    const mounted = render(<Probe />);
    const baseline = commits;

    act(() => useCanvasStore.getState().setCursorPosition({ x: 100, y: 100 }));

    expect(commits - baseline).toBe(0);
    mounted.unmount();
  });
});
