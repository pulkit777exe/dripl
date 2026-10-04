import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

/**
 * `loadInitialScene` — which document the user is shown on open.
 *
 * This is the boundary where an untrusted payload (a `file` link) becomes the
 * scene on screen, so the rules worth pinning are per source:
 *
 *   local: always a cache copy, and never `null` — "nothing stored yet" is an
 *          empty document, and a `null` would be read as "no scene at all".
 *   room:  `null` when the IndexedDB mirror restores to nothing, because the
 *          room's real scene arrives over the socket.
 *   file:  validated through `restoreElements` before it can reach the store,
 *          and an empty array is a legitimate empty document.
 *
 * `CanvasBootstrap.modes.test.tsx` covers the consumer's side of this contract
 * with the loader mocked out; this file is the loader's own half, with the real
 * `restoreElements` in the pipeline.
 */

const loadLocalCanvasFromStorage = vi.fn();
const loadCanvasFromIndexedDB = vi.fn();

vi.mock('@/utils/localCanvasStorage', () => ({
  loadLocalCanvasFromStorage: () => loadLocalCanvasFromStorage(),
}));

vi.mock('@/lib/canvas-db', () => ({
  loadCanvasFromIndexedDB: (...args: unknown[]) => loadCanvasFromIndexedDB(...args),
}));

import { loadInitialScene, type LoadSceneOptions } from '@/lib/scene-loader';

function element(id: string, extra: Record<string, unknown> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
    ...extra,
  } as DriplElement;
}

beforeEach(() => {
  loadLocalCanvasFromStorage.mockReset().mockReturnValue({ elements: null, appState: null });
  loadCanvasFromIndexedDB.mockReset().mockResolvedValue([]);
});

describe('loadInitialScene: local', () => {
  it('returns the stored local copy with its elements normalised', async () => {
    // This test previously asserted `isFromCache: true`, named after a
    // regression that could not happen: nothing in the repo ever read that
    // flag, so a stale local copy was never 'preferred over the room the user
    // just joined'. The field and its doc comment claimed a guarantee that was
    // never enforced, and have been removed. What is worth keeping is the part
    // that *is* enforced -- the stored copy comes back as real elements.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('a'), element('b')],
      appState: null,
    });

    const scene = await loadInitialScene({ source: 'local' });

    expect(scene).toEqual({
      source: 'local',
      appState: null,
      elements: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })],
    });
  });

  it('returns an empty scene rather than null when nothing is stored', async () => {
    // Regression: a first visit has no localStorage at all, so `elements` is
    // null. Returning `null` here would be read downstream as "there is no
    // scene", which skips applying the stored app state and leaves the user on
    // default zoom/pan — or on whatever canvas was already open.
    const scene = await loadInitialScene({ source: 'local' });

    expect(scene).not.toBeNull();
    expect(scene!.elements).toEqual([]);
  });

  it('carries the stored app state through so theme and viewport come back', async () => {
    // Regression: elements and appState are one snapshot written together. A
    // loader that returned `null` appState would restore the drawing at the
    // default zoom and lose the user's theme on every visit.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [element('a')],
      appState: { theme: 'dark', zoom: 2.5, panX: -40 },
    });

    const scene = await loadInitialScene({ source: 'local' });

    expect(scene!.appState).toEqual({ theme: 'dark', zoom: 2.5, panX: -40 });
  });

  it('normalises stored elements instead of handing the raw payload on', async () => {
    // Regression: localStorage holds whatever an older build wrote, so a stored
    // element can be missing geometry and colour fields. Passing it straight
    // through renders it blank; the normalise funnel is the point of this layer.
    loadLocalCanvasFromStorage.mockReturnValue({
      elements: [{ id: 'legacy', type: 'rectangle' } as unknown as DriplElement],
      appState: null,
    });

    const scene = await loadInitialScene({ source: 'local' });

    expect(scene!.elements[0]).toMatchObject({
      id: 'legacy',
      width: 100,
      height: 100,
      strokeColor: '#000000',
    });
  });
});

describe('loadInitialScene: room', () => {
  it('reads the room scene out of the IndexedDB mirror', async () => {
    // Regression: the room branch reads the durable mirror by room id. Reading
    // the wrong id (or localStorage) serves another room's elements under this
    // room's name.
    loadCanvasFromIndexedDB.mockResolvedValue([element('room-el')]);

    const scene = await loadInitialScene({ source: 'room', roomId: 'design-review' });

    expect(loadCanvasFromIndexedDB).toHaveBeenCalledWith('design-review');
    expect(scene).toMatchObject({ source: 'room', appState: null });
    expect(scene!.elements.map(e => e.id)).toEqual(['room-el']);
  });

  it('returns null when the mirror holds nothing for that room', async () => {
    // Regression: `null` is how this branch says "there is no cached room
    // scene", which is what lets the socket's snapshot be the scene. Returning
    // an empty scene instead claims the room's document is empty.
    loadCanvasFromIndexedDB.mockResolvedValue([]);

    expect(await loadInitialScene({ source: 'room', roomId: 'empty-room' })).toBeNull();
  });

  it('returns null when nothing in the mirror survives restoration', async () => {
    // Regression: the check is on the *restored* length, not the stored length.
    // A mirror holding only entries that cannot be restored must read as "no
    // cached scene", or an empty scene is reported for a room that has content.
    loadCanvasFromIndexedDB.mockResolvedValue([
      null,
      'not-an-element',
      42,
    ] as unknown as DriplElement[]);

    expect(await loadInitialScene({ source: 'room', roomId: 'corrupt-room' })).toBeNull();
  });

  it('claims no app state for a room scene, because the room owns the viewport', async () => {
    // Regression: the local app state is a single global record for whichever
    // document was open last. Applying it on entering a room would move the
    // viewport to the previous canvas's pan/zoom.
    loadCanvasFromIndexedDB.mockResolvedValue([element('room-el')]);

    const scene = await loadInitialScene({ source: 'room', roomId: 'a-room' });

    expect(scene!.appState).toBeNull();
  });
});

describe('loadInitialScene: file', () => {
  it('reads a bare array payload', async () => {
    // Regression: share/board links encode the scene as a bare element array.
    // Losing the array branch (because `elements` is read off an object) opens
    // every such link as an empty canvas.
    const scene = await loadInitialScene({
      source: 'file',
      initialData: [element('from-array')],
    });

    expect(scene!.elements.map(e => e.id)).toEqual(['from-array']);
  });

  it('reads elements and app state out of an object payload', async () => {
    // Regression: `appState` holds the file's zoom/pan/theme. Reading only
    // `elements` opens the file at default zoom with the wrong theme.
    const scene = await loadInitialScene({
      source: 'file',
      initialData: { elements: [element('from-object')], appState: { zoom: 3, panY: -12 } },
    });

    expect(scene!.elements.map(e => e.id)).toEqual(['from-object']);
    expect(scene!.appState).toEqual({ zoom: 3, panY: -12 });
  });

  it('returns null when there is no payload at all', async () => {
    // Regression: `initialData` is null when the fetch or decryption failed.
    // `null` is what lets the caller keep the canvas the user already has;
    // an empty scene would be applied over it.
    expect(await loadInitialScene({ source: 'file', initialData: null })).toBeNull();
    expect(await loadInitialScene({ source: 'file', initialData: undefined })).toBeNull();
    expect(await loadInitialScene({ source: 'file', initialData: '' })).toBeNull();
  });

  it('returns an empty scene for an empty file, not null', async () => {
    // Regression: an empty document is a document. Answering `null` would leave
    // the previously opened canvas on screen under the new file's name — the
    // wrong document, silently.
    const scene = await loadInitialScene({ source: 'file', initialData: [] });

    expect(scene).not.toBeNull();
    expect(scene!.elements).toEqual([]);
  });

  it('drops entries that are not objects and repairs the ones missing an id', async () => {
    // Regression: one corrupt entry in a shared payload must not cost the user
    // the whole file, and must not let a primitive through into the store where
    // `element.id` is read. The other half matters just as much: an entry that
    // is a real element but has lost its id must be repaired, not discarded —
    // dropping it would silently delete a shape from someone's file.
    const scene = await loadInitialScene({
      source: 'file',
      initialData: [element('good'), null, 'nope', 7, { type: 'rectangle' }],
    });

    expect(scene!.elements).toHaveLength(2);
    expect(scene!.elements.map(e => e.id)).toContain('good');

    const repaired = scene!.elements.find(e => e.id !== 'good')!;
    expect(repaired.id).toEqual(expect.any(String));
    expect(repaired.id.length).toBeGreaterThan(0);
  });

  it('ignores an elements field that is not an array', async () => {
    // Regression: `elements` is cast, not validated. Letting a string through
    // would hand the consumer a "scene" whose elements are a string, and
    // makes that observable is the element list itself, so that is asserted.
    const scene = await loadInitialScene({
      source: 'file',
      initialData: { elements: 'not-an-array' },
    });

    expect(scene!.elements).toEqual([]);
  });

  it('ignores an app state that is not an object', async () => {
    // Regression: app state is spread field-by-field onto the store. A string
    // that survived the cast would be applied as if it were preferences.
    const scene = await loadInitialScene({
      source: 'file',
      initialData: { elements: [element('a')], appState: 'dark' },
    });

    expect(scene!.appState).toBeNull();
  });

  it('yields a null app state when the payload carries none', async () => {
    // Regression: `undefined` and `null` are both "no app state" to the
    // consumer, and `undefined` would be a different value than the documented
    // `Partial<LocalCanvasState> | null` the type promises.
    const scene = await loadInitialScene({
      source: 'file',
      initialData: { elements: [element('a')] },
    });

    expect(scene!.appState).toBeNull();
  });

  // REPORTED, not endorsed: the brief for this module says an unreadable
  // payload must answer `null` so no half-populated document is applied. The
  // code answers an empty scene instead, and `CanvasBootstrap` applies
  // `scene.elements` unconditionally — so a corrupt share link replaces the
  // user's open canvas with an empty one and the persistence hooks then mirror
  // that emptiness over their drawing. This test pins what the code does so
  // the fix is a visible test change rather than a silent one.
  it('yields an empty scene, not null, for a payload it cannot read', async () => {
    const scene = await loadInitialScene({
      source: 'file',
      initialData: { encrypted: true, version: 3 },
    });

    expect(scene).not.toBeNull();
    expect(scene!.elements).toEqual([]);
    expect(scene!.appState).toBeNull();
  });

  it('answers null for a source it does not recognise', async () => {
    // Defensive: the option union is checked by the compiler, but the payload
    // that reaches this loader came from a URL. An unrecognised source must not
    // fall through into one of the known branches and fabricate a scene.
    const bogus = { source: 'realtime', roomId: 'x' } as unknown as LoadSceneOptions;

    expect(await loadInitialScene(bogus)).toBeNull();
  });
});
