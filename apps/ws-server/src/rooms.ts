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

/**
 * Identify the database row behind a room whose record type is unknown
 * (never loaded, or loaded when no row existed). Probes in load order —
 * file by id first, then canvas room by slug — and returns the identity a
 * fenced write needs, or null when no row exists. Read-only: the caller
 * decides whether to adopt and retry.
 */
export async function probeRoomRecord(
  roomId: string
): Promise<{
  recordType: 'file' | 'canvasRoom';
  updatedAt: Date;
  metadata: StoredSceneMetadata;
} | null> {
  const file = await db.file.findUnique({
    where: { id: roomId },
    select: { content: true, updatedAt: true },
  });
  if (file) {
    return {
      recordType: 'file',
      updatedAt: file.updatedAt,
      metadata: readStoredSceneMetadata(file.content),
    };
  }
  const canvasRoom = await db.canvasRoom.findUnique({
    where: { slug: roomId },
    select: { content: true, updatedAt: true },
  });
  if (canvasRoom) {
    return {
      recordType: 'canvasRoom',
      updatedAt: canvasRoom.updatedAt,
      metadata: readStoredSceneMetadata(canvasRoom.content),
    };
  }
  return null;
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
    // A room with no record type never completed a load, or its row vanished
    // mid-session. Probing first closes two unfenced-write holes at once:
    // the file branch below would otherwise write with no updatedAt fence,
    // and the old canvasRoom fallback wrote with no fence at all — either
    // silently clobbers a row created concurrently (e.g. same slug
    // re-created over HTTP while this room lived on). If a row exists,
    // adopt its identity and continue fenced; if not, stay dirty for a
    // later tick, exactly like a lost conflict retry. Probe-only cost, and
    // only on this rare path — the happy path still pays a single write.
    let effectiveRecordType = recordType;
    if (!effectiveRecordType) {
      const probed = await probeRoomRecord(roomId);
      if (!probed) {
        logger.warn({ event: 'save_room_conflict_row_gone', roomId });
        return false;
      }
      if (room) {
        room.recordType = probed.recordType;
        room.lastPersistedUpdatedAt = probed.updatedAt;
        room.storedMetadata = probed.metadata;
      }
      effectiveRecordType = probed.recordType;
    }

    if (effectiveRecordType === 'canvasRoom') {
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

    if (effectiveRecordType === 'file') {
      logger.warn({ event: 'save_room_conflict', roomId, recordType: 'file' });
      return mergeAndSaveOnConflict(roomId, room, 'file', startTime);
    }

    // Unreachable: unknown types probe-and-adopt (or bail) above, so the
    // effective type is always known here. Kept as a defensive false rather
    // than a write, so a future record type can never fall through to an
    // unfenced whole-blob update.
    logger.warn({ event: 'save_room_unknown_record_type', roomId });
    return false;
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

/** Outcome of a guarded persistence attempt. */
export type PersistOutcome = 'saved' | 'clean' | 'busy' | 'failed' | 'gone';

/**
 * The single guarded entry point for persisting a room. Owns the
 * dirty/saving/mutationVersion dance that five call sites (debounce,
 * periodic tick ×2, leave, shutdown, reconciliation) used to restate with
 * drift: leave skipped the version check, shutdown bypassed dirty-clearing,
 * reconciliation set saving with no coordination. Callers keep their own
 * retry policy (debounce reschedules; periodic relies on the next tick;
 * shutdown/leave fire once) but the guard → write → version-checked clear
 * lives here exactly once.
 */
export async function persistRoom(roomId: string): Promise<PersistOutcome> {
  const room = rooms.get(roomId);
  if (!room) return 'gone';
  if (room.saving) return 'busy';
  if (!room.dirty) return 'clean';
  room.saving = true;
  const versionAtStart = room.mutationVersion;
  try {
    const success = await saveRoomElements(roomId, room.elements);
    if (success && room.mutationVersion === versionAtStart) room.dirty = false;
    return success ? 'saved' : 'failed';
  } finally {
    room.saving = false;
  }
}

/**
 * persistRoom that waits out an in-flight write first (shutdown only).
 * Intervals are cleared before the final save pass, but an async database
 * write started by the periodic tick can still be pending with saving=true;
 * firing a second write alongside it was the old double-write. Polls
 * boundedly, then runs the normal guard — so a settled-but-dirty room
 * (mutation landed mid-write) still gets saved, and a hung database still
 * resolves instead of stalling shutdown. Timings injectable for tests.
 */
export async function awaitSettledPersist(
  roomId: string,
  pollMs = 25,
  timeoutMs = 5_000
): Promise<PersistOutcome> {
  const room = rooms.get(roomId);
  if (!room || !room.saving) return persistRoom(roomId);
  const startedAt = Date.now();
  await new Promise<void>(resolve => {
    const timer = setInterval(() => {
      const current = rooms.get(roomId);
      if (!current || !current.saving || Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, pollMs);
  });
  return persistRoom(roomId);
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
      const outcome = await persistRoom(roomId);
      if (outcome === 'gone' || outcome === 'clean') {
        saveTimeouts.delete(roomId);
        return;
      }
      if (outcome === 'busy') {
        saveTimeouts.delete(roomId);
        scheduleSave(roomId);
        return;
      }
      if (outcome === 'saved' && !room.dirty) {
        saveTimeouts.delete(roomId);
        return;
      }
      // Saved-but-dirty (a mutation landed mid-write) or failed with work
      // still pending: schedule another pass rather than losing the work.
      // A persistently failing database re-arms every SAVE_DEBOUNCE_MS;
      // the room stays dirty and visible in logs until it recovers.
      if (outcome === 'failed') {
        logger.error({ event: 'save_debounced_failure', roomId });
      }
      saveTimeouts.delete(roomId);
      scheduleSave(roomId);
    }, SAVE_DEBOUNCE_MS)
  );
}
