import { WebSocket } from 'ws';

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

export interface RoomState {
  roomId: string;
  elements: Map<string, DriplElement>;
  users: Map<string, UserConnection>;
  cursors: Map<string, Cursor>;
  loadedFromDb: boolean;
  saving: boolean;
}

import type { DriplElement } from '@dripl/common';

export interface RateLimitInfo {
  count: number;
  resetAt: number;
}
