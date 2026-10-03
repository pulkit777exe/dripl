'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
// `@dripl/utils/encryption`, not the package root. The root barrel also
// re-exports `./auth` (jsonwebtoken, and with it semver and seven lodash.*
// packages) and `./logger` (pino, and with it quick-format-unescaped), so a
// two-symbol import of the Web Crypto helpers used to ship a JWT verifier and a
// structured logger to every recipient of a share link — roughly 60 kB of
// generated JavaScript that this component never calls. The subpath export is
// already declared in `packages/utils/package.json`, and the whole
// `@dripl/utils/encryption` module depends on nothing outside itself.
import { base64ToKey, decrypt } from '@dripl/utils/encryption';
import { DriplElementSchema, MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { z } from 'zod';
import { useCanvasStore } from '@/lib/store';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { TopBar } from '@/components/canvas/TopBar';
import { Spinner } from '@/components/button/Spinner';
import type { SharedFileResponse } from '@/lib/api';

const CommandPalette = dynamic(
  () => import('@/components/canvas/CommandPalette').then(m => m.CommandPalette),
  { ssr: false }
);

export type SharedCanvasRouteProps = {
  token: string;
  /**
   * The share response, fetched by `app/share/[token]/page.tsx` on the server.
   *
   * It is passed down rather than re-fetched in the browser so the recipient
   * sees the canvas in the first HTML response instead of a spinner followed by
   * an API round trip. Decryption still happens here: the key travels in the URL
   * fragment, which by definition never reaches the server.
   */
  share: SharedFileResponse;
};

/**
 * The interactive half of a shared canvas.
 *
 * What the server already did: resolved the token, decided view versus edit, and
 * fetched the payload. What only the browser can do: read
 * `window.location.hash`, derive the AES key, and decrypt. So the scene itself
 * may still arrive a beat after the frame — but the frame, the file name, and
 * the view-only badge are server-rendered, which is the part a share recipient
 * looks at first.
 */
export function SharedCanvasRoute({ token, share }: SharedCanvasRouteProps) {
  const permission = share.permission === 'edit' ? 'edit' : 'view';
  // Decryption is the only remaining asynchronous step, and only for an
  // encrypted share. A plain share has its elements in `share` already.
  const [scene, setScene] = useState<{ elements: DriplElement[] } | 'pending' | { error: string }>(
    share.encryptedPayload ? 'pending' : { elements: [] }
  );

  const setElements = useCanvasStore(state => state.setElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);
  const setUserId = useCanvasStore(state => state.setUserId);

  useEffect(() => {
    if (scene !== 'pending') return;
    let cancelled = false;

    const loadScene = async () => {
      try {
        let nextElements: unknown[] = [];

        if (share.encryptedPayload) {
          const keyBase64 = readKeyFromHash();
          if (!keyBase64) {
            throw new Error('Missing encryption key in share URL fragment.');
          }
          const cryptoKey = await base64ToKey(keyBase64);
          const decrypted = await decrypt<unknown[]>(share.encryptedPayload, cryptoKey);
          nextElements = Array.isArray(decrypted) ? decrypted : [];
        } else {
          nextElements = Array.isArray(share.elements) ? share.elements : [];
        }

        const parsedElements = z
          .array(DriplElementSchema)
          .max(MAX_SCENE_ELEMENTS)
          .safeParse(nextElements);
        if (!parsedElements.success) {
          throw new Error('Shared scene contains invalid elements.');
        }
        const typedElements = parsedElements.data as DriplElement[];
        if (cancelled) return;

        setElements(typedElements, { skipHistory: true });
        setSelectedIds(new Set<string>());
        setFileMetadata(share.file.id, share.file.name);
        setUserId(crypto.randomUUID());
        setScene({ elements: typedElements });
      } catch (error) {
        if (cancelled) return;
        setScene({
          error: error instanceof Error ? error.message : 'Unable to open share link',
        });
      }
    };

    void loadScene();
    return () => {
      cancelled = true;
    };
  }, [
    scene,
    setElements,
    setFileMetadata,
    setSelectedIds,
    setUserId,
    share.elements,
    share.encryptedPayload,
    share.file.id,
    share.file.name,
  ]);

  const readOnly = permission === 'view';
  const roomSlug = useMemo(() => share.file.id, [share.file.id]);

  if (typeof scene === 'object' && 'error' in scene) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8] px-6">
        <p className="max-w-xl text-center text-[#8a2d20]">{scene.error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#f5f0e8]">
      {!readOnly && <TopBar />}
      {scene === 'pending' ? (
        // Only an encrypted share reaches this branch, and only for the length
        // of one WebCrypto round trip. The badge and chrome are already painted,
        // so this is an overlay rather than a page takeover.
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#f5f0e8]">
          <Spinner className="size-6 text-[#7a7267]" />
        </div>
      ) : (
        <CanvasBootstrap
          mode="room"
          roomSlug={roomSlug}
          shareToken={token}
          theme="light"
          readOnly={readOnly}
        />
      )}
      {!readOnly && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 sm:top-6">
          <CanvasToolbar />
        </div>
      )}
      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>
      {!readOnly && <CommandPalette />}
      <div className="absolute bottom-6 right-6 z-20 rounded-lg bg-white/95 px-4 py-2 text-sm font-medium text-[#1a1a1a] shadow">
        {readOnly ? 'View only' : 'Shared edit mode · transport is not E2EE'}
      </div>
    </div>
  );
}

function readKeyFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get('key');
}
