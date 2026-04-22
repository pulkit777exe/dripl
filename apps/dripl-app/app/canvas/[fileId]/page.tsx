'use client';

import React, { useEffect, useState } from 'react';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { useTheme } from '@/hooks/useTheme';
import { TopBar } from '@/components/canvas/TopBar';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import { useAuth } from '@/app/context/AuthContext';
import { apiClient } from '@/lib/api';
import { Spinner } from '@/components/button/Spinner';
import HelpModal from '@/components/canvas/HelpModal';

interface CanvasFilePageProps {
  params: Promise<{
    fileId: string;
  }>;
}

export default function CanvasFilePage({ params }: CanvasFilePageProps) {
  const { fileId: roomId } = React.use(params);
  const { effectiveTheme } = useTheme();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [isLoadingRoom, setIsLoadingRoom] = useState(true);
  const [roomMissing, setRoomMissing] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/canvas/${roomId}`)}`);
      return;
    }

    let cancelled = false;
    const checkRoom = async () => {
      try {
        await apiClient.getCanvasRoom(roomId);
        if (!cancelled) setRoomMissing(false);
      } catch (error) {
        const err = error as { status?: number };
        if (err.status === 404) {
          if (!cancelled) setRoomMissing(true);
        } else {
          console.error('Failed to load room', error);
          if (!cancelled) setRoomMissing(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRoom(false);
        }
      }
    };

    void checkRoom();

    return () => {
      cancelled = true;
    };
  }, [authLoading, roomId, router, user]);

  useEffect(() => {
    const handleOpenHelp = () => setIsHelpOpen(true);
    window.addEventListener('dripl:open-help', handleOpenHelp as EventListener);
    return () => window.removeEventListener('dripl:open-help', handleOpenHelp as EventListener);
  }, []);

  if (authLoading || isLoadingRoom) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8]">
        <Spinner className="size-6 text-[#7a7267]" />
      </div>
    );
  }
  if (roomMissing) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8] p-6">
        <div className="max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5">
          <p className="text-[14px] font-medium text-[#1A1917]">
            This collaboration session has ended or doesn&apos;t exist.
          </p>
          <button
            type="button"
            className="mt-4 rounded-md bg-[#E8462A] px-4 py-2 text-[13px] text-white"
            onClick={() => router.push('/canvas')}
          >
            Go to canvas
          </button>
        </div>
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
      <CanvasBootstrap mode="room" roomSlug={roomId} theme={effectiveTheme} />

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
        <CanvasToolbar />
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="size-10 rounded-xl bg-toolbar-bg border border-toolbar-border text-foreground flex items-center justify-center shadow-md hover:bg-tool-hover-bg transition-colors duration-150"
          aria-label="Help"
        >
          <HelpCircle className="size-5" />
        </button>
        <button
          type="button"
          className="size-10 rounded-xl bg-tool-active-bg border border-tool-active-shadow text-tool-active-text flex items-center justify-center shadow-md"
          aria-label="Verification status"
          title="Verified"
        >
          <ShieldCheck className="size-5" />
        </button>
      </div>

      <CommandPalette />
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </div>
  );
}
