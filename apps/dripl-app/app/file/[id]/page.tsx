'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { TopBar } from '@/components/canvas/TopBar';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/app/context/AuthContext';
import { useCanvasStore } from '@/lib/canvas-store';

export default function FilePage() {
  const params = useParams<{ id: string }>();
  const { effectiveTheme } = useTheme();
  const { user, token } = useAuth();
  const router = useRouter();
  const setUserId = useCanvasStore(state => state.setUserId);
  const [loading, setLoading] = useState(true);

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
    setLoading(false);
  }, [user, token, setUserId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className={`w-screen h-dvh relative overflow-hidden ${effectiveTheme === 'dark' ? 'bg-[#121112]' : 'bg-[#f7f5f6]'}`}
    >
      <TopBar />
      <CanvasBootstrap mode="local" theme={effectiveTheme} />
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
