import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';

/**
 * `canvas-db` — the durable IndexedDB mirror, which is the copy that *wins* on
 * the next load (see `CanvasBootstrap` local mode).
 *
 * There is no `fake-indexeddb` in this repo and no real IndexedDB in jsdom, so
 * `idb`'s `openDB` is replaced with a small in-memory store. The fake is
 * deliberately a *store* rather than a set of stubs — `put`/`get`/`delete`/
 * `getAll` go through a Map — so a key written by one call can be read or
 * missed by another, which is how the key-agreement defects below are visible.
 *
 * What is pinned here is the contract the callers depend on: a failure is
 * reported, never thrown at them (`CanvasBootstrap` has a localStorage fallback
 * precisely because IndexedDB can be unavailable), a read is never partial, and
 * a write is not reported as done before the transaction commits.
 */

const openDB = vi.fn();

vi.mock('idb', () => ({
  openDB: (...args: unknown[]) => openDB(...args),
}));

vi.mock('@dripl/common', async importOriginal => ({
  ...(await importOriginal<typeof import('@dripl/common')>()),
  // Stubbed only to keep expected failures out of the test output. Nothing here
  // asserts on log output: the contract under test is the value returned to the
  // caller, not the log line.
  logError: vi.fn(),
}));

interface StoredRecord {
  roomId: string;
  elements: DriplElement[];
  lastModified: number;
}

interface FakeDb {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

function createFakeDb() {
  const records = new Map<string, StoredRecord>();
  const stores: { name: string; keyPath?: string }[] = [];

  const db: FakeDb = {
    objectStoreNames: { contains: (name: string) => stores.some(s => s.name === name) },
    createObjectStore: vi.fn((name: string, opts?: { keyPath?: string }) => {
      stores.push({ name, keyPath: opts?.keyPath });
      return {};
    }),
    put: vi.fn(async (_store: string, value: StoredRecord) => {
      records.set(value.roomId, value);
    }),
    get: vi.fn(async (_store: string, key: string) => records.get(key)),
    delete: vi.fn(async (_store: string, key: string) => {
      records.delete(key);
    }),
    getAll: vi.fn(async () => [...records.values()]),
  };

  return { db, records, stores };
}

/** Wire `openDB` to a fresh fake, running the real `upgrade` callback. */
function useFakeDb(options: { openRejects?: boolean } = {}) {
  const fake = createFakeDb();
  openDB.mockImplementation(
    async (_name: string, _version: number, opts?: { upgrade?: unknown }) => {
      if (options.openRejects) throw new Error('IndexedDB is unavailable (private mode)');
      const upgrade = opts?.upgrade as ((db: FakeDb) => void) | undefined;
      upgrade?.(fake.db);
      return fake.db;
    }
  );
  return fake;
}

/**
 * `canvas-db` caches its connection promise in module scope, so each test needs
 * a fresh module instance to control whether `openDB` is called at all.
 */
async function loadModule() {
  vi.resetModules();
  return import('@/lib/canvas-db');
}

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

/** Let a promise chain run to its first real await point. */
async function flushMicrotasks(turns = 6) {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

beforeEach(() => {
  openDB.mockReset();
});

describe('connection', () => {
  it('creates the room store with a roomId key path on first open', async () => {
    // Regression: the store is created in the `upgrade` callback with
    // `keyPath: 'roomId'`. If that callback is dropped or the key path changed,
    // every `put` on a real browser's first visit throws NotFoundError and
    // nothing is ever persisted — the local mirror silently does not exist.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB } = await loadModule();

    await saveCanvasToIndexedDB('room-1', [element('a')]);

    expect(fake.db.createObjectStore).toHaveBeenCalledWith('canvas-rooms', { keyPath: 'roomId' });
    expect(fake.records.has('room-1')).toBe(true);
  });

  it('opens the database once and reuses the connection', async () => {
    // Regression: the mirror runs on every settled stroke. Opening the database
    // per call turns each of those into a fresh `open` round trip, which is the
    // cost the cached promise exists to avoid.
    useFakeDb();
    const { saveCanvasToIndexedDB, loadCanvasFromIndexedDB } = await loadModule();

    await saveCanvasToIndexedDB('room-1', [element('a')]);
    await loadCanvasFromIndexedDB('room-1');
    await saveCanvasToIndexedDB('room-1', [element('b')]);

    expect(openDB).toHaveBeenCalledTimes(1);
  });

  it('does not recreate the store on a later open', async () => {
    // Regression: `createObjectStore` on an existing store throws
    // ConstraintError during upgrade, so the `contains` guard is what keeps a
    // version bump from bricking the mirror.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB } = await loadModule();

    await saveCanvasToIndexedDB('room-1', [element('a')]);
    const upgrade = openDB.mock.calls[0]![2] as { upgrade: (db: FakeDb) => void };
    upgrade.upgrade(fake.db);

    expect(fake.db.createObjectStore).toHaveBeenCalledTimes(1);
  });
});

describe('saveCanvasToIndexedDB', () => {
  it('stores the whole scene normalised, keyed by a bounded room id', async () => {
    // Regression: two things at once. The key is truncated to 100 characters
    // because a long room id from a URL becomes an oversized IndexedDB key;
    // and elements are normalised on the way in, because the mirror is what
    // wins on the next load and a stored element missing geometry comes back
    // blank.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB } = await loadModule();
    const longRoomId = 'r'.repeat(150);

    const saved = await saveCanvasToIndexedDB(longRoomId, [
      element('full'),
      { id: 'legacy', type: 'rectangle' } as unknown as DriplElement,
    ]);

    expect(saved).toBe(true);
    const record = fake.records.get('r'.repeat(100))!;
    expect(record.roomId).toBe('r'.repeat(100));
    expect(record.elements.map(e => e.id)).toContain('legacy');
    expect(record.elements.find(e => e.id === 'legacy')).toMatchObject({
      width: 100,
      height: 100,
      strokeColor: '#000000',
    });
    expect(record.lastModified).toBeGreaterThan(0);
  });

  it('replaces the previous snapshot instead of merging into it', async () => {
    // Regression: `put` on a keyPath store is a whole-record replace. If this
    // became an add, a deleted element would come back on the next load.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB } = await loadModule();

    await saveCanvasToIndexedDB('room-1', [element('a'), element('b')]);
    await saveCanvasToIndexedDB('room-1', [element('a')]);

    expect(fake.records.get('room-1')!.elements.map(e => e.id)).toEqual(['a']);
  });

  it('refuses an over-cap scene rather than truncating it', async () => {
    // Regression: this copy wins on the next load. Writing a truncated scene
    // would replace a complete snapshot with a shorter one that looks valid,
    // and the user would come back to a canvas missing its last N elements.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB, MAX_PERSISTED_ELEMENTS } = await loadModule();
    const tooMany = Array.from({ length: MAX_PERSISTED_ELEMENTS + 1 }, (_, i) => element(`e${i}`));

    const saved = await saveCanvasToIndexedDB('room-1', tooMany);

    expect(saved).toBe(false);
    expect(fake.db.put).not.toHaveBeenCalled();
    expect(fake.records.size).toBe(0);
  });

  it('accepts a scene sitting exactly on the cap', async () => {
    // The control for the test above: an off-by-one in the comparison would
    // reject the largest scene the mirror is documented to allow.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB, MAX_PERSISTED_ELEMENTS } = await loadModule();
    const atCap = Array.from({ length: MAX_PERSISTED_ELEMENTS }, (_, i) => ({ id: `e${i}` }));

    expect(await saveCanvasToIndexedDB('room-1', atCap as DriplElement[])).toBe(true);
    expect(fake.records.get('room-1')!.elements).toHaveLength(MAX_PERSISTED_ELEMENTS);
  });

  it('reports failure instead of throwing when the write is rejected', async () => {
    // Regression: a quota error or private-mode write must not take down the
    // caller. `CanvasBootstrap` awaits this inside its mirror loop, and an
    // exception there would abort the loop instead of degrading to the
    // localStorage copy.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB } = await loadModule();
    fake.db.put.mockRejectedValueOnce(new Error('QuotaExceededError'));

    const saved = await saveCanvasToIndexedDB('room-1', [element('a')]);

    expect(saved).toBe(false);
  });

  it('does not report success before the write commits', async () => {
    // Regression: `db.put` resolves when the transaction commits. Returning
    // early — or not awaiting it — would let the caller believe a stroke is
    // durably stored while it is still only in memory, which is precisely the
    // loss a reload after that point would cause.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB } = await loadModule();
    let commit: () => void = () => {};
    fake.db.put.mockImplementationOnce(() => new Promise<void>(resolve => (commit = resolve)));

    let settled: boolean | null = null;
    const saving = saveCanvasToIndexedDB('room-1', [element('a')]).then(result => {
      settled = result;
      return result;
    });

    await flushMicrotasks();
    expect(settled).toBeNull();

    commit();
    await expect(saving).resolves.toBe(true);
  });

  it('reports failure, not an exception, when the database cannot be opened', async () => {
    // Regression: private browsing and blocked storage make `openDB` reject.
    // That is the case `CanvasBootstrap`'s localStorage fallback exists for, so
    // it has to arrive as `false` at the call site.
    useFakeDb({ openRejects: true });
    const { saveCanvasToIndexedDB } = await loadModule();

    await expect(saveCanvasToIndexedDB('room-1', [element('a')])).resolves.toBe(false);
  });

  // REPORTED, not endorsed: the cached promise keeps the *rejected* connection,
  // so one failed open disables the mirror for the rest of the session even if
  // storage becomes available again (a quota prompt accepted mid-session, a
  // second tab's cleanup, an extension's storage policy expiring). This test
  // pins the current behaviour so a fix is a visible change.
  it('keeps a failed connection cached instead of retrying it', async () => {
    const fake = useFakeDb({ openRejects: true });
    const { saveCanvasToIndexedDB } = await loadModule();

    expect(await saveCanvasToIndexedDB('room-1', [element('a')])).toBe(false);

    // Storage recovers: `openDB` would now succeed.
    fake.db.createObjectStore.mockClear();
    openDB.mockImplementation(async (_n: string, _v: number, opts?: { upgrade?: unknown }) => {
      const upgrade = opts?.upgrade as ((db: FakeDb) => void) | undefined;
      upgrade?.(fake.db);
      return fake.db;
    });

    expect(await saveCanvasToIndexedDB('room-1', [element('a')])).toBe(false);
    expect(openDB).toHaveBeenCalledTimes(1);
    expect(fake.records.size).toBe(0);
  });
});

describe('loadCanvasFromIndexedDB', () => {
  it('reads the scene back whole and in order', async () => {
    // Regression: this is the copy that wins on open, and z-order is the
    // document. A read that reversed, dropped or reordered elements would show
    // the user's canvas with its stacking changed.
    useFakeDb();
    const { saveCanvasToIndexedDB, loadCanvasFromIndexedDB } = await loadModule();
    await saveCanvasToIndexedDB('room-1', [element('a'), element('b'), element('c')]);

    const loaded = await loadCanvasFromIndexedDB('room-1');

    expect(loaded.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads nothing for a room that was never saved', async () => {
    // Regression: a first visit has no record at all. Returning `undefined` or
    // throwing here would send `CanvasBootstrap`'s local mode down an error
    // path instead of its localStorage fallback.
    useFakeDb();
    const { loadCanvasFromIndexedDB } = await loadModule();

    expect(await loadCanvasFromIndexedDB('never-saved')).toEqual([]);
  });

  it('reads nothing from a record whose elements are not a list', async () => {
    // Regression: `elements` is a cast at the storage boundary. A record
    // written by another build, or truncated by a crash, must not resolve to a
    // partial element list — the caller's fallback is "no cache", not "half a
    // document".
    const fake = useFakeDb();
    const { loadCanvasFromIndexedDB } = await loadModule();
    fake.records.set('broken', {
      roomId: 'broken',
      elements: 'corrupt' as unknown as DriplElement[],
      lastModified: 1,
    });

    expect(await loadCanvasFromIndexedDB('broken')).toEqual([]);
  });

  it('normalises what it reads, so a stale record cannot render blank', async () => {
    // Regression: a record written by an older build may lack fields the current
    // renderer reads. Reading it raw would show an invisible element that the
    // user cannot select to delete.
    const fake = useFakeDb();
    const { loadCanvasFromIndexedDB } = await loadModule();
    fake.records.set('old', {
      roomId: 'old',
      elements: [{ id: 'legacy', type: 'rectangle' } as unknown as DriplElement],
      lastModified: 1,
    });

    expect((await loadCanvasFromIndexedDB('old'))[0]).toMatchObject({
      id: 'legacy',
      width: 100,
      height: 100,
      strokeColor: '#000000',
    });
  });

  it('bounds what it hands back from an oversized record', async () => {
    // Regression: the cap is enforced on write, but a record can predate the
    // current cap or arrive from another build. Loading it whole would hand an
    // unbounded array to the renderer and to the save path on the next stroke.
    const fake = useFakeDb();
    const { loadCanvasFromIndexedDB, MAX_PERSISTED_ELEMENTS } = await loadModule();
    fake.records.set('huge', {
      roomId: 'huge',
      elements: Array.from({ length: MAX_PERSISTED_ELEMENTS + 10 }, (_, i) => ({
        id: `e${i}`,
      })) as DriplElement[],
      lastModified: 1,
    });

    expect(await loadCanvasFromIndexedDB('huge')).toHaveLength(MAX_PERSISTED_ELEMENTS);
  });

  it('reads under the same key the save wrote', async () => {
    // Regression: save and load each truncate the room id independently. If
    // either stopped, or they truncated differently, every save would be
    // invisible on the next load — the mirror would look like it worked.
    useFakeDb();
    const { saveCanvasToIndexedDB, loadCanvasFromIndexedDB } = await loadModule();
    const longRoomId = 'r'.repeat(150);

    await saveCanvasToIndexedDB(longRoomId, [element('a')]);

    expect((await loadCanvasFromIndexedDB(longRoomId)).map(e => e.id)).toEqual(['a']);
  });

  it('reports failure instead of throwing when the read is rejected', async () => {
    // Regression: private-mode IndexedDB rejects the read too. `CanvasBootstrap`
    // awaits this on the local path *outside* its try/catch, so a rejection here
    // would skip the localStorage fallback entirely and leave a blank canvas.
    const fake = useFakeDb();
    const { loadCanvasFromIndexedDB } = await loadModule();
    fake.db.get.mockRejectedValueOnce(new Error('UnknownError: storage unavailable'));

    await expect(loadCanvasFromIndexedDB('room-1')).resolves.toEqual([]);
  });
});

describe('clearCanvasFromIndexedDB', () => {
  it('removes the room so the next open falls through to the local copy', async () => {
    // Regression: clearing is how "start a new canvas in this room" is
    // implemented for a locally mirrored room. If the delete silently missed,
    // the cleared room would come back from the mirror on the next open.
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB, loadCanvasFromIndexedDB, clearCanvasFromIndexedDB } =
      await loadModule();
    await saveCanvasToIndexedDB('room-1', [element('a')]);

    await clearCanvasFromIndexedDB('room-1');

    expect(fake.db.delete).toHaveBeenCalledWith('canvas-rooms', 'room-1');
    expect(await loadCanvasFromIndexedDB('room-1')).toEqual([]);
  });

  it('reports a failed delete to the caller instead of swallowing it', async () => {
    // Regression: the one deliberate asymmetry in this module — `save` and
    // `load` report failure as a value, `clear` rejects. A caller that clears a
    // room and then reports success has told the user something untrue, so the
    // rejection must survive to it.
    const fake = useFakeDb();
    const { clearCanvasFromIndexedDB } = await loadModule();
    const failure = new Error('delete failed');
    fake.db.delete.mockRejectedValueOnce(failure);

    await expect(clearCanvasFromIndexedDB('room-1')).rejects.toBe(failure);
  });

  // REPORTED, not endorsed: `clear` passes the room id through untruncated,
  // while `save` and `load` both truncate it to 100 characters. For a room id
  // longer than that, the delete therefore targets a key that was never
  // written: the record survives, and no retry of the same call can remove it.
  // Nothing in the repo calls `clear` today, so this is latent rather than
  // user-visible; it becomes one the moment a room id from a URL reaches it.
  it('does not remove a long room id saved under its truncated key', async () => {
    const fake = useFakeDb();
    const { saveCanvasToIndexedDB, loadCanvasFromIndexedDB, clearCanvasFromIndexedDB } =
      await loadModule();
    const longRoomId = 'r'.repeat(150);
    await saveCanvasToIndexedDB(longRoomId, [element('a')]);

    await clearCanvasFromIndexedDB(longRoomId);

    expect(fake.db.delete).toHaveBeenCalledWith('canvas-rooms', longRoomId);
    expect((await loadCanvasFromIndexedDB(longRoomId)).map(e => e.id)).toEqual(['a']);
  });
});

describe('getAllCanvasRooms', () => {
  it('lists every stored room', async () => {
    // Regression: this is the enumeration a "your recent canvases" list needs.
    // Returning one record — or only the newest — would show the user a partial
    // list with nothing indicating the rest is missing.
    useFakeDb();
    const { saveCanvasToIndexedDB, getAllCanvasRooms } = await loadModule();
    await saveCanvasToIndexedDB('room-1', [element('a')]);
    await saveCanvasToIndexedDB('room-2', [element('b')]);

    const rooms = await getAllCanvasRooms();

    expect(rooms.map(r => r.roomId).sort()).toEqual(['room-1', 'room-2']);
    expect(rooms.every(r => r.lastModified > 0)).toBe(true);
  });

  it('lists nothing rather than throwing when the enumeration fails', async () => {
    // Regression: same contract as `load`. A rejection here would propagate into
    // a listing effect and, unhandled, blank the list for the session.
    const fake = useFakeDb();
    const { getAllCanvasRooms } = await loadModule();
    fake.db.getAll.mockRejectedValueOnce(new Error('store unavailable'));

    await expect(getAllCanvasRooms()).resolves.toEqual([]);
  });
});
