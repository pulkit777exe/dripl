import { DriplElementSchema, MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { compareFractionalIndex } from '@dripl/common/reconciliation';
import type { WebSocket } from 'ws';
import { repairBindings } from '@dripl/common/arrow-binding';
import * as Sentry from '@sentry/node';
import { db } from '@dripl/db';
import type { RoomState } from './types';
import { logger } from './logger';

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

interface StoredSceneMetadata {
  encryptedPayload?: { iv: string; data: string };
  encryptedAt?: string | null;
  appState?: Record<string, unknown>;
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
    }
    return elements;
  }

  return new Map();
}

export async function saveRoomElements(
  roomId: string,
  elements: Map<string, DriplElement>
): Promise<boolean> {
  const startTime = Date.now();
  const room = rooms.get(roomId);
  const recordType = room?.recordType;
  let storedMetadata: StoredSceneMetadata = {};
  try {
    const stored =
      recordType === 'canvasRoom'
        ? await db.canvasRoom.findUnique({ where: { slug: roomId }, select: { content: true } })
        : await db.file.findUnique({ where: { id: roomId }, select: { content: true } });
    storedMetadata = readStoredSceneMetadata(stored?.content);
  } catch (error) {
    // Do not write with unknown metadata: doing so could erase an encrypted
    // share envelope during a transient database/read-replica failure.
    logger.error({ event: 'save_room_metadata_read_failed', roomId, error });
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
        return false;
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
      return false;
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
