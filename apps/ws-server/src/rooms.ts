import type { DriplElement } from '@dripl/common';
import { repairBindings } from '@dripl/common/arrow-binding';
import { db } from '@dripl/db';
import type { RoomState } from './types';
import { getOrCreateYjsRoom, loadElementsIntoYjs } from './yjsManager';

export const rooms = new Map<string, RoomState>();
export const saveTimeouts = new Map<string, NodeJS.Timeout>();
export const roomLastEmptyAt = new Map<string, number>();
export const userToRoomMap = new Map<string, string>();

export const MAX_ELEMENTS_PER_SCENE = 5000;
export const MAX_EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
export const SAVE_DEBOUNCE_MS = 2_000;

export function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    const yjs = getOrCreateYjsRoom(roomId);
    room = {
      roomId,
      elements: new Map(),
      users: new Map(),
      cursors: new Map(),
      loadedFromDb: false,
      saving: false,
      yjs,
    };
    rooms.set(roomId, room);
  }
  return room;
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
    return repairBindings(elements);
  } catch {
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
  return Array.from(elements.values()).sort((a, b) => {
    const ai = a.fractionalIndex ?? '';
    const bi = b.fractionalIndex ?? '';
    if (ai === bi) return 0;
    if (ai === '') return -1;
    if (bi === '') return 1;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

export function serializeElements(elements: Map<string, DriplElement>): string {
  return JSON.stringify({ elements: elementsToArray(elements) });
}

export async function loadRoomElements(roomId: string): Promise<Map<string, DriplElement>> {
  const file = await db.file.findUnique({
    where: { id: roomId },
    select: { content: true },
  });
  if (file) {
    const elements = elementsToMap(parseStoredElements(file.content));
    const room = rooms.get(roomId);
    if (room?.yjs) {
      loadElementsIntoYjs(room.yjs, Array.from(elements.values()));
    }
    return elements;
  }

  const canvasRoom = await db.canvasRoom.findUnique({
    where: { slug: roomId },
    select: { content: true },
  });
  if (canvasRoom) {
    const elements = elementsToMap(parseStoredElements(canvasRoom.content));
    const room = rooms.get(roomId);
    if (room?.yjs) {
      loadElementsIntoYjs(room.yjs, Array.from(elements.values()));
    }
    return elements;
  }

  return new Map();
}

export async function saveRoomElements(roomId: string, elements: Map<string, DriplElement>): Promise<boolean> {
  const startTime = Date.now();
  const serialized = serializeElements(elements);
  try {
    const fileUpdate = await db.file.updateMany({
      where: { id: roomId },
      data: {
        content: serialized,
        updatedAt: new Date(),
      },
    });

    if (fileUpdate.count > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'save_room_success',
          roomId,
          durationMs: Date.now() - startTime,
          recordType: 'file',
        })
      );
      return true;
    }

    const canvasUpdate = await db.canvasRoom.updateMany({
      where: { slug: roomId },
      data: {
        content: serialized,
        updatedAt: new Date(),
      },
    });

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'save_room_success',
        roomId,
        durationMs: Date.now() - startTime,
        recordType: 'canvasRoom',
        updated: canvasUpdate.count,
      })
    );
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'save_room_failure',
        roomId,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    );
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
        return;
      }
      room.saving = true;
      const success = await saveRoomElements(roomId, room.elements);
      room.saving = false;
      if (!success) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'save_debounced_failure',
            roomId,
            timestamp: Date.now(),
          })
        );
      }
      saveTimeouts.delete(roomId);
    }, SAVE_DEBOUNCE_MS)
  );
}
