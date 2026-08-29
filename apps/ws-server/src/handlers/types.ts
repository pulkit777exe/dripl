import type { WebSocket } from 'ws';
import type { z } from 'zod';
import type { RoomState, UserConnection } from '../types.js';

export type HandlerLogger = {
  debug: (entry: Record<string, unknown>) => void;
  warn: (entry: Record<string, unknown>) => void;
  error: (entry: Record<string, unknown>) => void;
  info: (entry: Record<string, unknown>) => void;
};

export interface HandlerCtx {
  ws: WebSocket;
  user: UserConnection;
  roomId: string;
  userId: string;
  room: RoomState;
  logger: HandlerLogger;
}

export interface Handler<TSchema extends z.ZodTypeAny, TPayload = z.infer<TSchema>> {
  type: string;
  schema: TSchema;
  apply: (msg: TPayload, ctx: HandlerCtx) => void | Promise<void>;
}
