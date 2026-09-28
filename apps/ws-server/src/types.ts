import { WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';

export interface UserConnection {
  userId: string;
  displayName: string;
  color: string;
  ws: WebSocket;
  isAlive: boolean;
  /** Re-check the connection's room authorization during passive sweeps. */
  revalidate?: () => Promise<boolean>;
}

export interface Cursor {
  x: number;
  y: number;
}

export interface ElementLock {
  userId: string;
  lastHeartbeat: number;
}

export interface UserViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface RoomState {
  roomId: string;
  elements: Map<string, DriplElement>;
  users: Map<string, UserConnection>;
  cursors: Map<string, Cursor>;
  loadedFromDb: boolean;
  loadingPromise?: Promise<Map<string, DriplElement>>;
  saving: boolean;
  recordType?: 'file' | 'canvasRoom';
  /** Database version used as an optimistic persistence fence. */
  lastPersistedUpdatedAt?: Date;
  dirty: boolean;
  /** Monotonic mutation generation used to prevent an in-flight save from clearing newer work. */
  mutationVersion: number;
  recentMsgIds: Set<string>;
  elementLocks: Map<string, ElementLock>;
  following: Map<string, string>;
  viewports: Map<string, UserViewport>;
}
