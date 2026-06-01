import type { DriplElement } from '@dripl/common';
import { db } from '@dripl/db';
import type { RoomState } from './types';

export const rooms = new Map<string, RoomState>();
export const saveTimeouts = new Map<string, NodeJS.Timeout>();
export const roomLastEmptyAt = new Map<string, number>();

export const MAX_ELEMENTS_PER_SCENE = 5000;
export const MAX_EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
export const SAVE_DEBOUNCE_MS = 2_000;

export function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      elements: [],
      users: new Map(),
      cursors: new Map(),
      loadedFromDb: false,
      saving: false,
    };
    rooms.set(roomId, room);
  }
  return room;
}

export function parseStoredElements(raw: string | null | undefined): DriplElement[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as DriplElement[];
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.elements)) {
        return record.elements as DriplElement[];
      }
    }
  } catch {
    return [];
  }
  return [];
}

export function serializeElements(elements: DriplElement[]): string {
  return JSON.stringify({ elements });
}

export async function loadRoomElements(roomId: string): Promise<DriplElement[]> {
  const file = await db.file.findUnique({
    where: { id: roomId },
    select: { content: true },
  });
  if (file) {
    return parseStoredElements(file.content);
  }

  const canvasRoom = await db.canvasRoom.findUnique({
    where: { slug: roomId },
    select: { content: true },
  });
  if (canvasRoom) {
    return parseStoredElements(canvasRoom.content);
  }

  return [];
}

export async function saveRoomElements(roomId: string, elements: DriplElement[]): Promise<boolean> {
  const startTime = Date.now();
  try {
    const fileUpdate = await db.file.updateMany({
      where: { id: roomId },
      data: {
        content: serializeElements(elements),
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
        content: serializeElements(elements),
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
