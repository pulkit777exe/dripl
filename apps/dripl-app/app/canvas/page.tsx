'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Check, HelpCircle } from 'lucide-react';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { useTheme } from '@/hooks/useTheme';
import { TopBar } from '@/components/canvas/TopBar';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import HelpModal from '@/components/canvas/HelpModal';
import { useCanvasStore } from '@/lib/canvas-store';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { saveLocalCanvasToStorage, type LocalCanvasState } from '@/utils/localCanvasStorage';

function CanvasContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { effectiveTheme } = useTheme();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [showStorageWarning, setShowStorageWarning] = useState(false);
  const [snapshotPayload, setSnapshotPayload] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const snapshotId = searchParams.get('snapshot');
  const hasResolvedSnapshotRef = useRef(false);
  const panX = useCanvasStore(s => s.panX);
  const panY = useCanvasStore(s => s.panY);
  const setPan = useCanvasStore(s => s.setPan);
  const setElements = useCanvasStore(s => s.setElements);
  const setSelectedIds = useCanvasStore(s => s.setSelectedIds);
  const setUserId = useCanvasStore(s => s.setUserId);
  const { user, token } = useAuth();
  const showScrollBack = panX !== 0 || panY !== 0;

  useEffect(() => {
    if (user?.id) {
      setUserId(user.id);
    } else if (token) {
      setUserId(token);
    } else {
      const anonId = localStorage.getItem('dripl_anon_id') || crypto.randomUUID();
      localStorage.setItem('dripl_anon_id', anonId);
      setUserId(anonId);
    }
  }, [user, token, setUserId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        setIsHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (hasResolvedSnapshotRef.current) return;
    if (!snapshotId) {
      hasResolvedSnapshotRef.current = true;
      return;
    }
    let cancelled = false;
    const loadSnapshot = async () => {
      try {
        const response = await fetch(`/api/canvas/snapshots/${snapshotId}`);
        if (!response.ok) {
          if (!cancelled) {
            setSnapshotError('This shared canvas link is invalid or has expired.');
          }
          return;
        }
        const payload = (await response.json()) as { data: string };
        if (!cancelled) setSnapshotPayload(payload.data);
      } catch {
        if (!cancelled) {
          setSnapshotError('This shared canvas link is invalid or has expired.');
        }
      } finally {
        hasResolvedSnapshotRef.current = true;
      }
    };
    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  useEffect(() => {
    if (snapshotId) return;
    if (typeof window === 'undefined') return;
    try {
      const probe = '__dripl-storage-test';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
    } catch {
      setShowStorageWarning(true);
    }
  }, [snapshotId]);

  const scrollBackToContent = useCallback(() => {
    setPan(0, 0);
  }, [setPan]);

  return (
    <div className="w-screen h-dvh relative overflow-hidden bg-canvas-bg">
      {showStorageWarning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-210 pointer-events-auto bg-[#FEF3F2] border border-[#FECACA] rounded-md px-3 py-2 text-[12px] text-[#B42318] flex items-center gap-2">
          <span>Canvas won&apos;t be saved in this browser session.</span>
          <button type="button" className="underline" onClick={() => setShowStorageWarning(false)}>
            Dismiss
          </button>
        </div>
      )}
      {snapshotError && (
        <div className="absolute inset-0 z-220 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5">
            <p className="text-[14px] font-medium text-[#1A1917]">{snapshotError}</p>
            <button
              type="button"
              className="mt-4 rounded-md bg-[#E8462A] px-4 py-2 text-[13px] text-white"
              onClick={() => {
                setSnapshotError(null);
                router.replace('/canvas');
              }}
            >
              Go to canvas
            </button>
          </div>
        </div>
      )}
      {snapshotPayload && (
        <div className="absolute inset-0 z-220 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5">
            <h2 className="text-[16px] font-semibold text-[#1A1917]">Load shared canvas?</h2>
            <p className="mt-2 text-[13px] text-[#6B6860]">
              Opening this link will replace your current canvas. This cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-md bg-[#E8462A] px-4 py-2 text-[13px] text-white"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(snapshotPayload) as unknown[];
                    const state = useCanvasStore.getState();
                    const appState: LocalCanvasState = {
                      theme: effectiveTheme === 'dark' ? 'dark' : 'light',
                      zoom: state.zoom,
                      panX: state.panX,
                      panY: state.panY,
                      currentStrokeColor: state.currentStrokeColor,
                      currentBackgroundColor: state.currentBackgroundColor,
                      currentStrokeWidth: state.currentStrokeWidth,
                      currentRoughness: state.currentRoughness,
                      currentStrokeStyle: state.currentStrokeStyle,
                      currentFillStyle: state.currentFillStyle,
                      activeTool: state.activeTool,
                    };
                    setElements(parsed as never[], { skipHistory: true });
                    setSelectedIds(new Set<string>());
                    saveLocalCanvasToStorage(parsed as never[], appState);
                  } catch {
                    setSnapshotError('This shared canvas link is invalid or has expired.');
                  } finally {
                    setSnapshotPayload(null);
                    router.replace('/canvas');
                  }
                }}
              >
                Load
              </button>
              <button
                type="button"
                className="rounded-md border border-[#D4D0C9] px-4 py-2 text-[13px] text-[#1A1917]"
                onClick={() => {
                  setSnapshotPayload(null);
                  setElements([], { skipHistory: true });
                  setSelectedIds(new Set<string>());
                  router.replace('/canvas');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <TopBar />
      <CanvasBootstrap mode="local" theme={effectiveTheme} />

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
        <CanvasToolbar />
        <p className="text-xs text-hint-text text-pretty text-center max-w-md px-2">
          To move canvas, hold{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-hint-bg border border-toolbar-border text-hint-text font-mono text-[10px]">
            Scroll wheel
          </kbd>{' '}
          or{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-hint-bg border border-toolbar-border text-hint-text font-mono text-[10px]">
            Space
          </kbd>{' '}
          while dragging, or use the hand tool.
        </p>
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      {showScrollBack && (
        <button
          type="button"
          onClick={scrollBackToContent}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-toolbar-bg border border-toolbar-border text-foreground text-sm font-medium shadow-lg hover:bg-tool-hover-bg transition-colors duration-150 pointer-events-auto"
          aria-label="Scroll back to content"
        >
          Scroll back to content
        </button>
      )}

      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          className="size-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:opacity-90 transition-opacity"
          aria-label="Status"
        >
          <Check className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="size-10 rounded-full bg-toolbar-bg border border-toolbar-border text-foreground flex items-center justify-center shadow-md hover:bg-tool-hover-bg transition-colors duration-150"
          aria-label="Help"
        >
          <HelpCircle className="size-5" />
        </button>
      </div>

      <CommandPalette />
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-canvas-bg">
          <div className="size-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        </div>
      }
    >
      <CanvasContent />
    </Suspense>
  );
}
