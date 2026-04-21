'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import type { DriplElement } from '@dripl/common';

import RoughCanvas from '@/components/canvas/RoughCanvas';
import { CanvasErrorBoundary } from '@/components/canvas/CanvasErrorBoundary';
import { useCanvasStore } from '@/lib/canvas-store';
import { saveCanvasToIndexedDB, loadCanvasFromIndexedDB } from '@/lib/canvas-db';
import { type LocalCanvasState, loadLocalCanvasFromStorage } from '@/utils/localCanvasStorage';
import { loadInitialScene } from '@/lib/scene-loader';
import type { ActiveTool, Theme } from '@/lib/canvas-store';

type BaseProps = {
  theme: 'light' | 'dark';
  readOnly?: boolean;
};

const VALID_THEMES = new Set<Theme>(['light', 'dark', 'system']);
const VALID_STROKE_STYLES = new Set(['solid', 'dashed', 'dotted'] as const);
const VALID_FILL_STYLES = new Set([
  'hachure',
  'solid',
  'zigzag',
  'cross-hatch',
  'dots',
  'dashed',
  'zigzag-line',
] as const);
const VALID_TOOLS = new Set<ActiveTool>([
  'select',
  'hand',
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'frame',
  'eraser',
]);

function isActiveTool(value: string): value is ActiveTool {
  return VALID_TOOLS.has(value as ActiveTool);
}

type LocalModeProps = BaseProps & { mode: 'local' };
type RoomModeProps = BaseProps & { mode: 'room'; roomSlug: string };
type FileModeProps = BaseProps & { mode: 'file'; initialData: unknown };

export type CanvasBootstrapProps = LocalModeProps | RoomModeProps | FileModeProps;

function applyAppStateToStore(appState: Partial<LocalCanvasState> | null) {
  if (!appState) return;
  const store = useCanvasStore.getState();
  if (appState.theme && VALID_THEMES.has(appState.theme)) store.setTheme(appState.theme);
  if (typeof appState.zoom === 'number') store.setZoom(appState.zoom);
  if (typeof appState.panX === 'number' && typeof appState.panY === 'number')
    store.setPan(appState.panX, appState.panY);
  if (appState.currentStrokeColor) store.setCurrentStrokeColor(appState.currentStrokeColor);
  if (appState.currentBackgroundColor)
    store.setCurrentBackgroundColor(appState.currentBackgroundColor);
  if (typeof appState.currentStrokeWidth === 'number')
    store.setCurrentStrokeWidth(appState.currentStrokeWidth);
  if (typeof appState.currentRoughness === 'number')
    store.setCurrentRoughness(appState.currentRoughness);
  if (appState.currentStrokeStyle && VALID_STROKE_STYLES.has(appState.currentStrokeStyle))
    store.setCurrentStrokeStyle(appState.currentStrokeStyle);
  if (appState.currentFillStyle && VALID_FILL_STYLES.has(appState.currentFillStyle))
    store.setCurrentFillStyle(appState.currentFillStyle);
  if (appState.activeTool && isActiveTool(appState.activeTool))
    store.setActiveTool(appState.activeTool);
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

  const setElements = useCanvasStore(state => state.setElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setRoomSlug = useCanvasStore(state => state.setRoomSlug);
  const existingElements = useCanvasStore(state => state.elements);
  const setReadOnly = useCanvasStore(state => state.setReadOnly);

  useEffect(() => {
    setRoomSlug(mode === 'room' ? (props as RoomModeProps).roomSlug : null);
  }, [mode, props, setRoomSlug]);

  useEffect(() => {
    setReadOnly(readOnly);
    return () => setReadOnly(false);
  }, [readOnly, setReadOnly]);

  const [isInitialized, setIsInitialized] = useState(false);
  const initialElementsRef = useRef<DriplElement[] | null>(null);
  if (initialElementsRef.current === null) {
    initialElementsRef.current = existingElements;
  }

  const roomSlug = useMemo(
    () => (mode === 'room' ? (props as RoomModeProps).roomSlug : null),
    [mode, props]
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (mode === 'local') {
        const LOCAL_ROOM_ID = 'local-canvas';
        const indexedElements = await loadCanvasFromIndexedDB(LOCAL_ROOM_ID);
        
        if (indexedElements && indexedElements.length > 0) {
          setElements(indexedElements, { skipHistory: true });
          if (!cancelled) setIsInitialized(true);
          return;
        }
        
        const { elements, appState, selectedIds: loadedSelectedIds } = loadLocalCanvasFromStorage();
        const initialElements = elements as DriplElement[] | null;
        if (initialElements && initialElements.length > 0) {
          setElements(initialElements, { skipHistory: true });
          if (loadedSelectedIds?.length) setSelectedIds(new Set(loadedSelectedIds));
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
          initialData: (props as FileModeProps).initialData,
        });
        if (cancelled || !scene) {
          setIsInitialized(true);
          return;
        }
        const initialElements = initialElementsRef.current || [];
        if (initialElements.length > 0 && scene.elements.length > 0) {
          const shouldOverride = await new Promise<boolean>(resolve => {
            const modal = document.createElement('div');
            modal.className =
              'fixed inset-0 bg-black/60 z-100 flex items-center justify-center p-4';
            modal.innerHTML =
              '<div class="w-full max-w-2xl bg-[#232329] rounded-xl border border-[#3f3f46] shadow-2xl p-6"><h2 class="text-xl font-semibold text-white mb-4">Load from link</h2><p class="text-gray-400 mb-4">This will replace your current content.</p><div class="flex gap-3 justify-end"><button class="px-4 py-2 text-gray-400 cancel-btn">Cancel</button><button class="px-6 py-2 bg-[#8b5cf6] text-white rounded-lg replace-btn">Replace</button></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('.cancel-btn')?.addEventListener('click', () => {
              resolve(false);
              document.body.removeChild(modal);
            });
            modal.querySelector('.replace-btn')?.addEventListener('click', () => {
              resolve(true);
              document.body.removeChild(modal);
            });
            modal.addEventListener('click', e => {
              if (e.target === modal) {
                resolve(false);
                document.body.removeChild(modal);
              }
            });
          });
          if (!shouldOverride) {
            setIsInitialized(true);
            return;
          }
        }
        if (scene.elements.length > 0) {
          setElements(scene.elements, { skipHistory: true });
        }
        applyAppStateToStore((scene.appState || null) as Partial<LocalCanvasState> | null);
        if (!cancelled) setIsInitialized(true);
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [mode, roomSlug, props, setElements, setSelectedIds]);

  const elements = useCanvasStore(state => state.elements);
  useEffect(() => {
    if (!isInitialized || mode !== 'local') return;
    const LOCAL_ROOM_ID = 'local-canvas';
    const timeoutId = setTimeout(() => {
      saveCanvasToIndexedDB(LOCAL_ROOM_ID, elements).catch(console.error);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [elements, isInitialized, mode]);

  if (!isInitialized) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <div className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
          Loading canvas...
        </div>
      </div>
    );
  }

  return (
    <CanvasErrorBoundary>
      <RoughCanvas roomSlug={mode === 'room' ? roomSlug : null} theme={theme} />
    </CanvasErrorBoundary>
  );
}
