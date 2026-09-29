import { DriplElementSchema, MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { compareElementFreshness, compareFractionalIndex } from '@dripl/common/reconciliation';
import type { WebSocket } from 'ws';
import { repairBindings } from '@dripl/common/arrow-binding';
import * as Sentry from '@sentry/node';
import { db } from '@dripl/db';
import type { RoomState, StoredSceneMetadata } from './types';
import { logger } from './logger';
import { getLiveTombstone } from './tombstones';
import { broadcast } from './broadcast';

export const rooms = new Map<string, RoomState>();
export const saveTimeouts = new Map<string, NodeJS.Timeout>();
export const roomLastEmptyAt = new Map<string, number>();
export const userToRoomMap = new Map<string, string>();
export const wsToRoomMap = new Map<WebSocket, string>();

export const MAX_ELEMENTS_PER_SCENE = MAX_SCENE_ELEMENTS;
export const MAX_EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
export const SAVE_DEBOUNCE_MS = 2_000;

export function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      elements: new Map(),
      users: new Map(),
      cursors: new Map(),
      loadedFromDb: false,
      saving: false,
      dirty: false,
      tombstones: new Map(),
      mutationVersion: 0,
      recentMsgIds: new Set(),
      elementLocks: new Map(),
      following: new Map(),
      viewports: new Map(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

export function markRoomDirty(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.dirty = true;
  room.mutationVersion += 1;
}

function normalizeLegacyElement(element: unknown): unknown {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return element;
  const candidate = { ...(element as Record<string, unknown>) };
  if (
    (candidate.type === 'arrow' || candidate.type === 'line') &&
    candidate.arrowHeads &&
    typeof candidate.arrowHeads === 'object' &&
    !Array.isArray(candidate.arrowHeads)
  ) {
    const heads = candidate.arrowHeads as Record<string, unknown>;
    candidate.arrowHeads = {
      start: heads.start === true ? 'triangle' : heads.start === false ? 'none' : heads.start,
      end: heads.end === true ? 'triangle' : heads.end === false ? 'none' : heads.end,
    };
  }
  return candidate;
}

export function parseStoredElements(raw: string | null | undefined): DriplElement[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    let elements: DriplElement[] = [];
    if (Array.isArray(parsed)) {
      elements = parsed as DriplElement[];
    } else if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.elements)) {
        elements = record.elements as DriplElement[];
      }
    }
    const validElements = elements.slice(0, MAX_SCENE_ELEMENTS).flatMap(element => {
      const candidate =
        element && typeof element === 'object' && (element as { type?: unknown }).type !== undefined
          ? normalizeLegacyElement(element)
          : element;
      const parsed = DriplElementSchema.safeParse(candidate);
      return parsed.success ? [parsed.data as DriplElement] : [];
    });
    return repairBindings(validElements);
  } catch (err) {
    Sentry.captureException(err);
    logger.error({ event: 'parse_elements_error', error: err }, 'Failed to parse stored elements');
    return [];
  }
}

export function elementsToMap(elements: DriplElement[]): Map<string, DriplElement> {
  const map = new Map<string, DriplElement>();
  for (const el of elements) {
    map.set(el.id, el);
  }
  return map;
}

export function elementsToArray(elements: Map<string, DriplElement>): DriplElement[] {
  return Array.from(elements.values()).sort((a, b) =>
    compareFractionalIndex(a.fractionalIndex, b.fractionalIndex)
  );
}

function readStoredSceneMetadata(raw: string | null | undefined): StoredSceneMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const payload =
      record.encryptedPayload && typeof record.encryptedPayload === 'object'
        ? (record.encryptedPayload as Record<string, unknown>)
        : typeof record.iv === 'string' && typeof record.data === 'string'
          ? record
          : null;
    const encryptedPayload =
      payload && typeof payload.iv === 'string' && typeof payload.data === 'string'
        ? { iv: payload.iv, data: payload.data }
        : undefined;
    const encryptedAt = typeof record.encryptedAt === 'string' ? record.encryptedAt : undefined;
    const appState =
      record.appState && typeof record.appState === 'object' && !Array.isArray(record.appState)
        ? (record.appState as Record<string, unknown>)
        : undefined;
    return { encryptedPayload, encryptedAt, appState };
  } catch {
    return {};
  }
}

/**
 * Merge in-memory scene with freshly re-read stored scene after a fenced-
 * write conflict (the Excalidraw-Firebase-transaction equivalent for a
 * whole-blob Postgres row). Per id, the fresher version wins; ties keep the
 * stored copy (same version+nonce means same edit, so either side is
 * identical, and a stable choice avoids flip-flopping between replicas).
 * Stored-only ids survive unless a live memory tombstone beats them — that
 * is how a delete made here is not undone by someone else's concurrent
 * save. Returns the merged map plus stored-only survivors the room has not
 * seen, so the caller can adopt and relay them.
 */
export function mergeMemoryWithStored(
  room: RoomState,
  stored: DriplElement[]
): { merged: Map<string, DriplElement>; resurrected: DriplElement[] } {
  const merged = elementsToMap(stored);
  const resurrected: DriplElement[] = [];
  for (const [id, memoryEl] of room.elements) {
    const storedEl = merged.get(id);
    if (!storedEl || compareElementFreshness(memoryEl, storedEl) > 0) {
      merged.set(id, memoryEl);
    }
  }
  for (const [id, storedEl] of merged) {
    if (room.elements.has(id)) continue;
    const tombstone = getLiveTombstone(room, id);
    if (tombstone && compareElementFreshness(storedEl, tombstone) <= 0) {
      merged.delete(id);
      continue;
    }
    resurrected.push(storedEl);
  }
  return { merged, resurrected };
}

export function serializeElements(
  elements: Map<string, DriplElement>,
  metadata: StoredSceneMetadata = {}
): string {
  const payload: Record<string, unknown> = { elements: elementsToArray(elements) };
  if (metadata.encryptedPayload) payload.encryptedPayload = metadata.encryptedPayload;
  if (metadata.encryptedAt) payload.encryptedAt = metadata.encryptedAt;
  if (metadata.appState) payload.appState = metadata.appState;
  return JSON.stringify(payload);
}

export async function loadRoomElements(roomId: string): Promise<Map<string, DriplElement>> {
  const file = await db.file.findUnique({
    where: { id: roomId },
    select: { content: true, updatedAt: true },
  });
  if (file) {
    const elements = elementsToMap(parseStoredElements(file.content));
    const room = rooms.get(roomId);
    if (room) {
      room.recordType = 'file';
      room.lastPersistedUpdatedAt = file.updatedAt;
      room.storedMetadata = readStoredSceneMetadata(file.content);
    }
    return elements;
  }

  const canvasRoom = await db.canvasRoom.findUnique({
    where: { slug: roomId },
    select: { content: true, updatedAt: true },
  });
  if (canvasRoom) {
    const elements = elementsToMap(parseStoredElements(canvasRoom.content));
    const room = rooms.get(roomId);
    if (room) {
      room.recordType = 'canvasRoom';
      room.lastPersistedUpdatedAt = canvasRoom.updatedAt;
      room.storedMetadata = readStoredSceneMetadata(canvasRoom.content);
    }
    return elements;
  }

  return new Map();
}

/**
 * Conflict recovery for a fenced write that matched zero rows: someone else
 * wrote first. Re-reads the winning row, merges (see mergeMemoryWithStored),
 * and retries the write against the fresh fence — the Postgres equivalent
 * of Excalidraw's Firestore read-reconcile-write transaction. On success the
 * merged scene is adopted into memory (additions only; memory's own edits
 * are never removed, so an in-flight mutation cannot be wiped) and relayed
 * to connected clients so they converge. Returns false when the row is gone
 * or the retry loses again; the room stays dirty and a later tick retries.
 * Conflict-only cost (1 read + 1 write); the happy path is still 1 write.
 */
async function mergeAndSaveOnConflict(
  roomId: string,
  room: RoomState,
  recordType: 'file' | 'canvasRoom',
  startTime: number
): Promise<boolean> {
  let stored: { content: string; updatedAt: Date } | null;
  try {
    stored =
      recordType === 'canvasRoom'
        ? await db.canvasRoom.findUnique({
            where: { slug: roomId },
            select: { content: true, updatedAt: true },
          })
        : await db.file.findUnique({
            where: { id: roomId },
            select: { content: true, updatedAt: true },
          });
  } catch (error) {
    logger.error({ event: 'save_room_merge_read_failed', roomId, recordType, error });
    return false;
  }
  if (!stored) {
    logger.warn({ event: 'save_room_conflict_row_gone', roomId, recordType });
    return false;
  }

  const { merged, resurrected } = mergeMemoryWithStored(room, parseStoredElements(stored.content));
  // Capacity is enforced on admission everywhere; the union of two capped
  // scenes can still overflow, so shed the stalest stored-only survivors
  // rather than persisting an over-cap scene no client could have built.
  if (merged.size > MAX_ELEMENTS_PER_SCENE) {
    const memoryIds = new Set(room.elements.keys());
    const shed = resurrected
      .filter(el => !memoryIds.has(el.id))
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    while (merged.size > MAX_ELEMENTS_PER_SCENE && shed.length > 0) {
      const victim = shed.shift();
      if (victim) merged.delete(victim.id);
    }
  }
  const freshMetadata = readStoredSceneMetadata(stored.content);
  const serialized = serializeElements(merged, freshMetadata);

  try {
    const updatedRows =
      recordType === 'canvasRoom'
        ? await db.canvasRoom.updateManyAndReturn({
            where: { slug: roomId, updatedAt: stored.updatedAt },
            data: { content: serialized },
            select: { updatedAt: true },
          })
        : await db.file.updateManyAndReturn({
            where: { id: roomId, updatedAt: stored.updatedAt },
            data: { content: serialized },
            select: { updatedAt: true },
          });
    const updated = updatedRows[0];
    if (!updated) {
      logger.warn({ event: 'save_room_conflict_retry', roomId, recordType });
      return false;
    }
    room.lastPersistedUpdatedAt = updated.updatedAt;
    room.storedMetadata = freshMetadata;
    if (recordType === 'file') room.recordType = 'file';

    const adopted: DriplElement[] = [];
    for (const el of resurrected) {
      // Re-check under the latest state: a delete may have landed while the
      // merge was in flight, and an in-flight mutation always wins ties.
      if (!room.elements.has(el.id) && merged.has(el.id) && !getLiveTombstone(room, el.id)) {
        room.elements.set(el.id, el);
        adopted.push(el);
      }
    }
    if (adopted.length > 0) {
      broadcast(room, { type: 'scene-delta', added: adopted });
      // Adoption changes the scene every client sees, so the room version
      // must advance like any other mutation. This also marks the room dirty,
      // costing one redundant fenced save later — accepted to keep the single
      // invariant "scene change ⇒ dirty + version bump" instead of a second
      // bump-without-dirty path. Conflicts are rare; the write is idempotent.
      markRoomDirty(roomId);
    }
    logger.info({
      event: 'save_room_conflict_merged',
      roomId,
      durationMs: Date.now() - startTime,
      recordType,
      elementCount: merged.size,
      adopted: adopted.length,
      byteSize: Buffer.byteLength(serialized, 'utf-8'),
    });
    return true;
  } catch (error) {
    logger.error({
      event: 'save_room_merge_write_failed',
      roomId,
      durationMs: Date.now() - startTime,
      recordType,
      err: error,
    });
    return false;
  }
}

export async function saveRoomElements(
  roomId: string,
  elements: Map<string, DriplElement>
): Promise<boolean> {
  const startTime = Date.now();
  const room = rooms.get(roomId);
  const recordType = room?.recordType;
  // Metadata (encrypted share envelope, app state) was captured at load and is
  // preserved from memory: a debounced save must not pay a read before its
  // write. Share revoke/rotate only touches share columns, never content, so
  // the load-time envelope cannot go stale from sharing actions; concurrent
  // scene writes are fenced by the optimistic updatedAt check below.
  const storedMetadata: StoredSceneMetadata = room?.storedMetadata ?? {};
  if (!room) {
    logger.error({ event: 'save_room_no_state', roomId });
    return false;
  }
  const serialized = serializeElements(elements, storedMetadata);
  const elementCount = elements.size;
  const byteSize = Buffer.byteLength(serialized, 'utf-8');

  try {
    if (recordType === 'canvasRoom') {
      const updatedRows = await db.canvasRoom.updateManyAndReturn({
        where: {
          slug: roomId,
          ...(room?.lastPersistedUpdatedAt ? { updatedAt: room.lastPersistedUpdatedAt } : {}),
        },
        data: { content: serialized },
        select: { updatedAt: true },
      });
      const updated = updatedRows[0];
      if (!updated) {
        logger.warn({ event: 'save_room_conflict', roomId, recordType: 'canvasRoom' });
        return mergeAndSaveOnConflict(roomId, room, 'canvasRoom', startTime);
      }
      if (room) room.lastPersistedUpdatedAt = updated.updatedAt;
      logger.info({
        event: 'save_room_success',
        roomId,
        durationMs: Date.now() - startTime,
        recordType: 'canvasRoom',
        updated: updatedRows.length,
        elementCount,
        byteSize,
      });
      return true;
    }

    const updatedRows = await db.file.updateManyAndReturn({
      where: {
        id: roomId,
        ...(room?.lastPersistedUpdatedAt ? { updatedAt: room.lastPersistedUpdatedAt } : {}),
      },
      data: { content: serialized },
      select: { updatedAt: true },
    });
    const updated = updatedRows[0];
    if (updated) {
      if (room) {
        room.recordType = 'file';
        room.lastPersistedUpdatedAt = updated.updatedAt;
      }
      logger.info({
        event: 'save_room_success',
        roomId,
        durationMs: Date.now() - startTime,
        recordType: 'file',
        updated: updatedRows.length,
        elementCount,
        byteSize,
      });
      return true;
    }

    if (recordType === 'file') {
      logger.warn({ event: 'save_room_conflict', roomId, recordType: 'file' });
      return mergeAndSaveOnConflict(roomId, room, 'file', startTime);
    }

    const canvasRows = await db.canvasRoom.updateManyAndReturn({
      where: { slug: roomId },
      data: { content: serialized },
      select: { updatedAt: true },
    });
    const canvasUpdate = canvasRows[0];
    if (canvasUpdate && room) {
      room.recordType = 'canvasRoom';
      room.lastPersistedUpdatedAt = canvasUpdate.updatedAt;
    }
    logger.info({
      event: 'save_room_success',
      roomId,
      durationMs: Date.now() - startTime,
      recordType: 'canvasRoom',
      updated: canvasRows.length,
      elementCount,
      byteSize,
    });
    return Boolean(canvasUpdate);
  } catch (error) {
    logger.error({
      event: 'save_room_failure',
      roomId,
      durationMs: Date.now() - startTime,
      elementCount,
      byteSize,
      err: error,
    });
    return false;
  }
}

export function scheduleSave(roomId: string): void {
  const existing = saveTimeouts.get(roomId);
  if (existing) clearTimeout(existing);
  saveTimeouts.set(
    roomId,
    setTimeout(async () => {
      const room = rooms.get(roomId);
      if (!room) {
        saveTimeouts.delete(roomId);
        return;
      }
      if (room.saving) {
        saveTimeouts.delete(roomId);
        scheduleSave(roomId);
        return;
      }
      if (!room.dirty) {
        saveTimeouts.delete(roomId);
        return;
      }
      room.saving = true;
      const versionAtStart = room.mutationVersion;
      const success = await saveRoomElements(roomId, room.elements);
      room.saving = false;
      if (success && room.mutationVersion === versionAtStart) {
        room.dirty = false;
      } else if (room.dirty) {
        // A mutation arrived while the database write was in flight. Keep the
        // room dirty and schedule another save rather than losing that work.
        saveTimeouts.delete(roomId);
        scheduleSave(roomId);
        return;
      }
      if (!success) {
        logger.error({ event: 'save_debounced_failure', roomId });
      }
      saveTimeouts.delete(roomId);
    }, SAVE_DEBOUNCE_MS)
  );
}
