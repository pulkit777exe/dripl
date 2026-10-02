'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import type { DriplElement } from '@dripl/common';

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
  if (initialElementsRef.current === null) {
    initialElementsRef.current = useCanvasStore.getState().elements;
  }

  const roomSlug = mode === 'room' ? (props as RoomModeProps).roomSlug : null;
  const shareToken = mode === 'room' ? ((props as RoomModeProps).shareToken ?? null) : null;
  const fileInitialData = mode === 'file' ? (props as FileModeProps).initialData : null;
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
          // eslint-disable-next-line no-console -- truncated-restore telemetry
          console.warn(
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
          initialData: fileInitialData,
        });
        if (cancelled || !scene) {
          setIsInitialized(true);
          return;
        }
        const initialElements = initialElementsRef.current || [];
        if (initialElements.length > 0 && scene.elements.length > 0 && !replaceExisting) {
          const shouldOverride = await new Promise<boolean>(resolve => {
            const modal = document.createElement('div');
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
            if (cancelled) {
              const staleModal = document.querySelector('.fixed.inset-0.bg-black\\/60.z-100');
              if (staleModal) staleModal.remove();
            }
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
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [fileInitialData, mode, replaceExisting, roomSlug, setElements, setSelectedIds]);

  useEffect(() => {
    if (!isInitialized || mode !== 'local' || isDrawing) return;
    const LOCAL_ROOM_ID = 'local-canvas';
    // Keep the durable IndexedDB snapshot in step with localStorage. The
    // previous initialization-only effect allowed a stale IndexedDB scene to
    // win on the next reload, silently discarding later edits.
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line no-console -- persistence failure telemetry
      saveCanvasToIndexedDB(LOCAL_ROOM_ID, useCanvasStore.getState().elements).catch(console.error);
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
