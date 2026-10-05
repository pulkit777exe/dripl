'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { logError, logWarn, type DriplElement } from '@dripl/common';

import RoughCanvas from '@/components/canvas/RoughCanvas';
import { CanvasErrorBoundary } from '@/components/canvas/CanvasErrorBoundary';
import { useCanvasStore } from '@/lib/store';
import { saveCanvasToIndexedDB, loadCanvasFromIndexedDB } from '@/lib/canvas-db';
import { type LocalCanvasState, loadLocalCanvasFromStorage } from '@/utils/localCanvasStorage';
import { loadInitialScene } from '@/lib/scene-loader';
import { restoreAppState, restoreElements, applyRestoredAppState } from '@/lib/scene';
import { startPerformanceObservers } from '@/utils/performance-observers';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type BaseProps = {
  theme: 'light' | 'dark';
  readOnly?: boolean;
};

type LocalModeProps = BaseProps & { mode: 'local' };
type RoomModeProps = BaseProps & { mode: 'room'; roomSlug: string; shareToken?: string | null };
type FileModeProps = BaseProps & {
  mode: 'file';
  initialData: unknown;
  /** Replace a cached scene without showing the interactive confirmation. */
  replaceExisting?: boolean;
};

export type CanvasBootstrapProps = LocalModeProps | RoomModeProps | FileModeProps;

/**
 * A stable string identifying a file scene by content.
 *
 * Element ids and versions, plus the serialized app state, are what make two
 * file scenes the same scene. This exists because a props object cannot: React
 * builds a fresh one per parent render, so any effect keyed on the `initialData`
 * object restarts on every parent render. Exported for tests, which pin the
 * property that matters — equal scenes must produce equal keys, so the key can
 * be used as an effect dependency without re-running on an unrelated render.
 */
export function fileSceneKeyFor(initialData: unknown): string | null {
  if (!initialData) return null;
  const data = initialData as { elements?: unknown; appState?: unknown };
  const elements = Array.isArray(data.elements) ? (data.elements as DriplElement[]) : [];
  const ids = elements.map(element => `${element?.id ?? ''}@${element?.version ?? ''}`);
  let appStateKey = '';
  if (data.appState && typeof data.appState === 'object') {
    try {
      appStateKey = JSON.stringify(data.appState);
    } catch {
      // A non-serializable app state cannot be compared by value; leaving the
      // key empty means such a scene reloads on every parent render, which is
      // the pre-fix behaviour rather than a new failure mode.
      appStateKey = '';
    }
  }
  return `${ids.join(',')}|${appStateKey}`;
}

function applyAppStateToStore(appState: Partial<LocalCanvasState> | null) {
  if (!appState) return;
  const store = useCanvasStore.getState();
  applyRestoredAppState(restoreAppState(appState), {
    setTheme: store.setTheme,
    setZoom: store.setZoom,
    setPan: store.setPan,
    setCurrentStrokeColor: store.setCurrentStrokeColor,
    setCurrentBackgroundColor: store.setCurrentBackgroundColor,
    setCurrentStrokeWidth: store.setCurrentStrokeWidth,
    setCurrentRoughness: store.setCurrentRoughness,
    setCurrentStrokeStyle: store.setCurrentStrokeStyle,
    setCurrentFillStyle: store.setCurrentFillStyle,
    setActiveTool: store.setActiveTool,
    setCanvasBackground: store.setCanvasBackground,
  });
}

export function CanvasBootstrap(props: CanvasBootstrapProps) {
  const { theme, readOnly = false } = props;
  const { resolvedTheme } = useTheme();
  const mode = props.mode;

  useEffect(() => {
    const isDark = resolvedTheme === 'dark';
    const store = useCanvasStore.getState();
    const current = store.currentStrokeColor;
    if (current === '#000000' || current === '#1e1e1e' || current === '#ffffff') {
      store.setCurrentStrokeColor(isDark ? '#ffffff' : '#1e1e1e');
    }
  }, [resolvedTheme]);

  useEffect(() => startPerformanceObservers(), []);

  const setElements = useCanvasStore(state => state.setElements);
  const elements = useCanvasStore(state => state.elements);
  const isDrawing = useCanvasStore(state => state.isDrawing);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setRoomSlug = useCanvasStore(state => state.setRoomSlug);
  const setReadOnly = useCanvasStore(state => state.setReadOnly);

  useEffect(() => {
    setReadOnly(readOnly);
    return () => setReadOnly(false);
  }, [readOnly, setReadOnly]);

  const [isInitialized, setIsInitialized] = useState(false);
  const initialElementsRef = useRef<DriplElement[] | null>(null);
  /**
   * The scene this mount is responsible for loading, kept by identity so the
   * bootstrap effect cannot be restarted by a parent that re-renders with an
   * equivalent-but-new `initialData` object.
   *
   * `initialData` arrives as a prop, and a props object is a new reference on
   * every parent render. The bootstrap effect must not therefore depend on it
   * directly: it applies the file scene with `setElements`, which replaces the
   * store's element array, which re-renders the parent, which produces a new
   * `initialData`, which re-runs the effect. That cycle has no fixed point, so
   * with any non-empty scene the page never yields — the main thread runs
   * React commits back to back, allocates the scene per pass, and grows without
   * bound. An empty scene did not reproduce because `setElements([])` leaves an
   * array that shallow-compares equal to itself, so the parent never re-renders
   * and the cycle has nothing to drive it.
   *
   * Keying the effect on the *contents* rather than the object identity fixes
   * it without changing which scene is loaded: a genuinely new scene (a
   * navigation to another file) still changes the key and still reloads.
   */
  const rawFileInitialData = mode === 'file' ? (props as FileModeProps).initialData : null;
  const fileSceneKey = fileSceneKeyFor(rawFileInitialData);
  if (initialElementsRef.current === null) {
    initialElementsRef.current = useCanvasStore.getState().elements;
  }

  const roomSlug = mode === 'room' ? (props as RoomModeProps).roomSlug : null;
  const shareToken = mode === 'room' ? ((props as RoomModeProps).shareToken ?? null) : null;
  const replaceExisting =
    mode === 'file' ? (props as FileModeProps).replaceExisting === true : false;

  useIsomorphicLayoutEffect(() => {
    // A newly opened authenticated room must not briefly render the previous
    // canvas from the global store while its WebSocket initial sync is pending.
    // Shared file pages have already validated/decrypted their scene and are
    // therefore left intact until the server confirms it.
    if (mode === 'room' && !shareToken) {
      useCanvasStore.getState().setElements([], { skipHistory: true });
      useCanvasStore.getState().clearSelection();
    }
  }, [mode, roomSlug, shareToken]);

  useEffect(() => {
    setRoomSlug(roomSlug);
  }, [roomSlug, setRoomSlug]);

  useEffect(() => {
    let cancelled = false;
    // The prompt this effect run appended, held so the teardown can remove *its own*.
    //
    // The previous version swept the document with
    // `querySelector('.fixed.inset-0.bg-black\\/60.z-100')` after the prompt resolved.
    // That could never clean the orphan it was written for: every `resolve` path calls
    // `cleanup()` first, so by the time the `await` resumed the modal was already gone
    // and the query only matched a *different* instance's prompt. Answering a dead
    // instance's prompt therefore removed the live one, whose promise then never
    // resolved and whose canvas could never load. Removing the element this run created
    // fixes the leak the sweep was after and cannot touch anyone else's modal.
    let promptModal: HTMLDivElement | null = null;
    const bootstrap = async () => {
      if (mode === 'local') {
        const LOCAL_ROOM_ID = 'local-canvas';
        const indexedElements = await loadCanvasFromIndexedDB(LOCAL_ROOM_ID);

        if (indexedElements && indexedElements.length > 0) {
          setElements(restoreElements(indexedElements), { skipHistory: true });
          if (!cancelled) setIsInitialized(true);
          return;
        }

        const {
          elements,
          appState,
          selectedIds: loadedSelectedIds,
          elementsTruncated,
          totalElements,
        } = loadLocalCanvasFromStorage();
        const initialElements = restoreElements((elements as DriplElement[] | null) || []);
        if (initialElements.length > 0) {
          setElements(initialElements, { skipHistory: true });
          if (loadedSelectedIds?.length) setSelectedIds(new Set(loadedSelectedIds));
        }
        if (elementsTruncated) {
          // This copy is the fallback used when IndexedDB is unavailable. Say so
          // rather than letting a partial scene look like a complete one.
          logWarn(
            JSON.stringify({
              level: 'warn',
              event: 'local_canvas_truncated',
              restoredElements: initialElements?.length ?? 0,
              totalElements: totalElements ?? null,
            })
          );
        }
        applyAppStateToStore(appState as Partial<LocalCanvasState> | null);
        if (!cancelled) setIsInitialized(true);
        return;
      }
      if (mode === 'room') {
        if (!cancelled) setIsInitialized(true);
        return;
      }
      if (mode === 'file') {
        const scene = await loadInitialScene({
          source: 'file',
          // Read from the closure, not from a ref: React invokes the effect
          // body from the render that scheduled it, so this is the scene that
          // matched `fileSceneKey`, and a later parent render cannot swap it
          // out from under a run already in flight.
          initialData: rawFileInitialData,
        });
        if (cancelled || !scene) {
          setIsInitialized(true);
          return;
        }
        const initialElements = initialElementsRef.current || [];
        if (initialElements.length > 0 && scene.elements.length > 0 && !replaceExisting) {
          const shouldOverride = await new Promise<boolean>(resolve => {
            const modal = document.createElement('div');
            promptModal = modal;
            modal.className =
              'fixed inset-0 bg-black/60 z-100 flex items-center justify-center p-4';
            modal.innerHTML =
              '<div class="w-full max-w-2xl bg-[#232329] rounded-xl border border-[#3f3f46] shadow-2xl p-6"><h2 class="text-xl font-semibold text-white mb-4">Load from link</h2><p class="text-gray-400 mb-4">This will replace your current content.</p><div class="flex gap-3 justify-end"><button class="px-4 py-2 text-gray-400 cancel-btn">Cancel</button><button class="px-6 py-2 bg-[#8b5cf6] text-white rounded-lg replace-btn">Replace</button></div></div>';
            document.body.appendChild(modal);

            const cleanup = () => {
              if (modal.parentElement) document.body.removeChild(modal);
            };
            modal.querySelector('.cancel-btn')?.addEventListener('click', () => {
              resolve(false);
              cleanup();
            });
            modal.querySelector('.replace-btn')?.addEventListener('click', () => {
              resolve(true);
              cleanup();
            });
            modal.addEventListener('click', e => {
              if (e.target === modal) {
                resolve(false);
                cleanup();
              }
            });
          });
          if (!shouldOverride || cancelled) {
            setIsInitialized(true);
            return;
          }
        }
        // Always load the file scene, even when it's empty, so we don't
        // keep stale elements from a previously opened canvas.
        setElements(scene.elements, { skipHistory: true });
        applyAppStateToStore((scene.appState || null) as Partial<LocalCanvasState> | null);
        if (!cancelled) setIsInitialized(true);
      }
    };
    bootstrap().catch((err: unknown) => {
      // Every read on this path is fallible — a private-mode IndexedDB, a
      // corrupt shared-file payload, a revoked storage grant — and an
      // unhandled rejection here left the user staring at "Loading canvas..."
      // for the rest of the session with nothing in the log. Report it through
      // the repo's logging boundary and still leave the spinner: an empty
      // canvas the user can see and fix beats an infinite one.
      logError(
        JSON.stringify({
          level: 'error',
          event: 'canvas_bootstrap_failed',
          mode,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      if (!cancelled) setIsInitialized(true);
    });
    return () => {
      cancelled = true;
      // The prompt is appended imperatively and outlives the React tree, so teardown
      // has to take it with it. Without this an unmount while the prompt is up leaves
      // an unclickable overlay on screen for the rest of the session.
      promptModal?.remove();
    };
    // `fileSceneKey` identifies the scene by content, standing in for the
    // `initialData` object — see its definition above. Listing `rawFileInitialData`
    // here would reintroduce the exact cycle this key exists to break.
  }, [fileSceneKey, mode, replaceExisting, roomSlug, setElements, setSelectedIds]);

  useEffect(() => {
    if (!isInitialized || mode !== 'local' || isDrawing) return;
    const LOCAL_ROOM_ID = 'local-canvas';
    // Keep the durable IndexedDB snapshot in step with localStorage. The
    // previous initialization-only effect allowed a stale IndexedDB scene to
    // win on the next reload, silently discarding later edits.
    const timeoutId = setTimeout(() => {
      saveCanvasToIndexedDB(LOCAL_ROOM_ID, useCanvasStore.getState().elements).catch(logError);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [elements, isDrawing, isInitialized, mode]);

  if (!isInitialized) {
    return (
      <div
        className="relative w-full h-full flex items-center justify-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          className="rounded-lg px-4 py-2 text-sm shadow-sm"
          style={{
            backgroundColor: 'var(--color-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-muted-foreground)',
          }}
        >
          Loading canvas...
        </div>
      </div>
    );
  }

  return (
    <CanvasErrorBoundary name="RoughCanvas">
      <RoughCanvas
        roomSlug={mode === 'room' ? roomSlug : null}
        theme={theme}
        shareToken={shareToken}
      />
    </CanvasErrorBoundary>
  );
}
