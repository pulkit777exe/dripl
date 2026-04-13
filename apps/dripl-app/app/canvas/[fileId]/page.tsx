'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { useTheme } from '@/hooks/useTheme';
import { TopBar } from '@/components/canvas/TopBar';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import { useAuth } from '@/app/context/AuthContext';
import { useCanvasStore } from '@/lib/canvas-store';
import { apiClient } from '@/lib/api';
import type { DriplElement } from '@dripl/common';

interface CanvasFilePageProps {
  params: Promise<{
    fileId: string;
  }>;
}

export default function CanvasFilePage({ params }: CanvasFilePageProps) {
  const { fileId } = React.use(params);
  const { effectiveTheme } = useTheme();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [isLoadingFile, setIsLoadingFile] = useState(true);
  const skipNextSaveRef = useRef(true);

  const elements = useCanvasStore(state => state.elements);
  const setUserId = useCanvasStore(state => state.setUserId);
  const setElements = useCanvasStore(state => state.setElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);
  const markSaving = useCanvasStore(state => state.markSaving);
  const markSaved = useCanvasStore(state => state.markSaved);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/auth/login');
      return;
    }

    let cancelled = false;
    setUserId(user.id);

    const loadFile = async () => {
      try {
        const response = await apiClient.getFile(fileId);
        if (cancelled) return;
        const content = Array.isArray(response.file.content)
          ? (response.file.content as DriplElement[])
          : [];
        setElements(content, { skipHistory: true });
        setSelectedIds(new Set<string>());
        setFileMetadata(response.file.id, response.file.name);
        skipNextSaveRef.current = true;
      } catch (error) {
        console.error('Failed to load file', error);
        router.replace('/dashboard');
        return;
      } finally {
        if (!cancelled) {
          setIsLoadingFile(false);
        }
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
    };
  }, [authLoading, fileId, router, setElements, setFileMetadata, setSelectedIds, setUserId, user]);

  useEffect(() => {
    if (!user || isLoadingFile) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        markSaving(true);
        await apiClient.updateFile(fileId, { content: elements });
        markSaved();
      } catch (error) {
        markSaving(false);
        console.error('Failed to auto-save file', error);
      }
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [elements, fileId, isLoadingFile, markSaved, markSaving, user]);

  if (authLoading || isLoadingFile) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8]">
        <p className="text-[#7a7267]">Loading canvas...</p>
      </div>
    );
  }

  return (
    <div
      className={`w-screen h-dvh relative overflow-hidden ${
        effectiveTheme === 'dark' ? 'bg-[#1A1714]' : 'bg-[#F5F0E8]'
      }`}
    >
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

      <TopBar />
      <CanvasBootstrap mode="room" roomSlug={fileId} theme={effectiveTheme} />

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
        <CanvasToolbar />
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <CommandPalette />
    </div>
  );
}
