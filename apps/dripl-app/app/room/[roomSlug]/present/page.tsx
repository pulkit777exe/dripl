'use client';

import { use, useEffect, useState } from 'react';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { apiClient } from '@/lib/api';

interface PageProps {
  params: Promise<{ roomSlug: string }>;
}

export default function RoomPresentPage({ params }: PageProps) {
  const { roomSlug } = use(params);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiClient
      .getCanvasRoom(roomSlug)
      .then(result => {
        if (!cancelled) setContent(result.room.content);
      })
      .catch(requestError => {
        if (!cancelled)
          setError(requestError instanceof Error ? requestError.message : 'Unable to load room.');
      });
    return () => {
      cancelled = true;
    };
  }, [roomSlug]);

  if (error) return <RoomMessage title="Room unavailable" message={error} />;
  if (content === null)
    return <RoomMessage title="Loading presentation" message="Fetching the shared scene…" />;

  let initialData: unknown = { elements: [] };
  try {
    initialData = JSON.parse(content);
  } catch {
    // Keep malformed persisted content from crashing the presentation route.
  }

  return (
    <main className="h-dvh w-screen overflow-hidden bg-[#F0EDE6]">
      <CanvasBootstrap
        mode="file"
        initialData={initialData}
        theme="light"
        readOnly
        replaceExisting
      />
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
