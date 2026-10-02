'use client';

import { use, useEffect, useState } from 'react';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { apiClient } from '@/lib/api';

interface PageProps {
  params: Promise<{ roomSlug: string }>;
}

export default function RoomViewPage({ params }: PageProps) {
  const [room, setRoom] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { roomSlug } = use(params);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await apiClient.getCanvasRoom(roomSlug);
        if (!cancelled) setRoom({ name: result.room.name, content: result.room.content });
      } catch (requestError) {
        if (!cancelled)
          setError(requestError instanceof Error ? requestError.message : 'Unable to load room.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomSlug]);

  if (error) return <RoomMessage title="Room unavailable" message={error} />;
  if (!room) return <RoomMessage title="Loading room" message="Fetching the shared scene…" />;

  let initialData: unknown = { elements: [] };
  try {
    initialData = JSON.parse(room.content);
  } catch {
    // Keep an empty scene rather than allowing malformed persisted content to
    // crash the canvas bootstrap.
  }

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      <CanvasBootstrap
        mode="file"
        initialData={initialData}
        theme="light"
        readOnly
        replaceExisting
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto">
          <CanvasControls />
        </div>
      </div>
    </main>
  );
}

function RoomMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F0EDE6] p-6">
      <section className="max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-6 text-center">
        <h1 className="text-lg font-semibold text-[#1A1917]">{title}</h1>
        <p className="mt-2 text-sm text-[#6B6860]">{message}</p>
      </section>
    </main>
  );
}
