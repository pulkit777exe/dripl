import { WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';
import type { YjsRoomState } from './yjsManager';

export interface UserConnection {
  userId: string;
  displayName: string;
  color: string;
  ws: WebSocket;
  isAlive: boolean;
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
  saving: boolean;
  recordType?: 'file' | 'canvasRoom';
  yjs?: YjsRoomState;
  dirty: boolean;
  recentMsgIds: Set<string>;
  elementLocks: Map<string, ElementLock>;
  following: Map<string, string>;
  viewports: Map<string, UserViewport>;
}

export interface RateLimitInfo {
  count: number;
  resetAt: number;
}
