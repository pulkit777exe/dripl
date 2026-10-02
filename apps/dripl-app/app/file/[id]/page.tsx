'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DriplElement } from '@dripl/common';
import { useParams, useRouter } from 'next/navigation';
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
import { Spinner } from '@/components/button/Spinner';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import HelpModal from '@/components/canvas/HelpModal';
import type { LocalCanvasState } from '@/utils/localCanvasStorage';

function elementsFromFileContent(rawContent: unknown): DriplElement[] {
  if (Array.isArray(rawContent)) return rawContent as DriplElement[];
  if (rawContent && typeof rawContent === 'object') {
    const content = rawContent as { elements?: unknown };
    if (Array.isArray(content.elements)) return content.elements as DriplElement[];
  }
  return [];
}

const CommandPalette = dynamic(
  () => import('@/components/canvas/CommandPalette').then(m => m.CommandPalette),
  { ssr: false }
);

export default function FilePage(): React.ReactNode {
  const params = useParams<{ id: string }>();
  const fileId = params.id;
  const { effectiveTheme } = useTheme();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const setUserId = useCanvasStore(state => state.setUserId);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);
  const elements = useCanvasStore(useShallow(state => state.elements));
  const storeFileId = useCanvasStore(state => state.fileId);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<unknown>(null);

  const initialSyncDoneRef = useRef(false);
  const lastSavedContentRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const latestElementsRef = useRef<DriplElement[]>([]);
  const fileUpdatedAtRef = useRef<string | null>(null);
  const saveConflictRef = useRef(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    const store = useCanvasStore.getState();
    store.setElements([], { skipHistory: true });
    store.clearHistory();
    store.clearSelection();
    store.setClipboard([]);
    initialSyncDoneRef.current = false;
    lastSavedContentRef.current = null;
    fileUpdatedAtRef.current = null;
    saveConflictRef.current = false;
  }, [fileId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/file/${fileId}`)}`);
      return;
    }

    setUserId(user.id);

    let cancelled = false;
    const loadFile = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await apiClient.getFile(fileId);
        const rawContent = response.file.content;
        const fileElements = elementsFromFileContent(rawContent);
        let fileAppState: Partial<LocalCanvasState> | null = null;
        if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
          const contentObj = rawContent as { appState?: Partial<LocalCanvasState> };
          if (contentObj.appState && typeof contentObj.appState === 'object') {
            fileAppState = contentObj.appState;
          }
        }

        const nextInitialData = { elements: fileElements, appState: fileAppState };
        if (cancelled) return;

        setInitialData(nextInitialData);
        setFileMetadata(response.file.id, response.file.name);
        lastSavedContentRef.current = JSON.stringify(fileElements);
        fileUpdatedAtRef.current = response.file.updatedAt;
        initialSyncDoneRef.current = false;
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load canvas file';
        setLoadError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [authLoading, fileId, router, setFileMetadata, setUserId, user]);

  useEffect(() => {
    if (loading || loadError || !user || !initialData) return;

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
  }, [elements, fileId, initialData, loadError, loading, storeFileId, user]);

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

  if (authLoading || loading) {
    return (
      <div
        className="flex h-dvh items-center justify-center"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
        <Spinner className="size-6 text-[#6B6860]" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (loadError || !initialData) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8] p-6">
        <div className="max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5">
          <p className="text-[14px] font-medium text-[#1A1917]">
            {loadError ?? 'This canvas could not be loaded.'}
          </p>
          <button
            type="button"
            className="mt-4 rounded-md bg-[#E8462A] px-4 py-2 text-[13px] text-white"
            onClick={() => router.push('/dashboard')}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

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
              className="ml-2 font-semibold underline"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          )}
        </div>
      )}
      <CanvasBootstrap mode="file" initialData={initialData} theme={effectiveTheme} />
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
