'use client';

import { useEffect, useRef, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { useParams, useRouter } from 'next/navigation';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { TopBar } from '@/components/canvas/TopBar';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/app/context/AuthContext';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore } from '@/lib/canvas-store';
import { apiClient } from '@/lib/api';
import { Spinner } from '@/components/button/Spinner';

export default function FilePage() {
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

  const autosaveEnabledRef = useRef(false);
  const lastSavedContentRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const store = useCanvasStore.getState();
    store.setElements([], { skipHistory: true });
    store.clearHistory();
    store.clearSelection();
    store.setClipboard([]);
    autosaveEnabledRef.current = false;
    lastSavedContentRef.current = null;
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
        const fileElements = Array.isArray(response.file.content)
          ? (response.file.content as DriplElement[])
          : [];
        const nextInitialData = { elements: fileElements };
        if (cancelled) return;

        setInitialData(nextInitialData);
        setFileMetadata(response.file.id, response.file.name);
        lastSavedContentRef.current = JSON.stringify(fileElements);
        autosaveEnabledRef.current = false;
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

    if (storeFileId !== fileId) return;

    const currentContent = JSON.stringify(elements);
    const savedContent = lastSavedContentRef.current;

    if (!autosaveEnabledRef.current) {
      if (savedContent !== null && currentContent === savedContent) {
        autosaveEnabledRef.current = true;
      }
      return;
    }

    if (savedContent !== null && currentContent === savedContent) {
      return;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await apiClient.updateFile(fileId, { content: elements });
          lastSavedContentRef.current = JSON.stringify(elements);
          setSaveError(null);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to save canvas';
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
    };
  }, []);

  if (authLoading || loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
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
          {saveError}
        </div>
      )}
      <CanvasBootstrap mode="file" initialData={initialData} theme={effectiveTheme} />
      <div className="absolute top-0.5 left-1/2 -translate-x-1/2 z-20">
        <CanvasToolbar />
      </div>
      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>
      <CommandPalette />
    </div>
  );
}
