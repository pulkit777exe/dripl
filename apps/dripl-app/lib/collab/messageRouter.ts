import type { DriplElement } from '@dripl/common';
import { useCanvasStore } from '@/lib/store';
import type { RemoteCursor, RemoteUser } from '@/lib/store/helpers';
import { filterReplayPending } from './sceneDelta';
import type { ServerMessage } from './protocol';

export interface RemoteElementsHandler {
  (added: DriplElement[], updated: DriplElement[], deleted: string[]): void;
}

export interface FullSyncHandler {
  (elements: DriplElement[]): void;
}

interface Ref<T> {
  current: T;
}

/**
 * Context for the collaboration message router.
 *
 * All hook-owned mutable state arrives as refs (stable identity, read at
 * dispatch time), all store writes as the stable Zustand actions. This keeps
 * the router a pure dispatch function over its inputs — no hook calls, no
 * JSX — so it can live outside the 800-line `useCollaboration` orchestrator
 * without changing a single merge semantic.
 */
export interface MessageRouterContext {
  activeUserIdRef: Ref<string>;
  prevElementsRef: Ref<DriplElement[]>;
  isFirstSyncRef: Ref<boolean>;
  pendingElementsRef: Ref<DriplElement[] | null>;
  followedUserIdRef: Ref<string | null>;
  onRemoteElementsRef: Ref<RemoteElementsHandler | undefined>;
  onFullSyncRef: Ref<FullSyncHandler | undefined>;
  setUserId: (userId: string) => void;
  setIsStoreConnected: (connected: boolean) => void;
  setRemoteUsers: (users: Map<string, RemoteUser>) => void;
  updateRemoteCursor: (userId: string, cursor: Omit<RemoteCursor, 'updatedAt'>) => void;
  addRemoteUser: (user: RemoteUser) => void;
  removeRemoteUser: (userId: string) => void;
  setElementLock: (elementId: string, userId: string) => void;
  releaseElementLock: (elementId: string) => void;
  /** Re-run the coalesced outbound broadcast (healing / post-sync replay). */
  flushElementBroadcast: () => void;
  /** Send raw text on the current socket (offline-queue replay path). */
}

function refreshBaselineAfterRemote(ctx: MessageRouterContext): void {
  ctx.prevElementsRef.current = useCanvasStore.getState().elements;
}

function guestName(userName?: string, displayName?: string): string {
  return displayName ?? userName ?? 'Guest';
}

function handleSyncRoomState(
  message: Extract<ServerMessage, { type: 'sync_room_state' | 'room-state' }>,
  ctx: MessageRouterContext
): void {
  const previousLocalElements = ctx.prevElementsRef.current;
  const synchronizedUserId =
    typeof message.yourUserId === 'string' && message.yourUserId.length > 0
      ? message.yourUserId
      : ctx.activeUserIdRef.current;
  ctx.activeUserIdRef.current = synchronizedUserId;
  ctx.setUserId(synchronizedUserId);
  ctx.onFullSyncRef.current?.(message.elements);
  ctx.prevElementsRef.current = message.elements;
  ctx.isFirstSyncRef.current = false;
  ctx.setIsStoreConnected(true);
  if (typeof message.readOnly === 'boolean') {
    useCanvasStore.getState().setReadOnly(message.readOnly);
  }

  const initialUsers = message.users.filter(user => user.userId !== synchronizedUserId);
  ctx.setRemoteUsers(
    new Map(
      initialUsers.map(user => [
        user.userId,
        {
          userId: user.userId,
          userName: guestName(user.userName, user.displayName),
          color: user.color,
        },
      ])
    )
  );
  // Cursor positions arrive via updateRemoteCursor below and live
  // cursor-move messages; the collaborators view derives from the
  // store, so no second map is kept here.
  for (const cursor of message.cursors ?? []) {
    if (cursor.userId === synchronizedUserId) continue;
    ctx.updateRemoteCursor(cursor.userId, {
      x: cursor.x,
      y: cursor.y,
      userName: guestName(cursor.userName, cursor.displayName),
      color: cursor.color,
    });
  }

  // The server has now completed join authorization and loaded the room. Send the
  // latest coalesced snapshot if one is waiting.
  //
  // There is deliberately **no offline message queue here.** One used to exist: a
  // `send()` branch that enqueued scene messages whenever the socket was not open,
  // plus this replay loop that drained it. It was unreachable -- the only two callers
  // that sent a scene-typed message sat *behind* `flushElementBroadcast`'s
  // `readyState !== OPEN` guard, so the queue was never populated and this loop always
  // iterated an empty array. Proven by deleting both halves and watching every test
  // still pass.
  //
  // What actually carries work made while disconnected is `pendingElementsRef` plus the
  // flush immediately below: `flushElementBroadcast` returns at its readyState guard
  // rather than sending, so the snapshot is retained and re-sent once an authoritative
  // sync lands. That is the whole recovery mechanism, and it is one path rather than
  // two.
  //
  // Excalidraw takes the same position: its collab client has no offline queue either,
  // and handles a dropped connection with a warning banner rather than a buffer that
  // implies durability it does not provide.
  //
  // If an element that existed in our last local snapshot is absent from the
  // authoritative sync, pending updates to that ID are treated as stale rather than
  // resurrecting a server-side deletion. This is a conservative reconnect guard; the
  // server still needs durable tombstones for a complete CRDT-style convergence
  // guarantee.
  const serverIds = new Set(message.elements.map(element => element.id));
  const previousIds = new Set(previousLocalElements.map(element => element.id));
  if (ctx.pendingElementsRef.current) {
    const filteredPending = filterReplayPending(
      ctx.pendingElementsRef.current,
      previousIds,
      serverIds
    );
    ctx.pendingElementsRef.current = filteredPending.length > 0 ? filteredPending : null;
    if (ctx.pendingElementsRef.current) ctx.flushElementBroadcast();
  }
}

/**
 * Merge a server scene batch into the local scene and refresh the outbound
 * delta baseline. Empty batches are no-ops so baseline identity is stable
 * when nothing changed.
 */
function mergeSceneBatch(
  ctx: MessageRouterContext,
  added: DriplElement[],
  updated: DriplElement[],
  deleted: string[]
): void {
  if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
    ctx.onRemoteElementsRef.current?.(added, updated, deleted);
    refreshBaselineAfterRemote(ctx);
  }
}

/**
 * Route one parsed server message. Returns `true` when the message was
 * handled (including intentional no-ops); unknown shapes return `false`.
 */
export function routeCollabMessage(message: ServerMessage, ctx: MessageRouterContext): boolean {
  if (message.type === 'sync_room_state' || message.type === 'room-state') {
    handleSyncRoomState(message, ctx);
    return true;
  }

  if (message.type === 'scene-update') {
    if (message.subtype === 'init') {
      // Legacy init packets are treated as a merge, matching the active
      // server's versioned reconciliation semantics. The authoritative
      // replacement path is sync_room_state above; treating init as a
      // blind local replacement can make the client and server diverge
      // when a stale packet omits newer elements.
      ctx.onRemoteElementsRef.current?.(message.elements, [], []);
      refreshBaselineAfterRemote(ctx);
    } else {
      // Legacy `update` packets may contain only the accepted subset.
      // Treat them as a delta and keep the full local baseline used to
      // compute the next outgoing delta.
      ctx.onRemoteElementsRef.current?.(message.elements, [], []);
      refreshBaselineAfterRemote(ctx);
    }
    return true;
  }

  if (message.type === 'scene-delta') {
    mergeSceneBatch(ctx, message.added || [], message.updated || [], message.deleted || []);
    return true;
  }

  // NOTE: the server fans every scene mutation out as `scene-delta`
  // (uniform relay — see apps/ws-server/src/handlers/scene.ts), so there
  // are intentionally no `add_element` / `update_element` / `delete_element`
  // / `element-update` receiver branches here. Those shapes only ever
  // travel client→server from legacy senders.

  if (message.type === 'cursor_move' || message.type === 'cursor-move') {
    if (message.userId === ctx.activeUserIdRef.current) return true;
    ctx.updateRemoteCursor(message.userId, {
      x: message.x,
      y: message.y,
      userName: guestName(message.userName, message.displayName),
      color: message.color,
    });
    return true;
  }

  if (message.type === 'user_join' || message.type === 'user-join') {
    if (message.userId === ctx.activeUserIdRef.current) return true;
    ctx.addRemoteUser({
      userId: message.userId,
      userName: guestName(message.userName, message.displayName),
      color: message.color,
    });
    return true;
  }

  if (message.type === 'user_leave' || message.type === 'user-leave') {
    // removeRemoteUser also drops that user's cursor from the store.
    ctx.removeRemoteUser(message.userId);
    return true;
  }

  if (message.type === 'element-lock') {
    ctx.setElementLock(message.elementId, message.userId);
    return true;
  }

  if (message.type === 'element-unlock') {
    ctx.releaseElementLock(message.elementId);
    return true;
  }

  if (message.type === 'viewport-update') {
    // Apply viewport from followed user
    if (ctx.followedUserIdRef.current === message.userId) {
      const store = useCanvasStore.getState();
      store.setPan(message.panX, message.panY);
      store.setZoom(message.zoom);
    }
    return true;
  }

  // `pong` (heartbeat acks, incl. clientMsgId dedup acks) and `error`
  // carry no scene state; the socket lifecycle owns them.
  return false;
}
