import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { ArrowStyle, DriplElement } from '@dripl/common';

/**
 * The one-line setters and the draft lifecycle in `lib/store/canvasSlice.ts`.
 *
 * `canvasSlice.ts` is the composition root: it holds the initial state, delegates element
 * and arrange work to sibling slices, and keeps only the setters, the draft lifecycle and
 * the selection wrappers itself. The setters look trivial enough to be untested, and that
 * is exactly the risk — a setter that writes the wrong state key, or the wrong default,
 * is invisible in review and produces a UI that ignores the click. So each is asserted on
 * the store value it names, and the two that can be *swapped* with a neighbour
 * (`selectElement`'s replace-vs-add argument, `commitDraft`'s two early returns) are
 * asserted on their side effects, since those are what a wrong implementation changes.
 *
 * `commitDraft`'s duplicate-id refusal is the load-bearing one: it returns `null` and drops
 * the draft instead of writing a second element with an id the scene already holds, which
 * would corrupt the id-to-element index that the whole renderer keys on.
 */

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

const state = () => useCanvasStore.getState();

function reset(): void {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    activeTool: 'select',
    toolLocked: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    gridEnabled: false,
    canvasBackground: null,
    currentStrokeColor: '#1e1e1e',
    currentBackgroundColor: 'transparent',
    currentStrokeWidth: 2,
    currentRoughness: 1,
    currentStrokeStyle: 'solid',
    currentFillStyle: 'hachure',
    currentArrowStyle: 'straight',
    drawingLifecycle: 'idle',
    draftElement: null,
    isEditingElementId: null,
    clipboard: [],
    shouldCacheIgnoreZoom: false,
    pendingEmbed: null,
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    past: [],
    future: [],
  });
}

beforeEach(reset);

describe('selectElement — replace by default, extend on request', () => {
  it('selects exactly the given id', () => {
    state().selectElement('a');
    expect([...state().selectedIds]).toEqual(['a']);
  });

  it('replaces the selection when addToSelection is omitted', () => {
    state().selectElement('a');
    state().selectElement('b');
    // Not a union: a plain click on the canvas is a replace, and a leaked previous
    // selection here would drag every selected shape.
    expect([...state().selectedIds]).toEqual(['b']);
  });

  it('replaces the selection when addToSelection is explicitly false', () => {
    state().selectElement('a');
    state().selectElement('b', false);
    expect([...state().selectedIds]).toEqual(['b']);
  });

  it('extends the selection when addToSelection is true', () => {
    state().selectElement('a');
    state().selectElement('b', true);
    expect([...state().selectedIds].sort()).toEqual(['a', 'b']);
  });

  it('does not duplicate an id that is already selected', () => {
    state().selectElement('a');
    state().selectElement('a', true);
    expect([...state().selectedIds]).toEqual(['a']);
  });

  it('installs a fresh Set rather than mutating the previous one', () => {
    // Pointer handlers read `selectedIds` before dispatching; mutating in place would let
    // an in-flight handler see a selection the user never made.
    state().selectElement('a');
    const first = state().selectedIds;
    state().selectElement('b', true);
    expect(state().selectedIds).not.toBe(first);
    expect([...first]).toEqual(['a']);
  });
});

describe('one-line state setters', () => {
  it('setToolLocked writes toolLocked', () => {
    state().setToolLocked(true);
    expect(state().toolLocked).toBe(true);
    state().setToolLocked(false);
    expect(state().toolLocked).toBe(false);
  });

  it('setCurrentArrowStyle writes every member of the arrow-style enum', () => {
    const styles: ArrowStyle[] = ['straight', 'curved', 'elbow'];
    for (const style of styles) {
      state().setCurrentArrowStyle(style);
      expect(state().currentArrowStyle).toBe(style);
    }
  });

  it('setDrawingLifecycle writes all three lifecycle phases', () => {
    for (const phase of ['idle', 'drawing', 'committing'] as const) {
      state().setDrawingLifecycle(phase);
      expect(state().drawingLifecycle).toBe(phase);
    }
  });

  it('setPendingEmbed stores the url and title together', () => {
    state().setPendingEmbed('https://example.com', 'Example');
    expect(state().pendingEmbed).toEqual({ url: 'https://example.com', title: 'Example' });
  });

  it('setPendingEmbed with no title stores an absent title, not an empty string', () => {
    // The modal reads `pendingEmbed.title` to decide whether to show a heading; an empty
    // string would render a blank one where a titleless embed should render none.
    state().setPendingEmbed('https://example.com');
    expect(state().pendingEmbed).toEqual({ url: 'https://example.com' });
    expect(state().pendingEmbed?.title).toBeUndefined();
  });

  it('clearPendingEmbed returns to null, so the modal has a falsy sentinel', () => {
    state().setPendingEmbed('https://example.com', 'Example');
    state().clearPendingEmbed();
    expect(state().pendingEmbed).toBeNull();
  });

  it('clearClipboard empties the array rather than nulling it', () => {
    // The type is `DriplElement[]`, not nullable: a paste path reads `.length` directly,
    // so null would turn a cleared clipboard into a crash on the next copy/paste.
    state().setClipboard([rect('a'), rect('b')]);
    expect(state().clipboard).toHaveLength(2);
    state().clearClipboard();
    expect(state().clipboard).toEqual([]);
  });
});

describe('commitDraft — refusals', () => {
  it('returns null and leaves the scene alone when there is no draft', () => {
    const before = state().elements;
    expect(state().commitDraft()).toBeNull();
    expect(state().elements).toBe(before);
    expect(state().draftElement).toBeNull();
    expect(state().drawingLifecycle).toBe('idle');
    expect(state().past).toHaveLength(0);
  });

  it('discards a draft whose id is already committed, without writing a duplicate', () => {
    state().setElements([rect('a', { version: 5 })]);
    state().clearHistory();
    state().setDraftElement(rect('a', { x: 999 }));

    const committed = state().commitDraft();

    expect(committed).toBeNull();
    // The scene still holds the original at its original position: not a second `a`, and
    // not the draft's geometry overwriting the committed element.
    const after = state();
    expect(after.elements).toHaveLength(1);
    expect(after.elements[0]?.x).toBe(0);
    expect(after.elements[0]?.version).toBe(5);
    // The draft is dropped and the lifecycle rewound, so the canvas does not sit in
    // `drawing` with nothing to draw.
    expect(after.draftElement).toBeNull();
    expect(after.drawingLifecycle).toBe('idle');
    // A refused commit is not a mutation, so it must not appear in history.
    expect(after.past).toHaveLength(0);
  });

  it('writes the committed element into both the array and the id map', () => {
    state().setDraftElement(rect('a'));
    const committed = state().commitDraft();
    expect(committed).not.toBeNull();
    const after = state();
    expect(after.elements.map(e => e.id)).toEqual(['a']);
    expect(after.elementsById.get('a')).toBe(after.elements[0]);
    expect(after.draftElement).toBeNull();
    expect(after.drawingLifecycle).toBe('idle');
    expect(after.past).toHaveLength(1);
  });
});
