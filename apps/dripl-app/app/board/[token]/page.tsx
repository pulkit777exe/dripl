import { notFound } from 'next/navigation';
import { db } from '@dripl/db';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import { getInMemoryShare } from '@/lib/share-memory-store';

interface BoardPageProps {
  params: Promise<{ token: string }>;
}

export default async function BoardTokenPage({ params }: BoardPageProps) {
  const { token } = await params;
  const fallback = getInMemoryShare(token);

  let shareData: {
    elements: unknown[];
    permission: string;
    roomName: string;
  } | null = null;

  try {
    const shareLink = await db.shareLink.findFirst({
      where: { token },
      include: {
        room: {
          select: {
            name: true,
            content: true,
          },
        },
      },
    });

    if (shareLink) {
      if (shareLink.expiresAt && shareLink.expiresAt.getTime() < Date.now()) {
        notFound();
      }

      let elements: unknown[] = [];
      try {
        elements = shareLink.room.content ? JSON.parse(shareLink.room.content) : [];
      } catch {
        elements = [];
      }

      shareData = {
        elements,
        permission: shareLink.permission,
        roomName: shareLink.room.name,
      };
    }
  } catch {
    // Fall back to in-memory share
  }

  if (!shareData && !fallback) {
    notFound();
  }

  const permission = shareData
    ? (shareData.permission ?? 'view')
    : (fallback?.permission ?? 'view');
  const readOnly = permission === 'VIEW' || permission === 'view';
  const initialData = shareData?.elements ?? fallback?.elements ?? [];

  return (
    <div className="w-screen h-dvh relative overflow-hidden bg-[#121112]">
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

      <CanvasBootstrap
        mode="file"
        initialData={{
          elements: Array.isArray(initialData) ? initialData : [],
        }}
        theme="dark"
        readOnly={readOnly}
      />

      {!readOnly && (
        <div className="absolute top-0.5 left-1/2 -translate-x-1/2 z-20">
          <CanvasToolbar />
        </div>
      )}

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <CommandPalette />

      {readOnly && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-lg">
          Viewing shared canvas — {shareData?.roomName || 'Shared Board'}
        </div>
      )}
    </div>
  );
}
