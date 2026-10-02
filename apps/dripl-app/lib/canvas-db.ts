import { openDB, type IDBPDatabase } from 'idb';
import { logError, type DriplElement } from '@dripl/common';
import { normalizeElement } from '@/utils/canvasUtils';

const DB_NAME = 'dripl-canvas';
const DB_VERSION = 1;
const STORE_NAME = 'canvas-rooms';

/**
 * Maximum elements persisted for one local room.
 *
 * IndexedDB is not bound by the ~5 MB localStorage ceiling, so the previous
 * limit of 5,000 (inherited from the localStorage path) left large scenes
 * unpersisted and made 10k/20k scenes impossible to exercise locally. Server
 * acceptance is bounded separately by `MAX_ELEMENTS_PER_SCENE`; this is the
 * local-persistence ceiling.
 */
export const MAX_PERSISTED_ELEMENTS = 50_000;

export interface CanvasRoomData {
  roomId: string;
  elements: DriplElement[];
  lastModified: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'roomId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCanvasToIndexedDB(
  roomId: string,
  elements: DriplElement[]
): Promise<boolean> {
  // Refuse to write a partial scene. Slicing here would replace a previously
  // complete snapshot with a truncated one that looks valid, and the next load
  // would silently return fewer elements than the user drew. Keeping the last
  // good snapshot and reporting failure is the honest outcome.
  if (elements.length > MAX_PERSISTED_ELEMENTS) {
    logError(
      JSON.stringify({
        level: 'error',
        event: 'canvas_persist_rejected',
        reason: 'element_count_exceeds_local_limit',
        elementCount: elements.length,
        maxElements: MAX_PERSISTED_ELEMENTS,
      })
    );
    return false;
  }

  try {
    const db = await getDB();
    const data: CanvasRoomData = {
      roomId: roomId.slice(0, 100),
      elements: elements.map(normalizeElement),
      lastModified: Date.now(),
    };
    await db.put(STORE_NAME, data);
    return true;
  } catch (error) {
    logError('Failed to save canvas to IndexedDB:', error);
    return false;
  }
}

export async function loadCanvasFromIndexedDB(roomId: string): Promise<DriplElement[]> {
  try {
    const db = await getDB();
    const data = await db.get(STORE_NAME, roomId.slice(0, 100));
    return Array.isArray(data?.elements)
      ? data.elements.slice(0, MAX_PERSISTED_ELEMENTS).map(normalizeElement)
      : [];
  } catch (error) {
    logError('Failed to load canvas from IndexedDB:', error);
    return [];
  }
}

export async function clearCanvasFromIndexedDB(roomId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, roomId);
  } catch (error) {
    logError('Failed to clear canvas from IndexedDB:', error);
    throw error;
  }
}

export async function getAllCanvasRooms(): Promise<CanvasRoomData[]> {
  try {
    const db = await getDB();
    return await db.getAll(STORE_NAME);
  } catch (error) {
    logError('Failed to get all canvas rooms from IndexedDB:', error);
    return [];
  }
}
