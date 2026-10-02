'use client';

import { useEffect, useState } from 'react';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { apiClient } from '@/lib/api';
import { useCanvasStore } from '@/lib/store';

interface BoardPageProps {
  params: Promise<{ token: string }>;
}

type SharedRoom = Awaited<ReturnType<typeof apiClient.getSharedRoom>>;

function parseRoomContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return { elements: [] };
  }
}

export default function SharedBoardPage({ params }: BoardPageProps) {
  const [room, setRoom] = useState<SharedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void params.then(async ({ token }) => {
      try {
        const result = await apiClient.getSharedRoom(token);
        if (!cancelled) {
          const store = useCanvasStore.getState();
          store.setElements([], { skipHistory: true });
          store.clearSelection();
          setRoom(result);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : 'Unable to load this board.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F0EDE6]" role="status">
        Loading shared board...
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F0EDE6] p-6">
        <section className="max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-6 text-center">
          <h1 className="text-lg font-semibold text-[#1A1917]">Board unavailable</h1>
          <p className="mt-2 text-sm text-[#6B6860]">
            {error ?? 'This share link is invalid or expired.'}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#F0EDE6]">
      <div
        className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-[#E4E0D9] bg-[#FAFAF7]/95 px-4 py-2 text-xs text-[#6B6860] shadow-sm"
        role="status"
      >
        {room.room.name} · Read-only shared preview
      </div>
      <CanvasBootstrap
        mode="file"
        initialData={parseRoomContent(room.room.content)}
        theme="light"
        readOnly
        replaceExisting
      />
    </main>
  );
}
