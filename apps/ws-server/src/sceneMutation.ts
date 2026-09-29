import { DriplElementSchema, type DriplElement } from '@dripl/common';
import { MAX_ELEMENTS_PER_SCENE, markRoomDirty, scheduleSave } from './rooms';
import { shouldAcceptElement } from '@dripl/common/reconciliation';
import type { RoomState } from './types';
import { isSupersededByTombstone, deleteWithTombstone } from './tombstones';

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

  // A live tombstone is a delete with a version: stale writes lose to it
  // (no resurrection), genuinely newer writes clear it (legitimate revive).
  if (isSupersededByTombstone(room, element)) return null;

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
 * Fence→store over already-validated elements. The dispatch prologue runs the
 * full `messageSchema` parse before any handler executes, so handler inputs
 * are proven `DriplElement`s and re-parsing each one would double the Zod
 * cost on the hottest path (a 1000-element delta parses 2000 times). The
 * Redis fan-out path is a separate trust boundary and uses acceptAllParsed
 * (independent parse, same fence) instead.
 */
export function acceptValidated(
  room: RoomState,
  values: DriplElement[],
  into: DriplElement[]
): DriplElement[] {
  for (const element of values) {
    if (isSupersededByTombstone(room, element)) {
      continue;
    }
    const existing = room.elements.get(element.id);
    if (existing && !shouldAcceptElement(element, existing)) {
      continue;
    }
    room.elements.set(element.id, element);
    into.push(element);
  }
  return into;
}

/**
 * Single-element form of acceptValidated: capacity → tombstone → freshness →
 * store, in exactly the order the socket handlers historically applied inline.
 * Every local single-element admission (add, update, element-update
 * singleton) funnels through here so the fence order exists once. Returns
 * 'capacity' when the scene is full (caller sends the capacity error),
 * 'rejected' for tombstone/freshness drops, 'accepted' after storing.
 */
export type SingleAcceptResult = 'accepted' | 'capacity' | 'rejected';

export function acceptSingleValidated(room: RoomState, element: DriplElement): SingleAcceptResult {
  const existing = room.elements.get(element.id);
  if (!existing && room.elements.size >= MAX_ELEMENTS_PER_SCENE) return 'capacity';
  if (isSupersededByTombstone(room, element)) return 'rejected';
  if (existing && !shouldAcceptElement(element, existing)) return 'rejected';
  room.elements.set(element.id, element);
  return 'accepted';
}

/**
 * Parse→fence→store batch for the Redis fan-out trust boundary.
 * Cross-process payloads validate independently (see acceptValidated for the
 * local-socket rationale); every element still passes the tombstone fence
 * via acceptElement. Whole-array capacity pre-check preserved from the loop
 * this replaces: an over-capacity remote batch is dropped wholesale rather
 * than partially applied.
 */
export function acceptAllParsed(
  room: RoomState,
  values: unknown,
  into: DriplElement[]
): DriplElement[] {
  if (!Array.isArray(values) || wouldExceedSceneCapacity(room, values)) return into;
  for (const raw of values) {
    const element = acceptElement(room, raw);
    if (element) into.push(element);
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
    const accepted: DriplElement[] = [];
    acceptAllParsed(room, values, accepted);
    if (accepted.length > 0) changed = true;
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
      if (typeof msg.elementId === 'string' && deleteWithTombstone(room, msg.elementId)) {
        changed = true;
      }
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
          if (typeof id === 'string' && deleteWithTombstone(room, id)) changed = true;
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
