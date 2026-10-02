import type { DriplElement } from '@dripl/common';

// JSON scene deltas are the wire protocol. A previous revision kept a dormant
// Yjs adapter behind YJS_WIRE_ENABLED=false; it gated only reads while write
// paths duplicated state into a Y.Doc, so it was removed outright (2026-09-27)
// rather than left to rot. Reintroducing Yjs is a protocol project, not a
// flag flip — see docs/collaboration-crdt-e2ee-decision.md.

export interface CollabUser {
  userId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface UseCollaborationOptions {
  onRemoteElements?: (added: DriplElement[], updated: DriplElement[], deleted: string[]) => void;
  onFullSync?: (elements: DriplElement[]) => void;
  displayName?: string | null;
  /** Public file-share token; it is exchanged for a short-lived WS ticket. */
  shareToken?: string | null;
}

export type ServerMessage =
  | {
      type: 'room-state' | 'sync_room_state';
      elements: DriplElement[];
      users: { userId: string; userName?: string; displayName?: string; color: string }[];
      cursors?: Array<{
        userId: string;
        x: number;
        y: number;
        userName?: string;
        displayName?: string;
        color: string;
      }>;
      yourUserId?: string;
      readOnly?: boolean;
    }
  | {
      type: 'scene-update';
      subtype: 'init' | 'update';
      elements: DriplElement[];
    }
  | {
      type: 'scene-delta';
      added?: DriplElement[];
      updated?: DriplElement[];
      deleted?: string[];
    }
  // NOTE: single-element shapes (`add_element` etc.) travel client→server
  // only; the server relays every mutation as `scene-delta` (uniform relay),
  // so they are deliberately absent from the server→client union below.
  | {
      type: 'cursor-move' | 'cursor_move';
      userId: string;
      x: number;
      y: number;
      userName?: string;
      displayName?: string;
      color: string;
    }
  | {
      type: 'user_join' | 'user-join';
      userId: string;
      userName?: string;
      displayName?: string;
      color: string;
    }
  | { type: 'user_leave' | 'user-leave'; userId: string }
  | { type: 'element-lock'; elementId: string; userId: string }
  | { type: 'element-unlock'; elementId: string; userId: string }
  | { type: 'viewport-update'; userId: string; panX: number; panY: number; zoom: number }
  | { type: 'pong'; timestamp?: number }
  | { type: 'error'; message: string };

export type ClientMessage =
  | {
      type: 'join';
      roomId: string;
      userId: string;
      displayName: string;
      color: string;
    }
  | { type: 'leave' }
  | {
      type: 'scene-update';
      subtype: 'init' | 'update';
      elements: DriplElement[];
      clientMsgId?: string;
    }
  | {
      type: 'scene-delta';
      added?: DriplElement[];
      updated?: DriplElement[];
      deleted?: string[];
      clientMsgId?: string;
    }
  | {
      type: 'cursor-move';
      x: number;
      y: number;
      userName: string;
      displayName: string;
      color: string;
    }
  | { type: 'element-lock'; elementId: string }
  | { type: 'element-unlock'; elementId: string }
  | { type: 'element-lock-heartbeat'; elementId: string }
  | { type: 'viewport-update'; panX: number; panY: number; zoom: number }
  | { type: 'follow-user'; targetUserId: string }
  | { type: 'unfollow-user' }
  | { type: 'ping' };

export interface UseCollaborationReturn {
  isConnected: boolean;
  connectionMessage: string;
  collaborators: CollabUser[];
  broadcastElements: (nextElements: DriplElement[]) => void;
  broadcastCursor: (x: number, y: number) => void;
  lockElement: (_elementId: string) => void;
  unlockElement: (_elementId: string) => void;
  heartbeatLockElement: (_elementId: string) => void;
  followUser: (_targetUserId: string) => void;
  unfollowUser: () => void;
  broadcastViewport: (_panX: number, _panY: number, _zoom: number) => void;
  disconnect: () => void;
}
