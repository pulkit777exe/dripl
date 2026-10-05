import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

/**
 * `InteractiveCanvas` is the interactive half of the editor's two-layer canvas.
 * The pre-existing `InteractiveCanvas.test.tsx` covers the pointer-coalescing
 * queue. This file covers everything around it:
 *
 *   - the `areEqual` comparator behind the default `React.memo` export. It has
 *     two *structurally different* comparisons -- `selectedIds` (a Set, compared
 *     by size and membership) and `viewport` (an object, compared field by field)
 *     -- while everything else is compared by identity. Each is exercised on both
 *     sides, because a comparator that is wrong in the "too eager" direction is
 *     invisible to any test that only checks that a change *does* re-render.
 *   - the render-frame guard: a canvas whose 2D context is unavailable must not
 *     reach the renderer, and a frame that fires after unmount must not either.
 *   - the resize effect's guard for a missing container ref, plus the sizing and
 *     device-pixel-ratio maths it owns.
 *   - pointer-down's focus handoff and the pointer-leave cleanup fallback.
 *
 * Render counting goes through `renderInteractiveScene`, the one thing a
 * committed render *causes*. Each `markDirty` schedules exactly one animation
 * frame and that frame calls the renderer once, so counting renderer calls after
 * advancing a frame counts commits -- which is the distinction between "the memo
 * re-rendered" and "the memo skipped".
 */

vi.mock('@/renderer/interactiveScene', () => ({
  renderInteractiveScene: vi.fn(),
}));

import InteractiveCanvas from '@/components/canvas/InteractiveCanvas';
import { renderInteractiveScene } from '@/renderer/interactiveScene';
import type { CollaboratorCursor } from '@/renderer/interactiveScene';

const draw = vi.mocked(renderInteractiveScene);

type CanvasProps = React.ComponentProps<typeof InteractiveCanvas>;
type Viewport = CanvasProps['viewport'];

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: () => void) {
    MockResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve = vi.fn();
  disconnect = vi.fn(() => {
    this.disconnected = true;
  });
  /** Fire the observer manually -- jsdom never lays out. */
  trigger() {
    this.callback();
  }
}

function rect(id: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

/** A cursor in the shape `renderInteractiveScene` declares, not a partial one. */
function cursor(userId: string, x: number, y: number): CollaboratorCursor {
  return { userId, displayName: `User ${userId}`, color: '#E8462A', x, y, updatedAt: 1 };
}

function container(width = 800, height = 600) {
  const node = document.createElement('div');
  Object.defineProperty(node, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(node, 'offsetHeight', { configurable: true, get: () => height });
  document.body.appendChild(node);
  return node;
}

function viewport(overrides: Partial<Viewport> = {}): Viewport {
  return { x: 0, y: 0, width: 800, height: 600, zoom: 1, ...overrides };
}

/**
 * Defaults whose identity does not change between calls. Every one of these is
 * compared by reference in `areEqual`, so an inline `[]` here would invalidate the
 * memo on every call and make every "skips the render" test pass for the wrong
 * reason. Tests that *want* to invalidate a field pass it in `overrides`.
 */
const EMPTY_ELEMENTS: DriplElement[] = [];
const EMPTY_SELECTED: Set<string> = new Set<string>();
const EMPTY_ERASER_PATH: Array<{ x: number; y: number }> = [];
const DEFAULT_VIEWPORT: Viewport = viewport();

/**
 * One ref object per container, cached so repeated `propsFor` calls for the same
 * element hand back the *same* `containerRef`. This matters: `containerRef` is
 * not one of the comparator's fields, but it *is* in the sizing effect's
 * dependency list, so a fresh ref object on every render would re-run that effect
 * and call `markDirty()` -- producing a draw that has nothing to do with the field
 * under test. (That is a real property of the component, not a test artefact:
 * handing it a fresh ref re-measures. Here it would just mask the comparator.)
 */
const containerRefs = new WeakMap<HTMLDivElement, CanvasProps['containerRef']>();

function refFor(el: HTMLDivElement): CanvasProps['containerRef'] {
  const existing = containerRefs.get(el);
  if (existing) return existing;
  const ref = { current: el } as CanvasProps['containerRef'];
  containerRefs.set(el, ref);
  return ref;
}

function propsFor(el: HTMLDivElement, overrides: Partial<CanvasProps> = {}): CanvasProps {
  return {
    containerRef: refFor(el),
    elements: EMPTY_ELEMENTS,
    selectedIds: EMPTY_SELECTED,
    draftElement: null,
    eraserPath: EMPTY_ERASER_PATH,
    viewport: DEFAULT_VIEWPORT,
    ...overrides,
  };
}

/** Run one pending frame, which is what turns a commit into a renderer call. */
function drawFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

function renderCanvas(
  el: HTMLDivElement,
  overrides: Partial<CanvasProps> = {}
): ReturnType<typeof render> {
  return render(<InteractiveCanvas {...propsFor(el, overrides)} />);
}

/**
 * jsdom does not implement `PointerEvent`, and `fireEvent.pointerMove` falls back
 * to a plain `Event` whose `clientX` reads `undefined`. A real `MouseEvent` with a
 * `pointerId` bolted on is what the existing suite uses, and it is the only shape
 * whose coordinates survive into the React synthetic event.
 */
function dispatchPointerMove(canvas: HTMLElement, clientX: number, clientY: number): void {
  const event = new MouseEvent('pointermove', { bubbles: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { configurable: true, value: 1 });
  fireEvent(canvas, event);
}

function lastDrawConfig(): Parameters<typeof renderInteractiveScene>[0] {
  const call = draw.mock.calls.at(-1);
  if (!call) throw new Error('renderInteractiveScene was never called');
  return call[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  draw.mockClear();
  MockResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('InteractiveCanvas memo comparator', () => {
  // Regression: the comparator's whole job is to skip renders when nothing the
  // canvas draws has changed. The negative case is asserted first and on its own
  // because every positive case below would also pass against a comparator that
  // always returned `false`.
  it('skips the render when every field is unchanged', () => {
    const el = container();
    const base = propsFor(el);

    const { rerender } = render(<InteractiveCanvas {...base} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    // A different props object every time, with identical field identities.
    for (let i = 0; i < 3; i += 1) {
      rerender(<InteractiveCanvas {...{ ...base }} />);
    }
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);
  });

  // Regression: `selectedIds` is compared by *size and membership*, not by
  // identity. The store hands out a fresh Set constantly, so identity comparison
  // would defeat the memo entirely on a busy canvas. A new Set with the same
  // members must skip.
  it('treats a new Set with the same members as unchanged', () => {
    const el = container();
    // `elements` is identity-compared, so it must be the *same* array across
    // these renders -- otherwise this test would pass for the wrong reason (an
    // invalidating field rather than a skipping one).
    const elements: DriplElement[] = [];
    const first = new Set(['a']);
    const second = new Set(['a']);

    const { rerender } = render(
      <InteractiveCanvas {...propsFor(el, { elements, selectedIds: first })} />
    );
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    rerender(<InteractiveCanvas {...propsFor(el, { elements, selectedIds: second })} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);
  });

  // Regression: the other direction for the same field. A *membership* change at
  // constant size is the case a size-only comparator would miss -- selecting a
  // different element rather than adding one, which is the common gesture
  // (click-select replaces the selection). Without this, the overlay would
  // render against the previous selection.
  it('re-renders when the selected members change at the same size', () => {
    const el = container();
    // `elements` is stable across these renders: it is identity-compared, so a
    // fresh array would invalidate the memo on its own and the membership change
    // below would be undetectable.
    const elements = [rect('a'), rect('b')];

    const { rerender } = render(
      <InteractiveCanvas {...propsFor(el, { elements, selectedIds: new Set(['a']) })} />
    );
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    rerender(<InteractiveCanvas {...propsFor(el, { elements, selectedIds: new Set(['b']) })} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(2);

    // And the *size* arm of the same expression, so neither half is untested.
    rerender(
      <InteractiveCanvas {...propsFor(el, { elements, selectedIds: new Set(['a', 'b']) })} />
    );
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(3);
  });

  // Regression: the size arm of `selectedIds` on its own. Asserted separately from
  // the membership arm above because a comparator that compared only membership
  // would satisfy that test on its own -- and a selection that grows from one
  // element to two at the same time as a swap would then go unrendered.
  it('re-renders when the selection grows without losing the membership check', () => {
    const el = container();
    const elements = [rect('a'), rect('b')];

    const { rerender } = render(
      <InteractiveCanvas {...propsFor(el, { elements, selectedIds: new Set(['a']) })} />
    );
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    rerender(
      <InteractiveCanvas {...propsFor(el, { elements, selectedIds: new Set(['a', 'b']) })} />
    );
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  // Regression: `viewport` is an object compared field by field, so a fresh
  // object with the same values must skip -- but any of the five fields changing
  // must not. Each field is exercised, because they are five separate comparisons
  // in one expression and a partial chain would freeze pan, zoom, or resize.
  it('compares every viewport field individually', () => {
    const el = container();
    // Stable across every render here: `elements` is identity-compared, so a
    // fresh array would invalidate the memo on its own and every field below
    // would "invalidate" for the wrong reason.
    const elements: DriplElement[] = [];
    const start = viewport({ x: 10, y: 20, zoom: 2 });
    const build = (v: Viewport) => propsFor(el, { elements, viewport: v });

    const { rerender } = render(<InteractiveCanvas {...build(start)} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    // Same values, new object -> skipped. This is the load-bearing half: without
    // the field-by-field comparison the memo would skip here too, and the loop
    // below would pass on a comparator that always returned `true`.
    rerender(<InteractiveCanvas {...build(viewport({ x: 10, y: 20, zoom: 2 }))} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    const fields: Array<[string, Viewport]> = [
      ['x', viewport({ x: 11, y: 20, zoom: 2 })],
      ['y', viewport({ x: 10, y: 21, zoom: 2 })],
      ['zoom', viewport({ x: 10, y: 20, zoom: 3 })],
      ['width', viewport({ x: 10, y: 20, zoom: 2, width: 900 })],
      ['height', viewport({ x: 10, y: 20, zoom: 2, height: 700 })],
    ];

    for (const [field, next] of fields) {
      const before = draw.mock.calls.length;
      rerender(<InteractiveCanvas {...build(next)} />);
      drawFrame();
      expect(draw.mock.calls.length, `viewport.${field} must invalidate`).toBeGreaterThan(before);
    }
  });

  // Regression: each viewport field is a *separate* comparison, and this loop is
  // the only place they are each exercised in isolation -- the test above walks
  // them in sequence, so a mutation that dropped one field would leave the
  // *following* field's change as the thing that invalidated the memo.
  //
  // Each case therefore resets to the same baseline first, so the only difference
  // between the two renders is the single named field.
  it.each([
    ['x', { x: 1 }],
    ['y', { y: 1 }],
    ['zoom', { zoom: 2 }],
    ['width', { width: 801 }],
    ['height', { height: 601 }],
  ] as Array<['x' | 'y' | 'zoom' | 'width' | 'height', Partial<Viewport>]>)(
    'invalidates on viewport.%s alone, and skips when it comes back',
    (field, patch) => {
      const el = container();
      const elements: DriplElement[] = [];
      // Two *distinct* objects carrying the same viewport values. The comparator
      // compares the five fields, not the object identity, so moving between these
      // two must skip -- which is what makes the patched render below
      // attributable to the named field and nothing else.
      const build = (v: Viewport) => propsFor(el, { elements, viewport: v });

      const { rerender } = render(<InteractiveCanvas {...build(viewport())} />);
      drawFrame();
      expect(draw).toHaveBeenCalledTimes(1);

      // Same values, new object -> skipped.
      rerender(<InteractiveCanvas {...build(viewport())} />);
      drawFrame();
      expect(draw).toHaveBeenCalledTimes(1);

      // One field differs -> invalidated, exactly once.
      rerender(<InteractiveCanvas {...build(viewport({ ...patch }))} />);
      drawFrame();
      expect(draw.mock.calls.length, `${field} must invalidate on its own`).toBe(2);

      // Re-applying the *same* patched values as a fresh object skips, so the
      // count stays put. (Reverting to the baseline is deliberately *not* asserted
      // to skip -- that is a real change, and the memo is right to redraw.)
      rerender(<InteractiveCanvas {...build(viewport({ ...patch }))} />);
      drawFrame();
      expect(draw.mock.calls.length, `a repeat of ${field} must skip`).toBe(2);
    }
  );

  // Regression: the remaining identity-compared fields. Each is a distinct way
  // for the interactive layer to render stale content -- a stale draft element,
  // a stale eraser trail, a stale remote cursor, a stale lock set.
  it.each([
    ['draftElement', { draftElement: rect('draft') }],
    ['eraserPath', { eraserPath: [{ x: 1, y: 1 }] }],
    ['theme', { theme: 'light' as const }],
    [
      'marqueeSelection',
      { marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 4, y: 4 }, active: true } },
    ],
    ['collaborators', { collaborators: [cursor('u1', 1, 2)] }],
    ['lockOwners', { lockOwners: new Map([['a', 'u1']]) }],
    ['localUserId', { localUserId: 'u1' }],
    ['hoveredBindingId', { hoveredBindingId: 'bind-1' }],
    ['startPointBindingId', { startPointBindingId: 'bind-2' }],
    ['preservePointerSamples', { preservePointerSamples: true }],
    ['onPointerDown', { onPointerDown: () => undefined }],
    ['onPointerMove', { onPointerMove: () => undefined }],
    ['onPointerUp', { onPointerUp: () => undefined }],
  ])('re-renders when %s changes', (_field, overrides) => {
    const el = container();
    const { rerender } = render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    rerender(<InteractiveCanvas {...propsFor(el, overrides as Partial<CanvasProps>)} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  // Regression: `elements` is identity-compared, so a new array always
  // invalidates. Asserted as the counterpart to the `selectedIds` value
  // comparison: the two fields deliberately use different strategies, and a
  // comparator that applied the Set logic to `elements` would skip re-renders
  // after an in-place element mutation.
  it('re-renders on any new elements array', () => {
    const el = container();

    const { rerender } = render(<InteractiveCanvas {...propsFor(el, { elements: [rect('a')] })} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    rerender(<InteractiveCanvas {...propsFor(el, { elements: [rect('a')] })} />);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

describe('InteractiveCanvas render-frame guards', () => {
  // Regression: `if (!canvas || !ctx) return` guards the frame against a canvas
  // whose 2D context is unavailable -- which every browser reports for a canvas
  // that has been detached or has hit the context-loss path. Calling the renderer
  // with `ctx: null` would throw inside the render loop, taking down the editor.
  //
  // Asserted as a call count on the renderer, because "no error was thrown" is not
  // an observation.
  it('skips the draw when the 2D context is unavailable', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const el = container();

    render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();

    expect(draw).not.toHaveBeenCalled();
  });

  // Regression: a frame scheduled before unmount must not reach the renderer
  // afterwards. The render loop's own cleanup cancels the frame, and this pins
  // the end-to-end effect: unmounting the canvas mid-frame leaves nothing to
  // draw.
  it('does not draw after unmount', () => {
    const el = container();
    const { unmount } = render(<InteractiveCanvas {...propsFor(el)} />);
    unmount();

    drawFrame();
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('InteractiveCanvas draw configuration', () => {
  // Regression: the draw receives the *measured container* size, not the
  // viewport's. The viewport is the world-to-screen transform; the canvas size is
  // the physical surface. Conflating them letterboxes the interactive layer on
  // any layout where the container and the viewport disagree.
  it('sizes the draw from the measured container, not the viewport', () => {
    const el = container(640, 480);
    render(
      <InteractiveCanvas {...propsFor(el, { viewport: viewport({ width: 320, height: 240 }) })} />
    );
    drawFrame();

    const config = lastDrawConfig();
    expect(config.viewport).toMatchObject({ width: 640, height: 480 });
    expect(config.canvasWidth).toBe(640);
    expect(config.canvasHeight).toBe(480);
    // ...while the transform itself still comes from the viewport's own fields.
    expect(config.viewport).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });

  // Regression: committed elements are drawn by the static layer underneath, so
  // the interactive renderer must be told *not* to draw them. Getting this wrong
  // doubles the elements and doubles the frame cost -- the reason the layer split
  // exists at all. The grid is likewise owned by the static layer.
  it('delegates committed elements and the grid to the static layer', () => {
    const el = container();
    render(<InteractiveCanvas {...propsFor(el, { elements: [rect('a')] })} />);
    drawFrame();

    expect(lastDrawConfig()).toMatchObject({
      renderCommittedElements: false,
      gridEnabled: false,
    });
    // ...while the elements themselves are still forwarded, because the
    // interactive layer needs them for hit highlighting and lock rings.
    expect(lastDrawConfig().elements).toHaveLength(1);
  });

  // Regression: `theme` defaults to `'dark'`. It is a destructuring default in
  // this component, not in the renderer, and getting it wrong would render
  // selection chrome in dark-mode colours on the light canvas.
  it('defaults the theme to dark and forwards an explicit light', () => {
    const el = container();
    const { rerender } = render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();
    expect(lastDrawConfig().theme).toBe('dark');

    rerender(<InteractiveCanvas {...propsFor(el, { theme: 'light' })} />);
    drawFrame();
    expect(lastDrawConfig().theme).toBe('light');
  });

  // Regression: `collaborators`, `lockOwners`, `localUserId`, `hoveredBindingId`
  // and `startPointBindingId` all reach the renderer. `localUserId` in particular
  // decides whose cursor and whose locks are drawn, and dropping it would make
  // every remote user look like the local one.
  it('forwards the collaboration and binding props', () => {
    const el = container();
    const collaborators: CollaboratorCursor[] = [cursor('u1', 5, 6)];
    const lockOwners = new Map([['a', 'u1']]);

    render(
      <InteractiveCanvas
        {...propsFor(el, {
          collaborators,
          lockOwners,
          localUserId: 'u1',
          hoveredBindingId: 'bind-1',
          startPointBindingId: 'bind-2',
        })}
      />
    );
    drawFrame();

    expect(lastDrawConfig()).toMatchObject({
      collaborators,
      lockOwners,
      localUserId: 'u1',
      hoveredBindingId: 'bind-1',
      startPointBindingId: 'bind-2',
    });
  });

  // Regression: `collaborators` and `lockOwners` have destructuring defaults, so
  // the component renders without them. `localUserId` defaults to `null` rather
  // than undefined, and the renderer branches on that.
  it('applies the documented defaults for the optional collaboration props', () => {
    const el = container();
    render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();

    const config = lastDrawConfig();
    expect(config.collaborators).toEqual([]);
    expect(config.lockOwners).toEqual(new Map());
    expect(config.localUserId).toBeNull();
  });
});

describe('InteractiveCanvas sizing', () => {
  // Regression: the backing store is `container * devicePixelRatio`. Using the
  // CSS pixel size for the backing store is what makes a retina canvas blurry --
  // the failure is invisible at DPR 1, so the ratio is stubbed to 2.
  it('scales the backing store by the device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const el = container(500, 400);

    render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('500px');
    expect(canvas.style.height).toBe('400px');
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(800);
    // The renderer is told the ratio so its stroke maths matches the store.
    expect(lastDrawConfig().dpr).toBe(2);
  });

  // Regression: `Math.max(1, ...)` keeps a zero-sized container out of the
  // canvas. A zero-width canvas reports `getContext('2d') === null` in every
  // browser, so the interactive layer would silently stop responding -- and the
  // render-frame guard above would then swallow every frame without an error.
  // This is the only place the clamp is reachable, since both sources fall
  // through a zero rather than producing one.
  it('clamps a zero-sized container to a 1x1 backing store', () => {
    const el = container(0, 0);

    render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('1px');
    expect(canvas.style.height).toBe('1px');
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  // Regression: `if (!canvas || !container) return` guards the resize effect.
  // The container ref is populated by a parent layout effect, so there is a real
  // first render where it is still `null` -- and an unguarded `offsetWidth` read
  // would throw there.
  //
  // Asserted as the renderer call count: the guard's whole job is to skip the
  // sizing work, and a thrown TypeError would be a different failure entirely.
  it('does not size the canvas when the container ref is empty', () => {
    // React 19 types `RefObject<T>` as `{ current: T }`, so a genuinely empty ref
    // needs the cast -- but it is cast to the component's *own* prop type, so a
    // rename of that prop still breaks compilation here.
    const emptyRef = { current: null } as unknown as CanvasProps['containerRef'];
    const utils = render(
      <InteractiveCanvas
        containerRef={emptyRef}
        elements={[]}
        selectedIds={new Set<string>()}
        draftElement={null}
        eraserPath={[]}
        viewport={viewport()}
      />
    );

    expect(() => drawFrame()).not.toThrow();
    // No observer was created, because the effect bailed before reaching it.
    expect(MockResizeObserver.instances).toHaveLength(0);
    // The sizing effect never ran, so the canvas kept jsdom's default backing
    // store rather than being set to the 1x1 clamp. Asserted as "not the clamp",
    // since `0` is not the default -- a bare `toBe(0)` would read as a pass even
    // if the effect had run with a zero container.
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(canvas.style.width).toBe('');
    utils.unmount();
  });

  // Regression: the container is observed with a `ResizeObserver` so a layout
  // change that never fires a window `resize` still re-sizes the canvas. The
  // draw count is what proves the observer drove the work rather than merely
  // existing.
  it('re-sizes when the observed container reports a change', () => {
    const el = container(500, 400);
    renderCanvas(el);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    const observer = MockResizeObserver.instances[0];
    expect(observer?.observed[0]).toBe(el);

    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 900 });
    act(() => observer?.trigger());
    drawFrame();

    expect(draw).toHaveBeenCalledTimes(2);
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('900px');
  });

  // Regression: `window.devicePixelRatio || 1` falls back to 1 when the value is
  // 0 or otherwise falsy. Some headless and remote-desktop environments report 0,
  // and a backing store scaled by 0 is a 0x0 canvas -- the exact state the
  // render-frame guard then silently skips, so the interactive layer would go
  // inert with no error anywhere.
  it('falls back to a 1x ratio when the device pixel ratio is falsy', () => {
    vi.stubGlobal('devicePixelRatio', 0);
    const el = container(400, 300);

    render(<InteractiveCanvas {...propsFor(el)} />);
    drawFrame();

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(lastDrawConfig().dpr).toBe(1);
  });

  // Regression: the `ResizeObserver` is guarded by `typeof ResizeObserver !==
  // 'undefined'` because the class is absent in jsdom and in older Safari. The
  // window `resize` listener is the *only* fallback there, so the observable is
  // that a window resize still re-sizes the canvas with no observer present.
  it('still re-sizes from the window listener when ResizeObserver is absent', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    let width = 500;
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 400 });
    document.body.appendChild(el);

    renderCanvas(el);
    drawFrame();

    expect(MockResizeObserver.instances).toHaveLength(0);
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('500px');

    width = 700;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    drawFrame();

    expect(canvas.style.width).toBe('700px');
  });

  // Regression: the window `resize` listener drives the same closure, and
  // teardown must remove the *very function* it registered -- `removeEventListener`
  // silently ignores an unrelated function, so matching on the event type alone
  // would report a clean teardown for a leak. Both spies are installed before the
  // render, per the ordering trap.
  it('removes the exact resize listener it registered, and the observer with it', () => {
    const el = container();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderCanvas(el);
    const observer = MockResizeObserver.instances[0];

    const registered = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(registered).toBeDefined();

    unmount();

    const removed = removeSpy.mock.calls.filter(([type]) => type === 'resize');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.[1]).toBe(registered?.[1]);
    expect(observer?.disconnected).toBe(true);
  });

  // Regression: a window resize re-sizes and redraws. The draw count is the
  // observation; a surviving listener would also be caught by the teardown test
  // above, but this pins that the listener actually does the work.
  it('re-sizes and redraws on a window resize', () => {
    let width = 500;
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 400 });
    document.body.appendChild(el);

    renderCanvas(el);
    drawFrame();
    expect(draw).toHaveBeenCalledTimes(1);

    width = 900;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    drawFrame();

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('900px');
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

describe('InteractiveCanvas pointer handling', () => {
  // Regression: pointer-down focuses the canvas. That is what keeps the editor's
  // keyboard navigation attached to the editor after a pointer gesture -- without
  // it, every shortcut stops working once the user has clicked, and the only
  // symptom is "the keyboard stopped responding".
  //
  // Asserted on `document.activeElement`, with the focus call observed rather than
  // the handler: an element that merely *could* be focused would satisfy
  // `tabIndex` alone.
  it('focuses the canvas on pointer down', () => {
    const el = container();
    renderCanvas(el);

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(document.activeElement).not.toBe(canvas);

    fireEvent.pointerDown(canvas, { pointerId: 1 });

    expect(document.activeElement).toBe(canvas);
  });

  // Regression: pointer-down flushes the coalesced move queue *before* calling the
  // consumer's handler. Ordering matters: the handler reads the pointer position
  // to decide what the gesture means, so a pending move that had not been
  // delivered would make the gesture start one frame stale.
  //
  // Asserted through the values the consumer observes: the flushed move and the
  // down event are compared by client position.
  it('delivers the pending move before the pointer-down handler runs', () => {
    // Typed to the component's own prop signature so the recorded arguments are
    // inspectable -- an untyped `vi.fn(() => ...)` infers a zero-arg mock and
    // `mock.calls[0][0]` would not typecheck. `Parameters<...>` rather than the
    // function type itself, because `vi.fn<T>` wants the *implementation* shape.
    type PointerArgs = Parameters<NonNullable<CanvasProps['onPointerMove']>>;
    const order: string[] = [];
    const onPointerMove = vi.fn<(event: PointerArgs[0]) => void>(() => {
      order.push('move');
    });
    const onPointerDown = vi.fn<(event: PointerArgs[0]) => void>(() => {
      order.push('down');
    });
    const el = container();

    renderCanvas(el, { onPointerMove, onPointerDown });
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;

    dispatchPointerMove(canvas, 30, 40);
    fireEvent.pointerDown(canvas, { pointerId: 1 });

    expect(order).toEqual(['move', 'down']);
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerMove.mock.calls[0]?.[0]).toMatchObject({ clientX: 30, clientY: 40 });
  });

  // Regression: pointer-up flushes the coalesced move queue before the consumer's
  // handler, exactly as pointer-down does. The final coalesced sample carries the
  // release position, so skipping the flush would commit a drag or a freehand
  // stroke one frame short of where the user let go.
  //
  // The move and the up are dispatched in the same tick with no frame in between
  // -- that is the only ordering in which the queue actually holds something, so a
  // version that advanced a frame first would pass vacuously.
  it('delivers the pending move before the pointer-up handler runs', () => {
    const order: string[] = [];
    type PointerArgs = Parameters<NonNullable<CanvasProps['onPointerMove']>>;
    const onPointerMove = vi.fn<(event: PointerArgs[0]) => void>(() => {
      order.push('move');
    });
    const onPointerUp = vi.fn<(event: PointerArgs[0]) => void>(() => {
      order.push('up');
    });
    const el = container();
    renderCanvas(el, { onPointerMove, onPointerUp });

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    dispatchPointerMove(canvas, 44, 55);
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(order).toEqual(['move', 'up']);
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerMove.mock.calls[0]?.[0]).toMatchObject({ clientX: 44, clientY: 55 });
  });

  // Regression: pointer-*cancel* is wired to the same finalizer as pointer-up.
  // A cancelled gesture -- the browser taking over for a scroll, a system
  // gesture, or the pointer being destroyed -- must finalise the drag exactly as
  // a release does, or the element stays stuck to the cursor.
  it('finalises the gesture on pointer cancel as well as pointer up', () => {
    const onPointerUp = vi.fn();
    const el = container();
    renderCanvas(el, { onPointerUp });
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;

    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(onPointerUp).toHaveBeenCalledTimes(1);
  });

  // Regression: the pointer-leave fallback only fires when the browser does *not*
  // support pointer capture. The pre-existing suite covers the captured case; this
  // pins the uncaptured case -- and the "no `hasPointerCapture` at all" shape,
  // which the `typeof === 'function'` check exists for.
  //
  // Both arms asserted in one test, because the working direction (the fallback
  // does run when it should) and the working non-direction (it does not run when
  // the pointer is captured) are two halves of one condition.
  it('finalises on leave only when the pointer is not captured', () => {
    const onPointerUp =
      vi.fn<(event: Parameters<NonNullable<CanvasProps['onPointerUp']>>[0]) => void>();
    const el = container();
    const { rerender } = renderCanvas(el, { onPointerUp });
    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;

    // Arm 1: no `hasPointerCapture` method at all -- the fallback must run.
    fireEvent.pointerLeave(canvas, { pointerId: 1 });
    expect(onPointerUp).toHaveBeenCalledTimes(1);

    // Arm 2: the method exists and reports a live capture -- must not run. Held in
    // a typed local rather than re-read off the element, so its `.mockReturnValue`
    // is a real typed call and not a cast through an erased signature.
    const hasPointerCapture = vi.fn<(pointerId: number) => boolean>().mockReturnValue(true);
    Object.defineProperty(canvas, 'hasPointerCapture', {
      configurable: true,
      value: hasPointerCapture,
    });
    fireEvent.pointerLeave(canvas, { pointerId: 1 });
    expect(onPointerUp).toHaveBeenCalledTimes(1);
    // The component consulted the capture API once before deciding not to finish
    // the gesture. The *argument* is not asserted: jsdom has no `PointerEvent`, so
    // `fireEvent.pointerLeave` yields a plain event whose `pointerId` reads
    // `undefined` however it is specified.
    expect(hasPointerCapture).toHaveBeenCalledTimes(1);

    // Arm 3: the method exists and reports no capture -- the fallback runs again.
    hasPointerCapture.mockReturnValue(false);
    fireEvent.pointerLeave(canvas, { pointerId: 1 });
    expect(onPointerUp).toHaveBeenCalledTimes(2);

    rerender(<InteractiveCanvas {...propsFor(el, { onPointerUp })} />);
  });

  // Regression: the surface itself must stay interactive. `pointer-events: auto`
  // and `touch-action: none` are declared inline here rather than inherited --
  // `touch-action: none` in particular is what stops a touch drag from scrolling
  // the page instead of drawing, and no other layer declares it for this canvas.
  it('keeps the interactive surface focusable, hit-testable and inert to touch scroll', () => {
    const el = container();
    renderCanvas(el);

    const canvas = screen.getByLabelText('Drawing canvas') as HTMLCanvasElement;
    expect(canvas.style.zIndex).toBe('2');
    expect(canvas.style.pointerEvents).toBe('auto');
    expect(canvas.style.touchAction).toBe('none');
    expect(canvas.className).toBe('canvas-surface absolute inset-0');
  });
});
