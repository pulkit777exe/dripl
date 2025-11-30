import { DriplElement } from '@dripl/common';

export type MessageType = 
  | 'add_element'
  | 'update_element'
  | 'delete_element'
  | 'cursor_move'
  | 'user_join'
  | 'user_leave'
  | 'sync_state';

export interface BaseMessage {
  type: MessageType;
  userId: string;
  timestamp: number;
}

export interface AddElementMessage extends BaseMessage {
  type: 'add_element';
  element: DriplElement;
}

export interface UpdateElementMessage extends BaseMessage {
  type: 'update_element';
  element: DriplElement;
}

export interface DeleteElementMessage extends BaseMessage {
  type: 'delete_element';
  elementId: string;
}

export interface CursorMoveMessage extends BaseMessage {
  type: 'cursor_move';
  x: number;
  y: number;
  userName: string;
  color: string;
}

export interface UserJoinMessage extends BaseMessage {
  type: 'user_join';
  userName: string;
  color: string;
}

export interface UserLeaveMessage extends BaseMessage {
  type: 'user_leave';
}

export interface SyncStateMessage extends BaseMessage {
  type: 'sync_state';
  elements: DriplElement[];
  users: Array<{
    userId: string;
    userName: string;
    color: string;
  }>;
}

export type SyncMessage = 
  | AddElementMessage
  | UpdateElementMessage
  | DeleteElementMessage
  | CursorMoveMessage
  | UserJoinMessage
  | UserLeaveMessage
  | SyncStateMessage;

export interface User {
  userId: string;
  userName: string;
  color: string;
  cursorX?: number;
  cursorY?: number;
}
