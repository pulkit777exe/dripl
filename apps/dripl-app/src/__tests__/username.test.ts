import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateRandomUsername, getOrCreateCollaboratorName } from '@/utils/username';

/**
 * `utils/username.ts` mints the name a person is shown as inside a shared room.
 * It has no tests at all: all 39 statements were uncovered, so the only thing
 * standing between the product and a collaborator called `"   "` (or a
 * collaborator whose name changes on every render, which changes their avatar
 * colour with it) was nobody having looked.
 *
 * The function is a three-step precedence chain — `dripl_username` >
 * `dripl-collab` > a seeded generated name — and every step is a place where a
 * plausible refactor silently does the wrong thing:
 *
 *   - a stored value is returned *trimmed*, because it is typed by a person
 *     into a settings input and the padding rides along into a label;
 *   - a blank stored value is treated as *absent*, because an empty avatar
 *     initial (`""[0]`) is the visible symptom of not doing so;
 *   - the legacy key is read **and copied forward**, so the old write path is
 *     not consulted on every single load;
 *   - a corrupt legacy value degrades to a mint instead of throwing, because
 *     this is called during render (`CollaboratorsList.tsx`, and `RoughCanvas`'s
 *     `useState` initialiser) where a throw is a blank canvas;
 *   - the generated name is a pure function of `dripl_client_id`, so it is
 *     stable for a browser across calls *and* across module reloads.
 *
 * The two LABELLED tests at the end pin defects rather than behaviour: storage
 * access is unguarded, so a browser that refuses `localStorage` takes the render
 * down with it. Reported, not fixed.
 */

const USERNAME_KEY = 'dripl_username';
const LEGACY_KEY = 'dripl-collab';
const CLIENT_ID_KEY = 'dripl_client_id';

/** One word in Capitals, then one more: the shape both word lists always have. */
const MINTED_NAME = /^[A-Z][a-z]+ [A-Z][a-z]+$/;

function stored(key: string): string | null {
  return localStorage.getItem(key);
}

/** The legacy payload's own `username`, or `undefined` if it is not an object. */
function legacyUsername(): unknown {
  const raw = stored(LEGACY_KEY);
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as { username?: unknown }).username
    : undefined;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a name that was already chosen', () => {
  /**
   * Regression: the stored name is the one the user typed on the settings page.
   * Falling through to the mint path overwrites it, so a rename silently
   * reverts on the next visit to a room.
   */
  it('returns the stored name instead of minting over it', () => {
    localStorage.setItem(USERNAME_KEY, 'Ada Lovelace');

    expect(getOrCreateCollaboratorName()).toBe('Ada Lovelace');
    // Nothing was minted, so the legacy key was left alone too.
    expect(stored(LEGACY_KEY)).toBeNull();
  });

  /**
   * Regression: the value in storage carries whatever padding the input field
   * let through, and the same string is what `CollaboratorsList` renders and
   * what the avatar's colour is keyed off. Returning it untrimmed puts
   * `"  Ada  "` in front of everyone in the room.
   */
  it('trims a stored name that carries padding', () => {
    localStorage.setItem(USERNAME_KEY, '  Ada Lovelace  ');

    const name = getOrCreateCollaboratorName();

    expect(name).toBe('Ada Lovelace');
    expect(name).not.toMatch(/^\s|\s$/);
  });

  /**
   * Regression: a name of only whitespace is truthy, so a `if (dripl)` guard
   * returns it and the avatar initial — `name[0]` — becomes a space. The
   * `.trim()` in the condition is the whole difference between "Ada" and an
   * empty circle.
   */
  it('ignores a whitespace-only stored name and mints a real one', () => {
    localStorage.setItem(USERNAME_KEY, '   \t  ');

    const name = getOrCreateCollaboratorName();

    expect(name).not.toBe('');
    expect(name.trim()).toBe(name);
    expect(name).toMatch(MINTED_NAME);
    // And the junk is replaced, so the next load is not stuck on it.
    expect(stored(USERNAME_KEY)).toBe(name);
  });

  /**
   * Regression: the two keys hold the same fact at different vintages. Reading
   * the legacy one first resurrects the pre-rename name for everyone who had a
   * room open before the rename, and the two spellings then diverge forever.
   */
  it('prefers the current key over the legacy one', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ username: 'Old Name' }));
    localStorage.setItem(USERNAME_KEY, 'New Name');

    expect(getOrCreateCollaboratorName()).toBe('New Name');
  });
});

describe('the legacy dripl-collab key', () => {
  /**
   * Regression: the migration is the `setItem` inside the legacy branch. Without
   * it the legacy payload is re-read on every single load forever, and the
   * value the rest of the app reads (`dripl_username`) is never populated.
   */
  it('migrates a legacy name into the current key', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ username: '  Legacy Ada  ' }));

    expect(getOrCreateCollaboratorName()).toBe('Legacy Ada');
    expect(stored(USERNAME_KEY)).toBe('Legacy Ada');
  });

  /**
   * Regression: the legacy value is a name a person typed too, so it is trimmed
   * on the way in. This also pins that the migration writes the *trimmed* value:
   * migrating the raw one leaves the padding behind for the next load.
   */
  it('writes the trimmed value on migration, not the padded one', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ username: '\tLegacy Ada\n' }));

    getOrCreateCollaboratorName();

    expect(stored(USERNAME_KEY)).toBe('Legacy Ada');
  });

  /**
   * Regression: `JSON.parse` throws on anything the previous build did not
   * write — a truncated write, a value another tab replaced mid-write, a
   * hand-edited entry. Un-guarded, the `SyntaxError` escapes
   * `getOrCreateCollaboratorName`, which `CollaboratorsList` calls during
   * render, and one bad key becomes an unmountable room.
   */
  it('falls back to a minted name when the legacy value is not JSON', () => {
    localStorage.setItem(LEGACY_KEY, '{"username": "Ada');

    let name: string | null = null;
    expect(() => {
      name = getOrCreateCollaboratorName();
    }).not.toThrow();

    expect(name).toMatch(MINTED_NAME);
    expect(stored(USERNAME_KEY)).toBe(name);
  });

  /**
   * Regression: the guard is `parsed?.username?.trim()` — truthiness of a
   * *usable* name, not merely the presence of the key. Each shape below parses
   * without throwing but yields no name to show, and returning `parsed.username`
   * unchecked would put `undefined`, `null` or `'   '` in front of the room
   * (and `name[0]` of `undefined` in the avatar).
   */
  it.each([
    ['no username key', '{}'],
    ['a null username', '{"username":null}'],
    ['a whitespace username', '{"username":"   "}'],
    ['a numeric username', '{"username":7}'],
    ['a bare JSON string', '"Ada"'],
    ['a JSON number', '42'],
    ['JSON null', 'null'],
  ])('mints a real name when the legacy payload has %s', (_label, raw) => {
    localStorage.setItem(LEGACY_KEY, raw);

    const name = getOrCreateCollaboratorName();

    expect(name).toMatch(MINTED_NAME);
    expect(stored(USERNAME_KEY)).toBe(name);
  });

  /**
   * Regression: the legacy payload is the only place the old app recorded a
   * name, so this branch is the one time it is read. A mint that did not write
   * the legacy key back would mean anything still reading it — an older tab,
   * a stale service worker — sees nothing at all.
   */
  it('writes the minted name back to both keys', () => {
    const name = getOrCreateCollaboratorName();

    expect(name).toMatch(MINTED_NAME);
    expect(stored(USERNAME_KEY)).toBe(name);
    expect(legacyUsername()).toBe(name);
  });
});

describe('the generated name', () => {
  /**
   * Regression: the name is a function of the client id, not of the clock or
   * `Math.random()`. If the seed ever became time- or entropy-derived, every
   * call would return a different name and a collaborator's avatar initial and
   * colour would change under the room.
   */
  it('is stable for a given client id', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'dripl-fixed-client-id');

    const first = generateRandomUsername();
    const second = generateRandomUsername();

    expect(first).toMatch(MINTED_NAME);
    expect(second).toBe(first);
  });

  /**
   * Regression: "stable for a given browser" has to survive the module being
   * re-evaluated — a client-side navigation, a Fast Refresh, or a client
   * component re-render after hydration all produce a fresh module instance.
   * A seed cached in module scope (or derived from `Math.random()` at call
   * time) passes the test above and fails this one.
   */
  it('is the same after the module is re-evaluated', async () => {
    localStorage.setItem(CLIENT_ID_KEY, 'dripl-fixed-client-id');
    const before = generateRandomUsername();

    vi.resetModules();
    const reimported = await import('@/utils/username');

    expect(reimported.generateRandomUsername()).toBe(before);
  });

  /**
   * Regression: the id is minted once and then persisted. If the `setItem` is
   * dropped, every call mints a fresh id and so a fresh name, and the stability
   * above holds only within a single call.
   */
  it('mints and persists a client id when the browser has none', () => {
    expect(stored(CLIENT_ID_KEY)).toBeNull();

    getOrCreateCollaboratorName();

    const id = stored(CLIENT_ID_KEY);
    expect(id).not.toBeNull();
    expect(id).toMatch(/^dripl-/);
  });

  /**
   * Regression: a client id that already exists must be reused rather than
   * replaced. Overwriting it would change the seed and therefore the name on
   * every visit — the exact instability the key exists to prevent.
   */
  it('keeps an existing client id rather than replacing it', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'dripl-keep-me');

    generateRandomUsername();

    expect(stored(CLIENT_ID_KEY)).toBe('dripl-keep-me');
  });

  /**
   * Regression: the second read of the name in one visit must come from storage
   * and not from a fresh mint. `RoughCanvas` reads it in a `useState`
   * initialiser and `CollaboratorsList` reads it on every render, so a
   * non-persisted mint would give the same browser two different names in one
   * screen.
   */
  it('reads back the name it just minted', () => {
    const first = getOrCreateCollaboratorName();
    const second = getOrCreateCollaboratorName();

    expect(second).toBe(first);
  });
});

describe('without a browser', () => {
  /**
   * Regression: this module is imported by client components that Next also
   * renders on the server for the initial HTML. `localStorage` does not exist
   * there, so without the guard the first server render throws a
   * `ReferenceError` and the page 500s.
   */
  it('answers Anonymous when there is no window', () => {
    vi.stubGlobal('window', undefined);

    expect(getOrCreateCollaboratorName()).toBe('Anonymous');
  });

  /**
   * Regression: the same guard, one level down in `getClientId`. It answers
   * `'default'` rather than `'Anonymous'` — so the name is still minted, from a
   * seed every server render agrees on. Without it, rendering this on the
   * server throws on the unguarded `localStorage` read.
   */
  it('still mints a stable name when there is no window', () => {
    vi.stubGlobal('window', undefined);

    const first = generateRandomUsername();

    expect(first).toMatch(MINTED_NAME);
    expect(generateRandomUsername()).toBe(first);
  });
});

describe('LABELLED — storage that is refused', () => {
  /**
   * LABELLED — known defect, pinned as it behaves today.
   *
   * Both exported functions read `localStorage` with no `try`. A browser that
   * refuses storage throws out of `getOrCreateCollaboratorName`, and its two
   * call sites are unguarded and during render (`CollaboratorsList.tsx:92`,
   * `RoughCanvas.tsx:59`'s `useState` initialiser), so the room unmounts
   * rather than showing a name-less avatar. Reachable when storage is blocked
   * (a sandboxed iframe, cookies/storage disabled for the site) and, on the
   * write side, in a private-mode quota.
   *
   * Reported, not fixed. This test fails the moment a guard is added, which is
   * the intended direction: the fix has to be a decision.
   */
  it('LABELLED propagates a SecurityError when reading localStorage is denied', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('storage is denied', 'SecurityError');
    });

    expect(() => getOrCreateCollaboratorName()).toThrow(DOMException);
  });

  /**
   * LABELLED — the same defect on the write side. `setItem` throws
   * `QuotaExceededError` when the origin's quota is exhausted (private browsing
   * on older Safari is the classic case), so the *return* value is fine but the
   * call still throws.
   */
  it('LABELLED propagates a QuotaExceededError when persisting the name fails', () => {
    // The original is captured only so the spy is unmistakably a replacement,
    // never a pass-through that would recurse into itself.
    const realSetItem = Storage.prototype.setItem;
    expect(typeof realSetItem).toBe('function');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    expect(() => getOrCreateCollaboratorName()).toThrow(DOMException);
  });
});
