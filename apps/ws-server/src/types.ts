import { WebSocket } from 'ws';
import type { DriplElement } from '@dripl/common';

export interface UserConnection {
  userId: string;
  displayName: string;
  color: string;
  ws: WebSocket;
  isAlive: boolean;
  /** Re-check the connection's room authorization during passive sweeps. */
  revalidate?: () => Promise<boolean>;
}

export interface Cursor {
  x: number;
  y: number;
}

export interface ElementLock {
  userId: string;
  lastHeartbeat: number;
}

export interface UserViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface StoredSceneMetadata {
  encryptedPayload?: { iv: string; data: string };
  encryptedAt?: string | null;
  appState?: Record<string, unknown>;
}

/**
 * Delete marker kept after an element is removed. Without tombstones, a
 * stale concurrent edit (or an offline replay) re-adds the id and the
 * delete silently un-happens — the element resurrects on every replica and
 * gets persisted. A tombstone carries the delete's version so the freshness
 * fence can reject older writes while still accepting genuinely newer ones,
 * mirroring Excalidraw's `isDeleted` + `DELETED_ELEMENT_TIMEOUT` (1 day).
 * Memory-only: a restart loses them, same as all other room state
 * (single-instance caveat).
 */
export interface Tombstone {
  id: string;
  version: number;
  versionNonce: number;
  deletedAt: number;
}

export interface RoomState {
  roomId: string;
  elements: Map<string, DriplElement>;
  users: Map<string, UserConnection>;
  cursors: Map<string, Cursor>;
  loadedFromDb: boolean;
  loadingPromise?: Promise<Map<string, DriplElement>>;
  saving: boolean;
  recordType?: 'file' | 'canvasRoom';
  /** Database version used as an optimistic persistence fence. */
  lastPersistedUpdatedAt?: Date;
  dirty: boolean;
  /** Delete markers; see Tombstone. Lazily created by the scene-mutation
   * helpers so hand-built rooms (tests) without one still work. */
  tombstones: Map<string, Tombstone>;
  /** Cached scene envelope (encrypted share payload, app state) read at load time.
   * Reused on save so each debounced write costs one UPDATE, not a read+write. */
  storedMetadata?: StoredSceneMetadata;
  /** Monotonic mutation generation used to prevent an in-flight save from clearing newer work. */
  mutationVersion: number;
  recentMsgIds: Set<string>;
  elementLocks: Map<string, ElementLock>;
  following: Map<string, string>;
  viewports: Map<string, UserViewport>;
}
