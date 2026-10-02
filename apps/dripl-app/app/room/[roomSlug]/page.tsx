'use client';

import { use } from 'react';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { useTheme } from '@/hooks/useTheme';

interface PageProps {
  params: Promise<{ roomSlug: string }>;
}

export default function RoomEditorPage({ params }: PageProps) {
  const { roomSlug } = use(params);
  const { effectiveTheme } = useTheme();

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      <CanvasBootstrap mode="room" roomSlug={roomSlug} theme={effectiveTheme} />
      <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
        <CanvasToolbar />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto">
          <CanvasControls />
        </div>
      </div>
    </main>
  );
}
