import { describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import {
  applyRestoredAppState,
  isHexColor,
  reconcileScene,
  restoreAppState,
  restoredSceneMap,
  restoreElements,
  serializeScene,
  type AppStateActions,
  type RestoredAppState,
} from '@/lib/scene';

/**
 * The appearance half of `lib/scene`: the tool-palette fields a user can leave
 * half-configured in localStorage, and the setters they flow into.
 *
 * These are the fields with the widest gap between "survives validation" and
 * "reaches the store" — `restoreAppState` allowlists a field and
 * `applyRestoredAppState` decides independently whether to call its setter —
 * so both halves are tested together against the same fixtures.
 */

const rect = (id: string, extra: Partial<DriplElement> = {}): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    ...extra,
  }) as DriplElement;

describe('restoreAppState — appearance fields', () => {
  it('keeps a valid appearance value and rejects each invalid spelling', () => {
    // One row per field: the first entry must survive, every later one must be
    // dropped. Written as a table so a field cannot be "covered" by the
    // neighbouring field's truthy case.
    const rows: Array<[keyof RestoredAppState, unknown, unknown]> = [
      ['currentStrokeColor', '#6965db', 7],
      ['currentBackgroundColor', '#FAFAF7', null],
      ['currentStrokeWidth', 4, '4'],
      ['currentRoughness', 1.5, Number.NaN],
      ['currentStrokeStyle', 'dotted', 'zigzag'],
      ['currentFillStyle', 'cross-hatch', 'spiral'],
    ];

    for (const [key, valid, invalid] of rows) {
      expect(restoreAppState({ [key]: valid })).toEqual({ [key]: valid });
      expect(restoreAppState({ [key]: invalid })).toEqual({});
    }
  });

  it('drops a non-finite pan as a pair, not as a half-set value', () => {
    // Both pan axes arrive together, so one bad axis must discard the pair
    // rather than leave panX applied with a stale panY.
    expect(restoreAppState({ panX: 1, panY: Number.NaN })).toEqual({});
    expect(restoreAppState({ panX: Number.POSITIVE_INFINITY, panY: 2 })).toEqual({});
    // The typeof gate is separate from the finiteness gate: NaN is a number.
    expect(restoreAppState({ panX: 1, panY: '2' })).toEqual({});
    expect(restoreAppState({ panX: 3, panY: 4 })).toEqual({ panX: 3, panY: 4 });
  });
});

describe('applyRestoredAppState — appearance setters', () => {
  /** Records every setter call as [name, args] so order and payload are both visible. */
  function recorder() {
    const seen: Array<[string, unknown[]]> = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        seen.push([name, args]);
      };
    const actions: AppStateActions = {
      setTheme: record('setTheme'),
      setZoom: record('setZoom'),
      setPan: record('setPan'),
      setGridEnabled: record('setGridEnabled'),
      setGridSize: record('setGridSize'),
      setCurrentStrokeColor: record('setCurrentStrokeColor'),
      setCurrentBackgroundColor: record('setCurrentBackgroundColor'),
      setCurrentStrokeWidth: record('setCurrentStrokeWidth'),
      setCurrentRoughness: record('setCurrentRoughness'),
      setCurrentStrokeStyle: record('setCurrentStrokeStyle'),
      setCurrentFillStyle: record('setCurrentFillStyle'),
      setActiveTool: record('setActiveTool'),
      setCanvasBackground: record('setCanvasBackground'),
    };
    return { seen, actions };
  }

  const appearance: RestoredAppState = {
    currentStrokeColor: '#6965db',
    currentBackgroundColor: '#FAFAF7',
    currentStrokeWidth: 4,
    currentRoughness: 1.5,
    currentStrokeStyle: 'dotted',
    currentFillStyle: 'cross-hatch',
    activeTool: 'diamond',
  };

  it('calls every appearance setter exactly once with the restored value', () => {
    const { seen, actions } = recorder();
    applyRestoredAppState(appearance, actions);

    expect(seen).toEqual([
      ['setCurrentStrokeColor', ['#6965db']],
      ['setCurrentBackgroundColor', ['#FAFAF7']],
      ['setCurrentStrokeWidth', [4]],
      ['setCurrentRoughness', [1.5]],
      ['setCurrentStrokeStyle', ['dotted']],
      ['setCurrentFillStyle', ['cross-hatch']],
      ['setActiveTool', ['diamond']],
    ]);
  });

  it('calls the grid and zoom setters the appearance set does not carry', () => {
    // The complementary direction: the appearance fields must not have reached
    // these setters, which is why the assertions below check both the presence
    // and the *absence* of each call rather than only that "something happened".
    const { seen, actions } = recorder();
    applyRestoredAppState({ ...appearance, zoom: 2, gridEnabled: true, gridSize: 20 }, actions);

    expect(seen.map(([name]) => name)).toEqual([
      'setZoom',
      'setGridEnabled',
      'setGridSize',
      'setCurrentStrokeColor',
      'setCurrentBackgroundColor',
      'setCurrentStrokeWidth',
      'setCurrentRoughness',
      'setCurrentStrokeStyle',
      'setCurrentFillStyle',
      'setActiveTool',
    ]);
  });

  it('leaves a zero width and roughness alone, but accepts them from restore', () => {
    // `typeof x === 'number'` is the gate, so 0 is applied. Asserted in both
    // directions: the value must come through *and* the missing case must not.
    const { seen, actions } = recorder();
    applyRestoredAppState({ currentStrokeWidth: 0, currentRoughness: 0 }, actions);
    expect(seen).toEqual([
      ['setCurrentStrokeWidth', [0]],
      ['setCurrentRoughness', [0]],
    ]);

    const empty = recorder();
    applyRestoredAppState({}, empty.actions);
    expect(empty.seen).toEqual([]);
  });

  it('ignores an empty colour string even though restoreAppState keeps it', () => {
    // Documented asymmetry, not a preference: the setter is guarded by
    // truthiness while the validator accepts any string, so `''` survives
    // validation and is then dropped at apply time. Asserted from both sides
    // so a change to either guard shows up here.
    expect(restoreAppState({ currentStrokeColor: '' })).toEqual({ currentStrokeColor: '' });
    const { seen, actions } = recorder();
    applyRestoredAppState({ currentStrokeColor: '' }, actions);
    expect(seen).toEqual([]);
  });

  it('tolerates a caller that supplied no setters at all', () => {
    expect(() => applyRestoredAppState(appearance, {})).not.toThrow();
  });
});

describe('isHexColor', () => {
  it('accepts 3-to-8 digit hex and nothing longer', () => {
    // The length cap is 9 characters, i.e. `#` plus at most 8 hex digits.
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#6965db')).toBe(true);
    expect(isHexColor('#6965dbff')).toBe(true);
    expect(isHexColor('#6965dbffff')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#gg0000')).toBe(false);
  });
});

describe('restoreElements — hostile input', () => {
  /**
   * An element whose `type` getter throws. `normalizeElement` spreads the
   * element, so the throw happens inside it and the per-element `try/catch` is
   * the only thing between a single bad record and the whole restore.
   */
  function unreadableElement(): unknown {
    return {
      id: 'boom',
      get type(): never {
        throw new Error('unreadable element type');
      },
    };
  }

  it('keeps the readable elements and drops the one that throws', () => {
    const out = restoreElements([rect('a', { fractionalIndex: 'a0' }), unreadableElement()]);
    expect(out.map(e => e.id)).toEqual(['a']);
  });

  it('treats a non-array payload as an empty scene', () => {
    // The `Array.isArray` guard, not a truthiness one: a JSON object with a
    // numeric `length` must not be iterated as a scene.
    expect(restoreElements(undefined)).toEqual([]);
    expect(restoreElements('nope')).toEqual([]);
    expect(restoreElements({ 0: rect('a'), length: 1 })).toEqual([]);
  });
});

describe('serializeScene', () => {
  it('round-trips a scene through JSON', () => {
    const elements = [rect('b', { fractionalIndex: 'a1' }), rect('a', { fractionalIndex: 'a0' })];
    const restored = restoreElements(JSON.parse(serializeScene(elements)));

    expect(restored.map(e => e.id)).toEqual(['a', 'b']);
    // Whole-payload JSON, not a delta: the ids and geometry survive verbatim.
    expect(JSON.parse(serializeScene(elements))).toEqual(elements);
    expect(serializeScene([])).toBe('[]');
  });
});

describe('restoredSceneMap', () => {
  it('keys every restored element by id', () => {
    const elements = restoreElements([rect('a', { fractionalIndex: 'a0' }), rect('b')]);
    const map = restoredSceneMap(elements);

    expect(map).toBeInstanceOf(Map);
    expect([...map.keys()]).toEqual(elements.map(e => e.id));
    expect(map.get('a')).toEqual(elements.find(e => e.id === 'a'));
    expect(restoredSceneMap([]).size).toBe(0);
  });
});

describe('reconcileScene — stale adds', () => {
  it('refuses a stale add for an id already present locally', () => {
    // The add path runs the same version/nonce fence as the update path. A
    // stale add must leave both the map and `changed` untouched — asserted
    // through the outgoing map so a silently-accepted stale add cannot hide.
    const local = rect('e', { version: 3, versionNonce: 10 });
    const stale = rect('e', { version: 2, versionNonce: 1 });

    const refused = reconcileScene({
      localById: new Map([['e', local]]),
      added: [stale],
      updated: [],
      deleted: [],
    });
    expect(refused.changed).toBe(false);
    expect(refused.nextById.get('e')).toBe(local);
    expect(refused.appliedDeleted).toEqual([]);

    const accepted = reconcileScene({
      localById: new Map([['e', local]]),
      added: [rect('e', { version: 4, versionNonce: 1 })],
      updated: [],
      deleted: [],
    });
    expect(accepted.changed).toBe(true);
    expect(accepted.nextById.get('e')!.version).toBe(4);
  });

  it('records a delete for an id that was never present', () => {
    // The delete itself is the stale-add signal, so an absent id must still be
    // reported in `appliedDeleted` while leaving `changed` false.
    const out = reconcileScene({
      localById: new Map(),
      added: [],
      updated: [],
      deleted: ['never-existed'],
    });
    expect(out.appliedDeleted).toEqual(['never-existed']);
    expect(out.changed).toBe(false);
    expect(out.nextById.size).toBe(0);
  });

  it('leaves the input map untouched', () => {
    const localById = new Map([['e', rect('e')]]);
    const before = localById.get('e');
    reconcileScene({
      localById,
      added: [rect('f')],
      updated: [],
      deleted: ['e'],
    });
    expect(localById.get('e')).toBe(before);
    expect(localById.has('f')).toBe(false);
  });

  it('skips the delete loop entirely for an empty delete list', () => {
    const isLocked = vi.fn(() => false);
    const out = reconcileScene({
      localById: new Map([['e', rect('e')]]),
      added: [],
      updated: [],
      deleted: [],
      isLocked,
    });
    expect(out.appliedDeleted).toEqual([]);
    // Nothing to consider, so the lock predicate was never consulted.
    expect(isLocked).not.toHaveBeenCalled();
  });
});
