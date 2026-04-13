'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { base64ToKey, decrypt } from '@dripl/utils';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/canvas-store';
import { apiClient } from '@/lib/api';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import { TopBar } from '@/components/canvas/TopBar';

interface SharePageProps {
  params: Promise<{
    token: string;
  }>;
}

function readKeyFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get('key');
}

export default function SharedCanvasPage({ params }: SharePageProps) {
  const { token } = React.use(params);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [shareFileId, setShareFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setElements = useCanvasStore(state => state.setElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);
  const setUserId = useCanvasStore(state => state.setUserId);

  useEffect(() => {
    let cancelled = false;

    const loadShare = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.getSharedFile(token);
        if (cancelled) return;

        const nextPermission = response.permission === 'edit' ? 'edit' : 'view';
        setPermission(nextPermission);
        setShareFileId(response.file.id);

        let nextElements: unknown[] = [];
        if (response.encryptedPayload) {
          const keyBase64 = readKeyFromHash();
          if (!keyBase64) {
            throw new Error('Missing encryption key in share URL fragment.');
          }
          const cryptoKey = await base64ToKey(keyBase64);
          const decrypted = await decrypt<unknown[]>(response.encryptedPayload, cryptoKey);
          nextElements = Array.isArray(decrypted) ? decrypted : [];
        } else {
          nextElements = Array.isArray(response.elements) ? response.elements : [];
        }

        const typedElements = nextElements as DriplElement[];
        setElements(typedElements, { skipHistory: true });
        setSelectedIds(new Set<string>());
        setFileMetadata(response.file.id, response.file.name);
        setUserId(crypto.randomUUID());
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to open share link');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadShare();

    return () => {
      cancelled = true;
    };
  }, [setElements, setFileMetadata, setSelectedIds, setUserId, token]);

  const readOnly = permission === 'view';
  const roomSlug = useMemo(() => shareFileId ?? token, [shareFileId, token]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8]">
        <p className="text-[#7a7267]">Loading shared canvas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8] px-6">
        <p className="max-w-xl text-center text-[#8a2d20]">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#f5f0e8]">
      <TopBar />
      <CanvasBootstrap mode="room" roomSlug={roomSlug} theme="light" readOnly={readOnly} />
      {!readOnly && (
        <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2">
          <CanvasToolbar />
        </div>
      )}
      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>
      <CommandPalette />
      <div className="absolute bottom-6 right-6 z-20 rounded-lg bg-white/95 px-4 py-2 text-sm font-medium text-[#1a1a1a] shadow">
        {readOnly ? 'View only' : 'Shared edit mode'}
      </div>
    </div>
  );
}
