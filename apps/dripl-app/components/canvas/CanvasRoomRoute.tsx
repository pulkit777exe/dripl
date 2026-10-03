'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { useTheme } from '@/hooks/useTheme';
import { TopBar } from '@/components/canvas/TopBar';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasErrorBoundary } from '@/components/canvas/CanvasErrorBoundary';
import HelpModal from '@/components/canvas/HelpModal';

const CommandPalette = dynamic(
  () => import('@/components/canvas/CommandPalette').then(m => m.CommandPalette),
  { ssr: false }
);

/**
 * The interactive half of a collaboration room.
 *
 * Nothing here fetches the room. `app/canvas/[fileId]/page.tsx` did that on the
 * server and, if the room was gone, rendered the "session has ended" panel
 * instead of mounting this at all. That is the whole point of the split: the
 * route that can decide the outcome decides it before a byte of canvas code
 * ships, instead of after hydration has already put a spinner on screen.
 *
 * What genuinely stays client-side is the canvas itself — pointer handlers, the
 * spatial index, the render loop, and the theme, which is only known in the
 * browser because `next-themes` resolves it from `localStorage`/`system`.
 */
export function CanvasRoomRoute({ roomId }: { roomId: string }) {
  const { effectiveTheme } = useTheme();
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    const handleOpenHelp = () => setIsHelpOpen(true);
    window.addEventListener('dripl:open-help', handleOpenHelp as EventListener);
    return () => window.removeEventListener('dripl:open-help', handleOpenHelp as EventListener);
  }, []);

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

      <CanvasErrorBoundary name="TopBar">
        <TopBar />
      </CanvasErrorBoundary>
      <CanvasBootstrap mode="room" roomSlug={roomId} theme={effectiveTheme} />

      <div className="absolute left-1/2 top-16 z-30 -translate-x-1/2 sm:top-4">
        <CanvasErrorBoundary name="CanvasToolbar">
          <CanvasToolbar />
        </CanvasErrorBoundary>
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasErrorBoundary name="CanvasControls">
          <CanvasControls />
        </CanvasErrorBoundary>
      </div>

      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="canvas-chrome-btn size-10"
          aria-label="Help"
        >
          <HelpCircle className="size-5" />
        </button>
        <span
          className="canvas-chrome-btn size-10"
          aria-label="Verification status"
          title="Verified"
          role="status"
        >
          <ShieldCheck className="size-5" />
        </span>
      </div>

      <CanvasErrorBoundary name="CommandPalette">
        <CommandPalette />
      </CanvasErrorBoundary>
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
