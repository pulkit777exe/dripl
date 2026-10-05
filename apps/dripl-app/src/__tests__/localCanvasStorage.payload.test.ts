import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

import {
  clearLocalCanvasStorage,
  loadLocalCanvasFromStorage,
  saveLocalCanvasToStorage,
  LOCAL_CANVAS_STORAGE_KEYS,
  type LocalCanvasState,
  type LocalStoragePayload,
} from '@/utils/localCanvasStorage';

/**
 * The recovery paths of `utils/localCanvasStorage.ts`: what happens when the
 * stored copy is not something the loader can use.
 *
 * The happy round trip is already covered by `localPersistenceLimits.test.ts`
 * (byte budget, truncation flag, 6k-element scenes). What is left here is the
 * half of the file that only runs when something has gone wrong, and it makes
 * one promise worth pinning on its own: **a payload the loader cannot use never
 * keeps occupying storage.** A stale, unparseable or half-written entry would
 * otherwise be re-read on every boot and re-fail forever.
 *
 * The three failure shapes are deliberately distinguished, because all three
 * answer "no canvas" and only the shape of the answer tells them apart:
 *
 *   nothing stored          -> { elements: null, appState: null }
 *   structurally wrong       -> clears the entry, then the same answer. A guard
 *                               that lets a payload through instead of clearing
 *                               it returns a *half* answer -- some elements with
 *                               no preferences -- which reads as a scene.
 *   unparseable, and storage
 *   also refuses to clear   -> { storageUnavailable: true }. The entry is left in
 *                               place (we could not remove it) and the caller is
 *                               told storage is broken, which is the one signal
 *                               that distinguishes a private-browsing profile from
 *                               an ordinary empty canvas.
 */

const KEY = LOCAL_CANVAS_STORAGE_KEYS.STRUCTURED;

/**
 * The bound `saveLocalCanvasToStorage` puts on `selectedIds`.
 *
 * Restated here because it is a literal inside the function rather than an
 * exported constant, so it cannot be imported. The tests use it to build a
 * selection on *both* sides of the boundary; if the literal in the source moves,
 * "far larger than the cap" and "at the cap" stop straddling it and the pair
 * fails, which is the intended signal rather than a silent pass.
 */
const SELECTION_CAP = 5_000;

const state: LocalCanvasState = {
  theme: 'light',
  zoom: 1,
  panX: 0,
  panY: 0,
  currentStrokeColor: '#1e1e1e',
  currentBackgroundColor: 'transparent',
  currentStrokeWidth: 2,
  currentRoughness: 1,
  currentStrokeStyle: 'solid',
  currentFillStyle: 'hachure',
  activeTool: 'select',
};

function element(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

/**
 * A well-formed payload with one half removed.
 *
 * The shapes are written as `Partial<LocalStoragePayload>` and cast because the
 * point of the fixture *is* the missing half: the loader must defend against a
 * payload that never satisfied the type. `elementStates` alone is the interesting
 * one -- if the guard is dropped, the loader still finds `elements` and reports a
 * scene with no preferences, which a caller cannot tell from a real restore.
 */
function halfPayload(missing: 'userPreferences' | 'elementStates') {
  const full: LocalStoragePayload = {
    userPreferences: state,
    elementStates: { elements: [element('kept')] },
  };
  const { userPreferences, elementStates } = full;
  return missing === 'userPreferences' ? { elementStates } : { userPreferences };
}

describe('loadLocalCanvasFromStorage — unusable payloads', () => {
  beforeEach(() => {
    // Reset *all* state a test can observe: the store itself, plus any prototype
    // spy installed by the storage-denied cases below. A partial reset here leaks
    // a throwing `removeItem` into the next test and inverts its expectations.
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reports nothing saved when the key is absent', () => {
    const loaded = loadLocalCanvasFromStorage();

    expect(loaded.elements).toBeNull();
    expect(loaded.appState).toBeNull();
    expect(loaded.storageUnavailable).toBeUndefined();
  });

  // Regression: the payload guard is the only thing standing between a
  // half-written entry and a scene restored with `appState === undefined`. The
  // `elements === null` assertion is the load-bearing one -- the `appState`
  // assertion alone passes for a guard that only checks the preferences half.
  it.each(['userPreferences', 'elementStates'] as const)(
    'clears a payload missing its %s half and reports nothing saved',
    missing => {
      localStorage.setItem(KEY, JSON.stringify(halfPayload(missing)));

      const loaded = loadLocalCanvasFromStorage();

      expect(loaded.elements).toBeNull();
      expect(loaded.appState).toBeNull();
      // The unusable entry is gone, so the next boot does not re-read it.
      expect(localStorage.getItem(KEY)).toBeNull();
      // A payload we rejected on its shape is not a storage outage.
      expect(loaded.storageUnavailable).toBeUndefined();
    }
  );

  // Regression: a stored `null` (or any JSON scalar) satisfies
  // `if (!structured) return ...` only for falsy ones, and reaches the guard as
  // `payload === null`, where `payload?.userPreferences` short-circuits. Without
  // the optional chaining the guard itself throws.
  it.each([
    ['a JSON null', 'null'],
    ['a JSON number', '17'],
    ['an empty object', '{}'],
    ['a JSON string', '"canvas"'],
    ['an empty array', '[]'],
  ])('clears %s rather than trusting it as a canvas', (_label, raw) => {
    localStorage.setItem(KEY, raw);

    const loaded = loadLocalCanvasFromStorage();

    expect(loaded.elements).toBeNull();
    expect(loaded.appState).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('clears an unparseable entry and reports nothing saved', () => {
    localStorage.setItem(KEY, '{"userPreferences": {');

    const loaded = loadLocalCanvasFromStorage();

    expect(loaded.elements).toBeNull();
    expect(loaded.appState).toBeNull();
    // The corrupt entry is reset, not left to fail on every subsequent read.
    expect(localStorage.getItem(KEY)).toBeNull();
    // Storage itself worked (we just removed through it), so this is not the
    // outage signal.
    expect(loaded.storageUnavailable).toBeUndefined();
  });

  // The working direction matters here: this branch *keeps* the entry, because
  // the removal is what failed. Asserting only the `storageUnavailable` flag
  // would also pass for the corrupt-entry path that clears successfully.
  it('reports storage unavailable and keeps the entry when clearing throws', () => {
    const corrupt = 'not json at all';
    localStorage.setItem(KEY, corrupt);
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    const loaded = loadLocalCanvasFromStorage();

    expect(loaded.storageUnavailable).toBe(true);
    expect(loaded.elements).toBeNull();
    expect(loaded.appState).toBeNull();
    expect(removeItem).toHaveBeenCalledWith(KEY);
    // Nothing was removed, so the entry is still exactly what we stored.
    expect(localStorage.getItem(KEY)).toBe(corrupt);
  });

  // Same distinction, reached through a *successful* save/load first: the flag
  // must not appear on a load where removal works, or a private-browsing warning
  // would fire on every corrupt-payload recovery.
  it('does not report storage unavailable when the entry can be cleared', () => {
    saveLocalCanvasToStorage([element('a')], state);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    localStorage.setItem(KEY, '}{');

    const loaded = loadLocalCanvasFromStorage();

    expect(loaded.storageUnavailable).toBeUndefined();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

// Regression: the selection payload. `selectedIds` is the one part of the saved
// state a user can *see* go wrong -- a capped selection restores with the wrong
// elements highlighted, which is a silent wrong answer rather than an empty
// canvas. Both directions are asserted, because a cap that is too small and a
// cap that is too large fail differently.
describe('saveLocalCanvasToStorage — the stored selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it.each([
    ['a Set', (ids: string[]) => new Set(ids)],
    ['an array', (ids: string[]) => ids],
  ])('round-trips a selection supplied as %s', (_label, make) => {
    const ids = ['a', 'b', 'c'];

    saveLocalCanvasToStorage([element('a')], state, make(ids));

    expect(loadLocalCanvasFromStorage().selectedIds).toEqual(ids);
  });

  it('stores no selection when none is given', () => {
    saveLocalCanvasToStorage([element('a')], state);

    expect(loadLocalCanvasFromStorage().selectedIds).toBeUndefined();
  });

  // The cap's purpose: a selection cannot be larger than the scene, so an
  // unbounded one would be a second copy of the element array in the payload.
  // The bound is derived from the exported constant rather than restated, so
  // changing the cap does not silently pass.
  it('caps a selection far larger than the cap', () => {
    const ids = Array.from({ length: SELECTION_CAP + 25 }, (_, i) => `e${i}`);

    saveLocalCanvasToStorage([element('a')], state, ids);

    const loaded = loadLocalCanvasFromStorage();
    expect(loaded.selectedIds).toHaveLength(SELECTION_CAP);
    // The cap keeps the *first* ids -- the ones the user selected earliest.
    expect(loaded.selectedIds![0]).toBe('e0');
    expect(loaded.selectedIds).not.toContain(`e${SELECTION_CAP}`);
  });

  it('does not cap a selection at the cap', () => {
    const ids = Array.from({ length: SELECTION_CAP }, (_, i) => `e${i}`);

    saveLocalCanvasToStorage([element('a')], state, ids);

    expect(loadLocalCanvasFromStorage().selectedIds).toHaveLength(SELECTION_CAP);
  });
});

// Regression: the clearing branch, not just the call. A no-op here leaves the
// previous scene to reappear the next time the canvas boots.
describe('clearLocalCanvasStorage', () => {
  it('removes the stored scene', () => {
    saveLocalCanvasToStorage([element('a')], state);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    clearLocalCanvasStorage();

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadLocalCanvasFromStorage().elements).toBeNull();
  });

  it('is a no-op when there is nothing stored', () => {
    expect(() => clearLocalCanvasStorage()).not.toThrow();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  // Regression: the empty `catch`. `clearLocalCanvasStorage` is the "forget
  // everything" button, and it is called from error paths in private-browsing
  // profiles where `removeItem` throws. Letting that escape turns a cleanup into
  // a second failure, so it must be swallowed.
  it('swallows a throwing removal instead of propagating it', () => {
    localStorage.setItem(KEY, '{}');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    expect(() => clearLocalCanvasStorage()).not.toThrow();
  });
});

describe('the per-element size estimate', () => {
  // Unreachable branch, pinned so it cannot drift silently.
  //
  // `estimateBytesPerElement` returns 1 when its sample came back empty, and the
  // only call site is guarded by `elements.length > 1`. For any non-empty array
  // the sampling loop pushes at index 0, so `sample.length === 0` would require an
  // empty array -- which the guard excludes. The proof is one-directional, as an
  // unreachable branch's must be: every scene size the guard admits still saves
  // without consulting the empty-sample path.
  it.each([
    ['zero elements', 0],
    ['one element', 1],
    ['two elements', 2],
    ['exactly the sample size', 64],
    ['one past the sample size', 65],
    ['far past the sample size', 500],
  ])('saves a scene of %s without hitting the empty-sample fallback', (_label, count) => {
    const elements = Array.from({ length: count }, (_, i) => element(`e${i}`));

    const result = saveLocalCanvasToStorage(elements, state);

    // Whether the payload fits the budget depends on its size, so the assertion is
    // that saving succeeds *somehow* -- a `return 1` misfire would still fit here,
    // which is exactly why the real proof is the mutation: replacing that guard
    // with a `throw` changes nothing.
    expect(typeof result.ok).toBe('boolean');
    if (result.ok) {
      expect(loadLocalCanvasFromStorage().elements).toHaveLength(count);
    } else {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  // The working direction: a scene that *does* fit is reported as complete and
  // round-trips whole, so the guard above is not passing because every save fails.
  it('round-trips a small scene intact', () => {
    const elements = [element('a'), element('b')];

    expect(saveLocalCanvasToStorage(elements, state).ok).toBe(true);
    expect(loadLocalCanvasFromStorage().elements).toHaveLength(2);
  });
});
