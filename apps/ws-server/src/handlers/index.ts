import { z } from 'zod';
import { cursorMoveHandler } from './cursorMove.js';
import type { Handler } from './types.js';

type AnyHandler = Handler<z.ZodTypeAny, unknown>;

const handlers: ReadonlyMap<string, AnyHandler> = new Map([
  [cursorMoveHandler.type, cursorMoveHandler as AnyHandler],
  // Future handlers register here.
]);

export function getHandler(type: string): AnyHandler | undefined {
  return handlers.get(type);
}

export function listHandlerTypes(): readonly string[] {
  return Array.from(handlers.keys());
}
