import * as Sentry from '@sentry/node';
import type { WebSocket } from 'ws';
import { messageSchema, validateMessageSize } from './validation';
import { logger } from './logger';
import { send } from './broadcast';
import { checkRateLimit } from './rateLimiter';
import { cursorMoveHandler } from './handlers/cursorMove';
import {
  elementLockHandler,
  elementUnlockHandler,
  elementLockHeartbeatHandler,
} from './handlers/locks';
import { viewportUpdateHandler, followUserHandler, unfollowUserHandler } from './handlers/presence';
import {
  addElementHandler,
  updateElementHandler,
  deleteElementHandler,
  sceneUpdateHandler,
  sceneDeltaHandler,
  elementUpdateHandler,
} from './handlers/scene';
import type { ConnectionSession } from './session';

export type MessageHandler = (raw: Buffer, isBinary?: boolean) => Promise<void>;

/** Message types the room-access gate runs before dispatching. */
export const ROOM_MUTATION_TYPES = new Set([
  'add_element',
  'update_element',
  'delete_element',
  'element-update',
  'scene-update',
  'scene-delta',
  'element-lock',
  'element-unlock',
  'element-lock-heartbeat',
]);

/**
 * Build the per-connection message handler: rate limit, binary refusal, size
 * bound, JSON parse, schema validation, the room-mutation access gate, then the
 * dispatch switch. Extracted verbatim from `onConnection` so the composition
 * root keeps the wiring (serialized queue, close cleanup) and this module owns
 * the message contract.
 */
export function createMessageHandler(opts: {
  ws: WebSocket;
  session: ConnectionSession;
  isShuttingDown(): boolean;
}): MessageHandler {
  const { ws, session, isShuttingDown } = opts;

  return async function handleMessage(raw: Buffer, isBinary = false): Promise<void> {
    if (isShuttingDown()) return;
    try {
      // Rate limit all messages including binary
      if (!(await checkRateLimit(ws))) {
        logger.warn({ event: 'rate_limit_exceeded' });
        ws.close(4000, 'Rate limit exceeded');
        return;
      }

      // Binary collaboration updates were only ever the disabled Yjs wire
      // protocol. Reject binary frames outright rather than sniffing a
      // discriminator for a protocol that no longer exists. NOTE: `ws`
      // delivers text frames as Buffer too, so the frame opcode (`isBinary`)
      // — not `instanceof Buffer` — is the discriminator. Checking
      // `instanceof` here would reject every message on the socket.
      if (isBinary) {
        send(ws, { type: 'error', message: 'Binary collaboration updates are not enabled' });
        return;
      }

      const messageStr = raw.toString();

      const sizeCheck = validateMessageSize(messageStr);
      if (!sizeCheck.valid) {
        send(ws, { type: 'error', message: sizeCheck.error! });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(messageStr);
      } catch (err) {
        logger.debug({
          event: 'invalid_ws_message',
          reason: 'json_parse_error',
          error: String(err),
        });
        return;
      }

      const validation = messageSchema.safeParse(parsed);
      if (!validation.success) {
        return;
      }

      const message = validation.data;
      if (ROOM_MUTATION_TYPES.has(message.type) && !(await session.refresh())) {
        return;
      }

      switch (message.type) {
        case 'join_room':
        case 'join': {
          await session.join(message);
          break;
        }

        case 'leave_room':
        case 'leave': {
          await session.leave();
          break;
        }

        case 'add_element': {
          const joined = session.joined();
          if (!joined) break;
          await addElementHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'update_element': {
          const joined = session.joined();
          if (!joined) break;
          await updateElementHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'delete_element': {
          const joined = session.joined();
          if (!joined) break;
          await deleteElementHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'scene-update': {
          const joined = session.joined();
          if (!joined) break;
          await sceneUpdateHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'scene-delta': {
          const joined = session.joined();
          if (!joined) break;
          await sceneDeltaHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-update': {
          const joined = session.joined();
          if (!joined) break;
          await elementUpdateHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'cursor_move':
        case 'cursor-move': {
          const joined = session.joined();
          if (!joined) break;

          // Already validated against these same schemas by the dispatch
          // prologue's messageSchema pass; parsing again would double the
          // cost of the highest-frequency message on the socket.
          await cursorMoveHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-lock': {
          const joined = session.joined();
          if (!joined) break;
          if (session.rejectReadOnlyMutation()) break;
          await elementLockHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-unlock': {
          const joined = session.joined();
          if (!joined) break;
          await elementUnlockHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'element-lock-heartbeat': {
          const joined = session.joined();
          if (!joined) break;
          await elementLockHeartbeatHandler.apply(
            message,
            session.handlerCtx(joined.room, joined.userId)
          );
          break;
        }

        case 'ping': {
          send(ws, { type: 'pong', timestamp: Date.now() });
          break;
        }

        case 'viewport-update': {
          const joined = session.joined();
          if (!joined) break;
          await viewportUpdateHandler.apply(
            message,
            session.handlerCtx(joined.room, joined.userId)
          );
          break;
        }

        case 'follow-user': {
          const joined = session.joined();
          if (!joined) break;
          await followUserHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }

        case 'unfollow-user': {
          const joined = session.joined();
          if (!joined) break;
          await unfollowUserHandler.apply(message, session.handlerCtx(joined.room, joined.userId));
          break;
        }
      }
    } catch (err) {
      logger.error({ event: 'ws_message_handler_error', err });
      Sentry.captureException(err);
    }
  };
}
