'use client';

import { useEffect, useRef } from 'react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import { useCollaboration } from '@/hooks/useCollaboration';
import { reconcileScene } from '@/lib/scene';
import { createTombstoneStore } from '@/lib/collab/tombstones';
import { useGestureLocks } from './useGestureLocks';

interface UseCanvasSyncOptions {
  roomSlug: string | null;
  shareToken?: string | null;
  displayName: string | null;
  elements: DriplElement[];
}

/**
 * Collaboration wiring for the canvas (ActionManager-style extraction).
 *
 * Owns everything that used to live inline in RoughCanvas:
 * - gesture lock mirroring (local ref → `element-lock` messages + remote
 *   reconcile guard),
 * - frontend tombstones (local + applied-remote deletes suppress stale
 *   add/update resurrection),
 * - `useCollaboration` callbacks (authoritative full sync, version-fenced
 *   delta merge),
 * - the broadcast-on-local-change effect with remote-echo suppression,
 * - the read-only-until-initial-sync guard.
 */
export function useCanvasSync({
  roomSlug,
  shareToken = null,
  displayName,
  elements,
}: UseCanvasSyncOptions) {
  const setElements = useCanvasStore(state => state.setElements);

  const suppressRemoteBroadcastRef = useRef(false);
  const hasReceivedInitialSyncRef = useRef(false);
  // Frontend tombstones: ids are scoped to one room scene. A stale remote
  // add/update for a deleted id is ignored instead of resurrecting it.
  const tombstonesRef = useRef(createTombstoneStore());
  const knownIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    hasReceivedInitialSyncRef.current = false;
    suppressRemoteBroadcastRef.current = false;
    tombstonesRef.current.clear();
    knownIdsRef.current = null;
  }, [roomSlug, shareToken]);

  // Gesture-lock guard for remote reconciliation. The collab callbacks are
  // registered below before the gesture hook exists, so they read through
  // this holder — published in an effect, never during render.
  const isGestureLockedRef = useRef<(id: string) => boolean>(() => false);

  const {
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
    heartbeatLockElement,
    isConnected,
    connectionMessage,
  } = useCollaboration(roomSlug, {
    displayName,
    shareToken,
    onFullSync: remoteElements => {
      hasReceivedInitialSyncRef.current = true;
      suppressRemoteBroadcastRef.current = true;
      // A share page's scene comes from the capability link, and for an
      // encrypted share it exists nowhere else: the server stores only the
      // AES-GCM envelope, so that room's authoritative snapshot is legitimately
      // empty (ws-server's `parseStoredElements` finds no `elements` array in an
      // envelope). An empty snapshot there is "this room has no server-side
      // plaintext scene", not "the owner deleted everything", and adopting it
      // replaced a decrypted canvas the recipient could already see with a
      // blank one. The same shape arrives when the join is served by an
      // instance whose room holds nothing for this id.
      //
      // So: keep the link's scene for that one case, and keep the known-id
      // baseline in step with what is actually on screen — tombstoning the ids
      // we are holding would make `reconcileScene` discard every later remote
      // edit to them. Any non-empty snapshot still wins, so live collaboration
      // and the authoritative-sync contract are unchanged.
      const localElements = useCanvasStore.getState().elements;
      const keepShareScene =
        shareToken !== null && remoteElements.length === 0 && localElements.length > 0;
      const nextIds = new Set((keepShareScene ? localElements : remoteElements).map(el => el.id));
      const prevIds = knownIdsRef.current;
      if (prevIds) {
        for (const id of prevIds) {
          if (!nextIds.has(id)) tombstonesRef.current.add(id);
        }
      }
      knownIdsRef.current = nextIds;
      if (!keepShareScene) {
        setElements(remoteElements, { skipHistory: true });
      }
    },
    onRemoteElements: (added, updated, deleted) => {
      const state = useCanvasStore.getState();
      const { nextById, changed, appliedDeleted } = reconcileScene({
        localById: state.elementsById,
        added,
        updated,
        deleted,
        draftId: state.draftElement?.id,
        isLocked: id => isGestureLockedRef.current(id),
        tombstones: tombstonesRef.current,
      });
      if (appliedDeleted.length > 0) tombstonesRef.current.add(appliedDeleted);
      if (changed) {
        suppressRemoteBroadcastRef.current = true;
        state.setElements(Array.from(nextById.values()), { skipHistory: true });
      }
    },
  });

  const { activeGestureLocksRef, lockElementsForGesture, unlockGestureElements, isGestureLocked } =
    useGestureLocks(lockElement, unlockElement, heartbeatLockElement);

  useEffect(() => {
    isGestureLockedRef.current = isGestureLocked;
  }, [isGestureLocked]);

  useEffect(() => {
    if (!roomSlug) return;
    if (suppressRemoteBroadcastRef.current) {
      suppressRemoteBroadcastRef.current = false;
      // Remote-applied change: refresh the baseline without tombstoning.
      // Remote deletes are recorded via appliedDeleted in onRemoteElements.
      knownIdsRef.current = new Set(elements.map(el => el.id));
      return;
    }
    // Local change: ids that vanished since the last baseline are local
    // deletes — tombstone them so a racing remote add cannot resurrect them.
    const prevIds = knownIdsRef.current;
    const nextIds = new Set(elements.map(el => el.id));
    if (prevIds) {
      for (const id of prevIds) {
        if (!nextIds.has(id)) tombstonesRef.current.add(id);
      }
    }
    knownIdsRef.current = nextIds;
    broadcastElements(elements);
  }, [broadcastElements, elements, roomSlug]);

  useEffect(() => {
    if (roomSlug && !hasReceivedInitialSyncRef.current) {
      // Do not let a room page create local edits before the authenticated
      // initial sync. Once sync has arrived, the server's readOnly flag owns
      // the state and offline edits remain queueable.
      useCanvasStore.getState().setReadOnly(true);
    }
  }, [isConnected, roomSlug, shareToken]);

  return {
    activeGestureLocksRef,
    lockElementsForGesture,
    unlockGestureElements,
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
    isConnected,
    connectionMessage,
  };
}
