import { WebSocket } from 'ws';
import type { RoomState } from './types';

export function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

export function broadcast(room: RoomState, payload: unknown, exceptUserId?: string): void {
  const data = JSON.stringify(payload);
  room.users.forEach(user => {
    if (exceptUserId && user.userId === exceptUserId) return;
    if (user.ws.readyState !== WebSocket.OPEN) return;
    user.ws.send(data);
  });
}

export function roomUsersPayload(room: RoomState) {
  return Array.from(room.users.values()).map(user => ({
    userId: user.userId,
    userName: user.displayName,
    displayName: user.displayName,
    color: user.color,
  }));
}

export function roomCursorsPayload(room: RoomState) {
  return Array.from(room.cursors.entries()).map(([userId, cursor]) => {
    const user = room.users.get(userId);
    return {
      userId,
      x: cursor.x,
      y: cursor.y,
      userName: user?.displayName ?? 'Unknown',
      displayName: user?.displayName ?? 'Unknown',
      color: user?.color ?? '#000000',
    };
  });
}
