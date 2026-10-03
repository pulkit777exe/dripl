'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DriplElement } from '@dripl/common';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { TopBar } from '@/components/canvas/TopBar';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/app/context/AuthContext';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore } from '@/lib/store';
import { apiClient } from '@/lib/api';
import { generateThumbnail } from '@/utils/export';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import HelpModal from '@/components/canvas/HelpModal';
import type { LocalCanvasState } from '@/utils/localCanvasStorage';

const CommandPalette = dynamic(
  () => import('@/components/canvas/CommandPalette').then(m => m.CommandPalette),
  { ssr: false }
);

export type FileInitialData = {
  elements: DriplElement[];
  appState: Partial<LocalCanvasState> | null;
};

/**
 * The interactive half of a saved canvas.
 *
 * `app/file/[id]/page.tsx` fetches the file on the server and hands the scene
 * over in `initialData`, which is the one thing here that used to cost a full
 * browser round trip after hydration. Autosave, conflict detection, thumbnails
 * and the Zustand wiring all stay on the client: they are per-keystroke,
 * per-conflict and per-frame concerns that a server render could not own, and
 * `fileUpdatedAtRef` below is the optimistic-concurrency token that only makes
 * sense in the browser's own timeline.
 *
 * The page used to render a centred `<Spinner/>` for the whole of the fetch.
 * The canvas chrome is now server-rendered markup and the scene is applied as
 * soon as the store mounts, so the toolbar, top bar and controls are on screen
 * before a single canvas chunk is requested.
 */
export function FileCanvasRoute({
  fileId,
  fileName,
  updatedAt,
  initialData,
}: {
  fileId: string;
  fileName: string;
  updatedAt: string;
  initialData: FileInitialData;
}) {
  const { effectiveTheme } = useTheme();
  const { user } = useAuth();
  const setUserId = useCanvasStore(state => state.setUserId);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);
  const elements = useCanvasStore(useShallow(state => state.elements));
  const storeFileId = useCanvasStore(state => state.fileId);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const initialSyncDoneRef = useRef(false);
  const lastSavedContentRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const latestElementsRef = useRef<DriplElement[]>([]);
  const fileUpdatedAtRef = useRef<string | null>(updatedAt);
  const saveConflictRef = useRef(false);
  // The scene arrived with the HTML, so hydration has nothing to wait for. This
  // flips on mount and is what the autosave effect gates on, replacing the
  // old `loading`/`initialData` state pair.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const store = useCanvasStore.getState();
    store.setElements([], { skipHistory: true });
    store.clearHistory();
    store.clearSelection();
    store.setClipboard([]);
    initialSyncDoneRef.current = false;
    lastSavedContentRef.current = null;
    fileUpdatedAtRef.current = updatedAt;
    saveConflictRef.current = false;
    if (user) setUserId(user.id);
    setFileMetadata(fileId, fileName);
    setHydrated(true);
  }, [fileId, fileName, setFileMetadata, setUserId, updatedAt, user]);

  useEffect(() => {
    if (!hydrated || saveError || !user) return;

    if (storeFileId !== fileId || saveConflictRef.current) return;

    latestElementsRef.current = elements;

    if (!initialSyncDoneRef.current) {
      initialSyncDoneRef.current = true;
      lastSavedContentRef.current = JSON.stringify(elements);
      return;
    }

    const currentContent = JSON.stringify(elements);
    const savedContent = lastSavedContentRef.current;

    if (savedContent !== null && currentContent === savedContent) {
      pendingSaveRef.current = false;
      return;
    }

    pendingSaveRef.current = true;

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const currentElements = latestElementsRef.current;
        const {
          zoom: currentZoom,
          panX: currentPanX,
          panY: currentPanY,
        } = useCanvasStore.getState();
        const content = {
          elements: currentElements,
          appState: { zoom: currentZoom, panX: currentPanX, panY: currentPanY },
        };
        const saveContent = (expectedUpdatedAt?: string) =>
          apiClient.updateFile(fileId, {
            content,
            expectedUpdatedAt,
          });

        const applySaved = (updatedAt: string, elementsToThumbnail: DriplElement[]) => {
          fileUpdatedAtRef.current = updatedAt;
          // Generate and save thumbnail (non-blocking, best-effort)
          generateThumbnail(elementsToThumbnail)
            .then(thumbnail => {
              if (thumbnail) {
                apiClient
                  .updateFile(fileId, {
                    preview: thumbnail,
                    expectedUpdatedAt: fileUpdatedAtRef.current ?? undefined,
                  })
                  .then(result => {
                    fileUpdatedAtRef.current = result.file.updatedAt;
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});

          lastSavedContentRef.current = JSON.stringify(elementsToThumbnail);
          pendingSaveRef.current = false;
          setSaveError(null);
        };

        try {
          const saved = await saveContent(fileUpdatedAtRef.current ?? undefined);
          applySaved(saved.file.updatedAt, currentElements);
        } catch (error) {
          const status =
            typeof error === 'object' && error !== null
              ? (error as { status?: unknown }).status
              : undefined;
          const message = error instanceof Error ? error.message : 'Failed to save canvas';
          if (status === 409 || message.toLowerCase().includes('changed while saving')) {
            try {
              const latest = await apiClient.getFile(fileId);
              const latestContent = JSON.stringify(elementsFromFileContent(latest.file.content));
              fileUpdatedAtRef.current = latest.file.updatedAt;
              // A retry is safe only when the server's scene still matches the
              // base we loaded. Otherwise a human must choose/rebase the two
              // scenes; silently overwriting either side is data loss.
              if (latestContent === lastSavedContentRef.current) {
                const retried = await saveContent(latest.file.updatedAt);
                applySaved(retried.file.updatedAt, currentElements);
                return;
              }
              saveConflictRef.current = true;
              pendingSaveRef.current = false;
              setSaveError(
                'This file changed elsewhere. Reload it before saving over the newer version.'
              );
            } catch {
              pendingSaveRef.current = false;
              setSaveError(
                'This file changed elsewhere. Reload it before saving over the newer version.'
              );
            }
            return;
          }
          setSaveError(message);
        }
      })();
    }, 800);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [elements, fileId, hydrated, saveError, storeFileId, user]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      if (pendingSaveRef.current) {
        const { zoom: z, panX: px, panY: py } = useCanvasStore.getState();
        apiClient
          .updateFile(fileId, {
            content: {
              elements: latestElementsRef.current,
              appState: { zoom: z, panX: px, panY: py },
            },
            expectedUpdatedAt: fileUpdatedAtRef.current ?? undefined,
          })
          .catch(() => {});
      }
      initialSyncDoneRef.current = false;
    };
  }, [fileId]);

  return (
    <div
      className={`w-screen h-dvh relative overflow-hidden ${effectiveTheme === 'dark' ? 'bg-[#121112]' : 'bg-[#f7f5f6]'}`}
    >
      <TopBar />
      {saveError && (
        <div className="absolute left-1/2 top-14 z-40 -translate-x-1/2 rounded-md border border-[#F5C2B8] bg-[#FDF2F0] px-3 py-1.5 text-[12px] text-[#8B2A1A]">
          <span>{saveError}</span>
          {saveError.startsWith('This file changed elsewhere') && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 font-semibold underline"
            >
              Reload
            </button>
          )}
        </div>
      )}
      <CanvasBootstrap
        mode="file"
        initialData={{ elements: initialData.elements, appState: initialData.appState }}
        theme={effectiveTheme}
      />
      <div className="absolute top-0.5 left-1/2 -translate-x-1/2 z-20">
        <CanvasToolbar />
      </div>
      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <div className="absolute bottom-6 right-6 z-20 flex gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="canvas-chrome-btn size-10"
          aria-label="Help"
        >
          <HelpCircle className="mx-2" />
        </button>
        <span
          className="canvas-chrome-btn size-10"
          aria-label="Verification status"
          title="Verified"
          role="status"
        >
          <ShieldCheck className="mx-2" />
        </span>
      </div>

      <CommandPalette />
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}

function elementsFromFileContent(rawContent: unknown): DriplElement[] {
  if (Array.isArray(rawContent)) return rawContent as DriplElement[];
  if (rawContent && typeof rawContent === 'object') {
    const content = rawContent as { elements?: unknown };
    if (Array.isArray(content.elements)) return content.elements as DriplElement[];
  }
  return [];
}
