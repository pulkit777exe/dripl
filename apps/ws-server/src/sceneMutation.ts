import { DriplElementSchema, type DriplElement } from '@dripl/common';
import { MAX_ELEMENTS_PER_SCENE, markRoomDirty, scheduleSave } from './rooms';
import { shouldAcceptElement } from '@dripl/common/reconciliation';
import type { RoomState } from './types';

/**
 * Single home for the scene-mutation primitives. Previously `toDriplElement`,
 * `acceptElement`, and `wouldExceedSceneCapacity` lived in `index.ts` while
 * eight near-identical parse→fence→store loops were spread across the dispatch
 * switch and `applyRemoteSceneMessage`, and two verbatim `clientMsgId` dedup
 * rings were hand-copied into `scene-update` and `scene-delta`.
 *
 * The shared helpers below are behavior-preserving by construction:
 * `shouldAcceptElement(incoming, undefined)` returns `true`, so the
 * unconditional fence in `acceptElement` accepts exactly the set that the old
 * `if (existing && !shouldAcceptElement(...)) continue` loops accepted.
 */

export function toDriplElement(el: unknown): DriplElement {
  const parsed = DriplElementSchema.safeParse(el);
  if (!parsed.success) {
    throw new Error('Invalid element structure');
  }
  return parsed.data as DriplElement;
}

export function acceptElement(room: RoomState, raw: unknown): DriplElement | null {
  let element: DriplElement;
  try {
    element = toDriplElement(raw);
  } catch {
    return null;
  }

  const existing = room.elements.get(element.id);
  if (!shouldAcceptElement(element, existing)) return null;

  room.elements.set(element.id, element);
  return element;
}

export function wouldExceedSceneCapacity(room: RoomState, values: unknown[]): boolean {
  const newIds = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = (value as { id?: unknown }).id;
    if (typeof id !== 'string' || room.elements.has(id)) continue;
    newIds.add(id);
  }
  return room.elements.size + newIds.size > MAX_ELEMENTS_PER_SCENE;
}

/** The single capacity message. Six switch sites previously emitted two
 * different strings for this condition; no client matches on the text. */
export function sceneCapacityMessage(): string {
  return `Scene is at capacity (${MAX_ELEMENTS_PER_SCENE} elements max)`;
}

/**
 * Parse→fence→store over an array, pushing each accepted element into
 * `into`. Callers run their own capacity check first (as before) and pass an
 * `onInvalid` hook when they log rejected payloads (the local switch paths
 * do; the Redis fan-out path does not).
 */
export function acceptAll(
  room: RoomState,
  values: unknown,
  into: DriplElement[],
  onInvalid?: (raw: unknown, err: unknown) => void
): DriplElement[] {
  if (!Array.isArray(values)) return into;
  for (const raw of values) {
    try {
      const element = toDriplElement(raw);
      const existing = room.elements.get(element.id);
      if (existing && !shouldAcceptElement(element, existing)) {
        continue;
      }
      room.elements.set(element.id, element);
      into.push(element);
    } catch (err) {
      onInvalid?.(raw, err);
    }
  }
  return into;
}

/**
 * Shared `clientMsgId` dedup ring. Returns `true` when the id was already
 * seen (caller acks and stops), `false` when it is new (caller proceeds).
 */
export function noteClientMsgId(room: RoomState, clientMsgId: string | undefined): boolean {
  if (!clientMsgId) return false;
  if (room.recentMsgIds.has(clientMsgId)) return true;
  room.recentMsgIds.add(clientMsgId);
  if (room.recentMsgIds.size > 500) {
    const first = room.recentMsgIds.values().next().value;
    if (first !== undefined) room.recentMsgIds.delete(first);
  }
  return false;
}

export function applyRemoteSceneMessage(room: RoomState, msg: Record<string, unknown>): boolean {
  let changed = false;
  const acceptAllRemote = (values: unknown): DriplElement[] => {
    if (!Array.isArray(values) || wouldExceedSceneCapacity(room, values)) return [];
    const accepted: DriplElement[] = [];
    for (const raw of values) {
      const element = acceptElement(room, raw);
      if (element) {
        accepted.push(element);
        changed = true;
      }
    }
    return accepted;
  };

  switch (msg.type) {
    case 'add_element':
    case 'update_element':
      if (
        msg.element &&
        !wouldExceedSceneCapacity(room, [msg.element]) &&
        acceptElement(room, msg.element)
      ) {
        changed = true;
      }
      break;
    case 'delete_element':
      if (typeof msg.elementId === 'string' && room.elements.delete(msg.elementId)) changed = true;
      break;
    case 'element-update': {
      if (Array.isArray(msg.elements)) acceptAllRemote(msg.elements);
      else if (
        msg.element &&
        !wouldExceedSceneCapacity(room, [msg.element]) &&
        acceptElement(room, msg.element)
      ) {
        changed = true;
      }
      break;
    }
    case 'scene-update':
      acceptAllRemote(msg.elements);
      break;
    case 'scene-delta': {
      const prospectiveElements = [
        ...(Array.isArray(msg.added) ? msg.added : []),
        ...(Array.isArray(msg.updated) ? msg.updated : []),
      ];
      if (wouldExceedSceneCapacity(room, prospectiveElements)) return false;
      acceptAllRemote(msg.added);
      acceptAllRemote(msg.updated);
      if (Array.isArray(msg.deleted)) {
        for (const id of msg.deleted) {
          if (typeof id === 'string' && room.elements.delete(id)) changed = true;
        }
      }
      break;
    }
    default:
      return false;
  }

  if (!changed) return false;
  markRoomDirty(room.roomId);
  scheduleSave(room.roomId);
  return true;
}
