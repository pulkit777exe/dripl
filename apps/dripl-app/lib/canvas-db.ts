import { openDB, type IDBPDatabase } from "idb";
import type { DriplElement } from "@dripl/common";

const DB_NAME = "dripl-canvas";
const DB_VERSION = 1;
const STORE_NAME = "canvas-rooms";

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
          db.createObjectStore(STORE_NAME, { keyPath: "roomId" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCanvasToIndexedDB(
  roomId: string,
  elements: DriplElement[]
): Promise<void> {
  try {
    const db = await getDB();
    const data: CanvasRoomData = {
      roomId,
      elements,
      lastModified: Date.now(),
    };
    await db.put(STORE_NAME, data);
  } catch (error) {
    console.error("Failed to save canvas to IndexedDB:", error);
    throw error;
  }
}

export async function loadCanvasFromIndexedDB(
  roomId: string
): Promise<DriplElement[]> {
  try {
    const db = await getDB();
    const data = await db.get(STORE_NAME, roomId);
    return data?.elements || [];
  } catch (error) {
    console.error("Failed to load canvas from IndexedDB:", error);
    return [];
  }
}

export async function clearCanvasFromIndexedDB(roomId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, roomId);
  } catch (error) {
    console.error("Failed to clear canvas from IndexedDB:", error);
    throw error;
  }
}

export async function getAllCanvasRooms(): Promise<CanvasRoomData[]> {
  try {
    const db = await getDB();
    return await db.getAll(STORE_NAME);
  } catch (error) {
    console.error("Failed to get all canvas rooms from IndexedDB:", error);
    return [];
  }
}
