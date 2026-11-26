import type { WebSocket } from 'ws';
import type { DriplElement, MovedElement } from '@dripl/common';
import { broadcast, send } from './broadcast';
import { markRoomDirty, scheduleSave } from './rooms';
import { publishToRoom } from './redis';
import {
  acceptAllParsed,
  acceptElement,
  acceptMovedElements,
  acceptSingleValidated,
  acceptValidated,
  noteClientMsgId,
  sceneCapacityMessage,
  wouldExceedSceneCapacity,
} from './sceneMutation';
import { deleteWithTombstone } from './tombstones';
import type { RoomState } from './types';

export type SceneDelta = {
  type: 'scene-delta';
  added?: DriplElement[];
  updated?: DriplElement[];
  deleted?: string[];
  moved?: MovedElement[];
};

export type SceneCommand =
  | { type: 'add_element'; element: DriplElement }
  | { type: 'update_element'; element: DriplElement }
  | { type: 'delete_element'; elementId: string }
  | { type: 'scene-update'; elements: DriplElement[]; clientMsgId?: string }
  | {
      type: 'scene-delta';
      added?: DriplElement[];
      updated?: DriplElement[];
      deleted?: string[];
      moved?: MovedElement[];
      clientMsgId?: string;
    }
  | { type: 'element-update'; elements?: DriplElement[]; element?: DriplElement };

export type CommitStatus =
  | 'accepted'
  | 'no-change'
  | 'read-only'
  | 'capacity'
  | 'deduped'
  | 'invalid';

export interface CommitReceipt {
  status: CommitStatus;
  delta?: SceneDelta;
  changed: boolean;
}

export interface LocalSceneOrigin {
  kind: 'local';
  roomId: string;
  userId: string;
  ws: WebSocket;
  /** Authz boundary. Must be called by commit for defense in depth; handlers
   * also call it first for grep-visible authz. */
  rejectReadOnlyMutation: () => boolean;
}

export interface SceneCommitPorts {
  send(ws: WebSocket, payload: unknown): void;
  broadcast(room: RoomState, payload: unknown, exceptUserId?: string): void;
  publish(roomId: string, payload: object): void | Promise<void>;
  markDirty(roomId: string): void;
  scheduleSave(roomId: string): void;
}

export const defaultSceneCommitPorts: SceneCommitPorts = {
  send,
  broadcast,
  publish: publishToRoom,
  markDirty: markRoomDirty,
  scheduleSave,
};

type ResolvedPorts = SceneCommitPorts;

function resolvePorts(ports?: Partial<SceneCommitPorts>): ResolvedPorts {
  if (!ports) return defaultSceneCommitPorts;
  return { ...defaultSceneCommitPorts, ...ports };
}

function hasDeltaChanges(delta: SceneDelta): boolean {
  return Boolean(
    (delta.added && delta.added.length > 0) ||
      (delta.updated && delta.updated.length > 0) ||
      (delta.deleted && delta.deleted.length > 0) ||
      (delta.moved && delta.moved.length > 0)
  );
}

function compactDelta(delta: SceneDelta): SceneDelta | undefined {
  const out: SceneDelta = { type: 'scene-delta' };
  if (delta.added && delta.added.length > 0) out.added = delta.added;
  if (delta.updated && delta.updated.length > 0) out.updated = delta.updated;
  if (delta.deleted && delta.deleted.length > 0) out.deleted = delta.deleted;
  if (delta.moved && delta.moved.length > 0) out.moved = delta.moved;
  return hasDeltaChanges(out) ? out : undefined;
}

function commitAccepted(
  room: RoomState,
  delta: SceneDelta,
  ports: ResolvedPorts,
  origin?: LocalSceneOrigin
): CommitReceipt {
  const compact = compactDelta(delta);
  if (!compact) {
    return { status: 'no-change', changed: false };
  }

  // Canonical commit-effect order: mutate state has already happened in
  // admission primitives; now make it durable-schedulable and fan it out.
  ports.markDirty(room.roomId);
  ports.scheduleSave(room.roomId);
  ports.broadcast(room, compact, origin?.userId);
  // Fire-and-forget: dispatcher awaits handlers, so awaiting Redis would
  // serialize room throughput behind one REST round-trip per mutation.
  void ports.publish(room.roomId, compact);

  return { status: 'accepted', changed: true, delta: compact };
}

function rejectReadOnly(origin: LocalSceneOrigin): CommitReceipt {
  // Defense in depth: handlers should call first for grep-visible authz, but
  // commit enforces before any mutation/effect.
  origin.rejectReadOnlyMutation();
  return { status: 'read-only', changed: false };
}

function rejectCapacity(origin: LocalSceneOrigin, ports: ResolvedPorts): CommitReceipt {
  ports.send(origin.ws, { type: 'error', message: sceneCapacityMessage() });
  return { status: 'capacity', changed: false };
}

function ackDedup(origin: LocalSceneOrigin, ports: ResolvedPorts): CommitReceipt {
  ports.send(origin.ws, { type: 'pong', timestamp: Date.now() });
  return { status: 'deduped', changed: false };
}

function commitSingleton(
  room: RoomState,
  command: Extract<SceneCommand, { type: 'add_element' | 'update_element' }>,
  origin: LocalSceneOrigin,
  ports: ResolvedPorts
): CommitReceipt {
  if (origin.rejectReadOnlyMutation()) return { status: 'read-only', changed: false };

  const admitted = acceptSingleValidated(room, command.element);
  if (admitted === 'capacity') return rejectCapacity(origin, ports);
  if (admitted === 'rejected') return { status: 'no-change', changed: false };

  const delta: SceneDelta =
    command.type === 'add_element'
      ? { type: 'scene-delta', added: [command.element] }
      : { type: 'scene-delta', updated: [command.element] };
  return commitAccepted(room, delta, ports, origin);
}

function commitDelete(
  room: RoomState,
  elementId: string,
  origin: LocalSceneOrigin,
  ports: ResolvedPorts
): CommitReceipt {
  if (origin.rejectReadOnlyMutation()) return { status: 'read-only', changed: false };

  const deleted = deleteWithTombstone(room, elementId);
  if (!deleted) return { status: 'no-change', changed: false };

  return commitAccepted(
    room,
    { type: 'scene-delta', deleted: [elementId] },
    ports,
    origin
  );
}

function commitSceneUpdate(
  room: RoomState,
  command: Extract<SceneCommand, { type: 'scene-update' }>,
  origin: LocalSceneOrigin,
  ports: ResolvedPorts
): CommitReceipt {
  if (origin.rejectReadOnlyMutation()) return { status: 'read-only', changed: false };

  const elements = command.elements;
  if (!Array.isArray(elements)) return { status: 'invalid', changed: false };

  if (wouldExceedSceneCapacity(room, elements)) {
    return rejectCapacity(origin, ports);
  }

  // Dedup before admission/fence: preserves pinned retry semantics.
  if (noteClientMsgId(room, command.clientMsgId)) {
    return ackDedup(origin, ports);
  }

  const accepted: DriplElement[] = [];
  acceptValidated(room, elements, accepted);
  if (accepted.length === 0) return { status: 'no-change', changed: false };

  return commitAccepted(room, { type: 'scene-delta', added: accepted }, ports, origin);
}

function commitSceneDelta(
  room: RoomState,
  command: Extract<SceneCommand, { type: 'scene-delta' }>,
  origin: LocalSceneOrigin,
  ports: ResolvedPorts
): CommitReceipt {
  if (origin.rejectReadOnlyMutation()) return { status: 'read-only', changed: false };

  // Dedup before admission/fence: preserves pinned retry semantics.
  if (noteClientMsgId(room, command.clientMsgId)) {
    return ackDedup(origin, ports);
  }

  const prospectiveElements = [
    ...(Array.isArray(command.added) ? command.added : []),
    ...(Array.isArray(command.updated) ? command.updated : []),
  ];
  if (wouldExceedSceneCapacity(room, prospectiveElements)) {
    return rejectCapacity(origin, ports);
  }

  const acceptedAdded: DriplElement[] = [];
  const acceptedUpdated: DriplElement[] = [];
  const acceptedDeleted: string[] = [];
  const acceptedMoved: MovedElement[] = [];

  if (Array.isArray(command.added)) {
    acceptValidated(room, command.added, acceptedAdded);
  }
  if (Array.isArray(command.updated)) {
    acceptValidated(room, command.updated, acceptedUpdated);
  }
  if (Array.isArray(command.deleted)) {
    for (const id of command.deleted) {
      if (deleteWithTombstone(room, id)) acceptedDeleted.push(id);
    }
  }
  if (Array.isArray(command.moved)) {
    acceptedMoved.push(...acceptMovedElements(room, command.moved));
  }

  return commitAccepted(
    room,
    {
      type: 'scene-delta',
      added: acceptedAdded,
      updated: acceptedUpdated,
      deleted: acceptedDeleted,
      moved: acceptedMoved,
    },
    ports,
    origin
  );
}

function commitElementUpdate(
  room: RoomState,
  command: Extract<SceneCommand, { type: 'element-update' }>,
  origin: LocalSceneOrigin,
  ports: ResolvedPorts
): CommitReceipt {
  if (origin.rejectReadOnlyMutation()) return { status: 'read-only', changed: false };

  if (Array.isArray(command.elements)) {
    if (wouldExceedSceneCapacity(room, command.elements)) {
      return rejectCapacity(origin, ports);
    }
    const accepted: DriplElement[] = [];
    acceptValidated(room, command.elements, accepted);
    if (accepted.length === 0) return { status: 'no-change', changed: false };
    return commitAccepted(room, { type: 'scene-delta', updated: accepted }, ports, origin);
  }

  if (!command.element) return { status: 'invalid', changed: false };

  const admitted = acceptSingleValidated(room, command.element);
  if (admitted === 'capacity') return rejectCapacity(origin, ports);
  if (admitted === 'rejected') return { status: 'no-change', changed: false };

  return commitAccepted(room, { type: 'scene-delta', updated: [command.element] }, ports, origin);
}

export function commitLocalSceneCommand(
  room: RoomState,
  command: SceneCommand,
  origin: LocalSceneOrigin,
  ports?: Partial<SceneCommitPorts>
): CommitReceipt {
  const resolved = resolvePorts(ports);

  switch (command.type) {
    case 'add_element':
    case 'update_element':
      return commitSingleton(room, command, origin, resolved);
    case 'delete_element':
      return commitDelete(room, command.elementId, origin, resolved);
    case 'scene-update':
      return commitSceneUpdate(room, command, origin, resolved);
    case 'scene-delta':
      return commitSceneDelta(room, command, origin, resolved);
    case 'element-update':
      return commitElementUpdate(room, command, origin, resolved);
    default:
      return { status: 'invalid', changed: false };
  }
}

export interface RemoteApplyResult {
  changed: boolean;
  delta?: SceneDelta;
}

function acceptRemoteRaw(
  room: RoomState,
  raw: unknown,
  into: DriplElement[]
): boolean {
  if (!raw || wouldExceedSceneCapacity(room, [raw])) return false;
  const element = acceptElement(room, raw);
  if (!element) return false;
  into.push(element);
  return true;
}

/**
 * Remote fan-in commit. Trust boundary: parses/fences untrusted Redis payloads.
 * Accepts legacy wire types for deploy/handover compatibility. Never replies to
 * a sender, never dedups clientMsgId, never publishes (message came from Redis).
 * Returns filtered accepted delta; caller broadcasts it to local users.
 */
export function applyRemoteSceneMessage(
  room: RoomState,
  msg: Record<string, unknown>,
  ports?: Pick<Partial<SceneCommitPorts>, 'markDirty' | 'scheduleSave'>
): RemoteApplyResult {
  const markDirty = ports?.markDirty ?? defaultSceneCommitPorts.markDirty;
  const scheduleSavePort = ports?.scheduleSave ?? defaultSceneCommitPorts.scheduleSave;

  const added: DriplElement[] = [];
  const updated: DriplElement[] = [];
  const deleted: string[] = [];
  const moved: MovedElement[] = [];

  switch (msg.type) {
    case 'add_element':
      acceptRemoteRaw(room, msg.element, added);
      break;
    case 'update_element':
      acceptRemoteRaw(room, msg.element, updated);
      break;
    case 'delete_element':
      if (typeof msg.elementId === 'string' && deleteWithTombstone(room, msg.elementId)) {
        deleted.push(msg.elementId);
      }
      break;
    case 'element-update': {
      if (Array.isArray(msg.elements)) {
        acceptAllParsed(room, msg.elements, updated);
      } else {
        acceptRemoteRaw(room, msg.element, updated);
      }
      break;
    }
    case 'scene-update':
      acceptAllParsed(room, msg.elements, added);
      break;
    case 'scene-delta': {
      const prospectiveElements = [
        ...(Array.isArray(msg.added) ? msg.added : []),
        ...(Array.isArray(msg.updated) ? msg.updated : []),
      ];
      if (wouldExceedSceneCapacity(room, prospectiveElements)) {
        return { changed: false };
      }
      acceptAllParsed(room, msg.added, added);
      acceptAllParsed(room, msg.updated, updated);
      if (Array.isArray(msg.deleted)) {
        for (const id of msg.deleted) {
          if (typeof id === 'string' && deleteWithTombstone(room, id)) deleted.push(id);
        }
      }
      moved.push(...acceptMovedElements(room, msg.moved));
      break;
    }
    default:
      return { changed: false };
  }

  const delta = compactDelta({ type: 'scene-delta', added, updated, deleted, moved });
  if (!delta) return { changed: false };

  markDirty(room.roomId);
  scheduleSavePort(room.roomId);
  return { changed: true, delta };
}
