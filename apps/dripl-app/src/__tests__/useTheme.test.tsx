import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `useTheme` — the theme the user actually sees.
 *
 * Three rules, each of which has a user-visible failure:
 *
 *   1. An explicit stored preference beats the system preference. Otherwise the
 *      OS flipping to dark silently overrides a deliberate light theme.
 *   2. The `matchMedia` change listener exists only while the preference is
 *      `system`, and it is removed on unmount and when the preference changes.
 *      A listener that outlives its condition means the OS can override a
 *      choice the user has already made, and navigating between pages
 *      accumulates listeners.
 *   3. Anything that is not a theme falls back rather than propagating an
 *      unknown value into the theme state the canvas chrome reads.
 *
 * `next-themes` is stubbed, because what is under test is this hook's decision
 * logic, not the library's. The store is the real one, seeded with
 * `setState`.
 */

const themeState = vi.hoisted(() => ({
  theme: undefined as string | undefined,
  resolvedTheme: undefined as string | undefined,
  setTheme: vi.fn(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: themeState.theme,
    resolvedTheme: themeState.resolvedTheme,
    setTheme: themeState.setTheme,
  }),
}));

import { useCanvasStore } from '@/lib/store';
import { useTheme } from '@/hooks/useTheme';

type ChangeListener = () => void;

/** jsdom's `matchMedia` never changes and records no listeners, so it is replaced. */
function stubSystemTheme(initial: 'light' | 'dark') {
  const state = {
    system: initial,
    listeners: new Set<ChangeListener>(),
    added: 0,
    removed: 0,
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return state.system === 'dark';
      },
      addEventListener: (_type: string, listener: ChangeListener) => {
        state.listeners.add(listener);
        state.added += 1;
      },
      removeEventListener: (_type: string, listener: ChangeListener) => {
        state.listeners.delete(listener);
        state.removed += 1;
      },
      onchange: null,
      dispatchEvent: () => true,
    }))
  );

  /** Flip the OS preference and fire the change event, as a browser would. */
  return {
    state,
    flip(next: 'light' | 'dark') {
      state.system = next;
      act(() => {
        for (const listener of [...state.listeners]) listener();
      });
    },
  };
}

function setSearch(search: string) {
  window.history.replaceState({}, '', search === '' ? '/' : `/${search}`);
}

beforeEach(() => {
  themeState.theme = undefined;
  themeState.resolvedTheme = undefined;
  themeState.setTheme.mockClear();
  useCanvasStore.setState({ theme: 'light' });
  setSearch('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSearch('');
});

describe('preference beats system', () => {
  it('shows dark when dark was chosen and the system says light', () => {
    // Regression: `getEffectiveTheme` answering with the system value here would
    // render the whole app light against an explicit choice, and the mismatch
    // would look like the theme toggle not working.
    themeState.theme = 'dark';
    themeState.resolvedTheme = 'dark';
    const system = stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
    expect(result.current.isDark).toBe(true);
    expect(result.current.isLight).toBe(false);
    expect(result.current.isSystem).toBe(false);
    expect(system.state.added).toBe(0);
  });

  it('shows light when light was chosen and the system says dark', () => {
    // The control for the test above: the preference has to win in both
    // directions, or `isLight` becomes unreachable on a dark-mode machine.
    themeState.theme = 'light';
    themeState.resolvedTheme = 'light';
    stubSystemTheme('dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('light');
    expect(result.current.isLight).toBe(true);
  });

  it('answers with the stored preference while the resolved theme is unknown', () => {
    // Regression: `resolvedTheme` is undefined until next-themes has read the
    // document, while `theme` already holds the stored preference. Answering
    // with the system preference in that window is the OS overriding a choice
    // the user made: a light theme on a dark-mode machine renders the app dark
    // on every load until something else re-renders it.
    themeState.theme = 'dark';
    themeState.resolvedTheme = undefined;
    stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });

  it('answers with the stored light preference even when the system is dark', () => {
    // The control for the test above, in the direction that matters most: the
    // system must never win, or a deliberate light theme is unreachable on any
    // dark-mode machine.
    themeState.theme = 'light';
    themeState.resolvedTheme = undefined;
    stubSystemTheme('dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('light');
  });

  it('follows the system preference while nothing is stored', () => {
    // Regression: before `next-themes` has read storage, `theme` is undefined.
    // Falling back to the store default or to a hard-coded light would flash the
    // wrong theme on every load for anyone whose OS is dark.
    const system = stubSystemTheme('dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
    // Characterisation: the listener effect is gated on exactly `'system'`, so
    // this pre-hydration window resolves once and does not subscribe. Harmless
    // today because next-themes reports `'system'` as soon as it mounts, but it
    // means an OS change in this window is only picked up by the next
    // `theme`/`resolvedTheme` change.
    expect(system.state.added).toBe(0);
  });

  it('falls back to light where the browser cannot report a system preference', () => {
    // Regression: `getSystemTheme` guards `window.matchMedia` before calling it,
    // because calling an unimplemented one throws. Without the guard this hook
    // throws while computing the theme on the mount path, which takes the canvas
    // down instead of rendering a default.
    themeState.theme = undefined;
    themeState.resolvedTheme = undefined;
    vi.stubGlobal('matchMedia', undefined);

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('light');
    expect(result.current.isLight).toBe(true);
  });

  it('does not throw on mount when a system preference meets no matchMedia', () => {
    // Regression, and the case the test above structurally cannot reach.
    //
    // `getSystemTheme` guards `window.matchMedia`; the *listener* effect did
    // not. With `theme` left undefined the hook resolves through the guarded
    // getter, so the unguarded call is never made -- which is why a test with
    // `theme: undefined` passes against the defect. Naming `'system'`
    // explicitly is what routes into the effect.
    //
    // Before the fix this threw `TypeError: window.matchMedia is not a function`
    // from inside the effect, which React surfaces as a render crash and which
    // takes the canvas down rather than falling back to light.
    themeState.theme = 'system';
    themeState.resolvedTheme = 'system';
    vi.stubGlobal('matchMedia', undefined);

    // The value is captured from inside the render callback: typing the
    // `renderHook` return by hand loses its generic, so `result.current` would be
    // `unknown`.
    let effective: string | undefined;
    expect(() => {
      renderHook(() => {
        effective = useTheme().effectiveTheme;
        return null;
      });
    }).not.toThrow();

    // And it still answers, with the same light fallback the getter uses.
    expect(effective).toBe('light');
  });

  it('trusts the resolved theme for a system preference', () => {
    // Regression: with `theme: 'system'` the effective theme is next-themes'
    // own resolution, not a second `matchMedia` read. Reading the media query
    // again here would ignore any resolution next-themes did for us — most
    // visibly on first paint, where it already knows the answer and this hook
    // does not.
    themeState.theme = 'system';
    themeState.resolvedTheme = 'dark';
    const system = stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
    expect(result.current.isSystem).toBe(true);
    expect(system.state.added).toBe(1);
  });

  it('falls back to light when the stored value is not a theme', () => {
    // Regression: the value reaching this hook is whatever is in storage, and
    // it is cast to `Theme` without validation. An unknown value must resolve
    // to one of the two real themes; returning it would leave `isDark` and
    // `isLight` both false and the canvas background undefined.
    themeState.theme = 'neon';
    themeState.resolvedTheme = undefined;
    stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('light');
    expect(result.current.isLight).toBe(true);
  });
});

describe('system change listener', () => {
  it('reacts to the system flipping while the preference is system', () => {
    // Regression: the `matchMedia` change handler is the only way a `system`
    // user sees an OS theme change without reloading. Without it the app keeps
    // the theme it resolved at mount, and nothing tells the user why.
    themeState.theme = 'system';
    themeState.resolvedTheme = undefined;
    const system = stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());
    expect(result.current.effectiveTheme).toBe('light');

    system.flip('dark');
    expect(result.current.effectiveTheme).toBe('dark');

    system.flip('light');
    expect(result.current.effectiveTheme).toBe('light');
  });

  it('attaches no listener once a preference has been chosen', () => {
    // Regression: a listener left attached after an explicit choice means the
    // OS flipping to dark silently overrides a deliberate light theme — the
    // user picked light, the machine went to dark, and the app disagreed with
    // the setting they can see.
    themeState.theme = 'light';
    themeState.resolvedTheme = 'light';
    const system = stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());
    system.flip('dark');

    expect(system.state.added).toBe(0);
    expect(result.current.effectiveTheme).toBe('light');
  });

  it('removes the listener on unmount', () => {
    // Regression: navigating between pages mounts this hook again. A listener
    // that survives its component accumulates one per navigation, each holding
    // a setState closure for a component that is gone.
    themeState.theme = 'system';
    themeState.resolvedTheme = undefined;
    const system = stubSystemTheme('light');

    const { unmount } = renderHook(() => useTheme());
    expect(system.state.listeners.size).toBe(1);

    unmount();

    expect(system.state.listeners.size).toBe(0);
    expect(system.state.removed).toBe(1);
  });

  it('drops the listener when the preference stops being system', () => {
    // Regression: the cleanup must run on the dependency change, not only at
    // unmount. Missing it leaves a listener reading the system theme for a user
    // who has since chosen an explicit one.
    themeState.theme = 'system';
    themeState.resolvedTheme = undefined;
    const system = stubSystemTheme('light');

    const { rerender, result } = renderHook(() => useTheme());
    expect(system.state.listeners.size).toBe(1);

    themeState.theme = 'light';
    themeState.resolvedTheme = 'light';
    rerender();

    expect(system.state.listeners.size).toBe(0);

    system.flip('dark');
    expect(result.current.effectiveTheme).toBe('light');
  });
});

describe('theme from the URL', () => {
  it('honours an explicit theme parameter over everything else', () => {
    // Regression: present and embed links carry `?theme=`. Ignoring it renders a
    // deck that was explicitly authored for a dark room as a light one, and
    // the presenter's own stored preference is not what the link asked for.
    themeState.theme = 'light';
    themeState.resolvedTheme = 'light';
    setSearch('?theme=dark');
    stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
  });

  it('ignores a theme parameter that is not a theme', () => {
    // The control for the test above: the allow-list is what stops an arbitrary
    // query value from becoming the app's theme.
    themeState.theme = 'dark';
    themeState.resolvedTheme = 'dark';
    setSearch('?theme=neon');
    stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
  });

  it('reads the parameter on its own, with nothing stored', () => {
    // Regression: a share link opened in a fresh tab has no stored preference
    // at all. If the parameter were only consulted after the stored one, the
    // link would render with the system default instead of what it asked for.
    setSearch('?theme=dark');
    stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.effectiveTheme).toBe('dark');
  });
});

describe('store and next-themes wiring', () => {
  it('publishes the stored theme to the canvas store', () => {
    // Regression: the canvas store's theme is what `CanvasBootstrap` adapts the
    // canvas chrome to, and what `useCanvasPersistence` writes into the saved
    // app state. Not publishing leaves the canvas drawing with the previous
    // theme's default stroke colour — invisible strokes on a dark canvas.
    themeState.theme = 'dark';
    themeState.resolvedTheme = 'dark';
    stubSystemTheme('light');

    renderHook(() => useTheme());

    expect(useCanvasStore.getState().theme).toBe('dark');
  });

  it('publishes nothing while no theme is stored', () => {
    // Regression: pushing `undefined` into the store would overwrite the
    // persisted preference with a value the store's own type does not allow.
    useCanvasStore.setState({ theme: 'dark' });
    stubSystemTheme('light');

    renderHook(() => useTheme());

    expect(useCanvasStore.getState().theme).toBe('dark');
  });

  it('hands an explicit choice to next-themes', () => {
    // Regression: this hook's `setTheme` is the only path to next-themes'
    // state. Bypassing it would update this hook's opinion of the theme while
    // next-themes — and therefore the class on `<html>` — never changed.
    themeState.theme = 'light';
    themeState.resolvedTheme = 'light';
    stubSystemTheme('light');

    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('system');
    });

    expect(themeState.setTheme).toHaveBeenCalledWith('system');
  });
});
