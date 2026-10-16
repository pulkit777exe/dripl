import type { StateCreator } from 'zustand';
import type { CanvasStoreState, CollabSlice } from './types';

export const createCollabSlice: StateCreator<CanvasStoreState, [], [], CollabSlice> = set => ({
  roomId: null,
  roomSlug: null,
  isConnected: false,
  shouldLeaveRoom: false,
  // Single representation, multiple writers — precedence is last-write-wins
  // by effect order, which converges correctly in practice: room join forces
  // `true` until the authoritative sync, the server's `readOnly` flag then
  // owns the value, and route props are static per mount. Do not add a
  // second flag (e.g. serverReadOnly vs localReadOnly); the failure mode of
  // two flags disagreeing is worse than a transient wrong-mode window that
  // the next sync heals.
  readOnly: false,
  userId: null,
  remoteUsers: new Map(),
  remoteCursors: new Map(),
  elementLocks: new Map(),

  setRoomId: roomId => set({ roomId }),
  setRoomSlug: roomSlug => set({ roomSlug }),
  setIsConnected: isConnected => set({ isConnected }),
  setShouldLeaveRoom: should => set({ shouldLeaveRoom: should }),
  setReadOnly: readOnly => set({ readOnly }),
  setUserId: userId => set({ userId }),

  setRemoteUsers: remoteUsers => set({ remoteUsers }),
  addRemoteUser: user =>
    set(state => {
      const remoteUsers = new Map(state.remoteUsers);
      remoteUsers.set(user.userId, { ...user, lastSeenAt: Date.now() });
      return { remoteUsers };
    }),
  removeRemoteUser: userId =>
    set(state => {
      const remoteUsers = new Map(state.remoteUsers);
      remoteUsers.delete(userId);
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.delete(userId);
      return { remoteUsers, remoteCursors };
    }),
  updateRemoteCursor: (userId, cursor) =>
    set(state => {
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.set(userId, { ...cursor, updatedAt: Date.now() });
      // A moving cursor is proof of presence: refresh the user's last-seen
      // too, or the user sweeper below would evict an active collaborator
      // whose avatar it should keep.
      const existing = state.remoteUsers.get(userId);
      if (existing) {
        const remoteUsers = new Map(state.remoteUsers);
        remoteUsers.set(userId, { ...existing, lastSeenAt: Date.now() });
        return { remoteCursors, remoteUsers };
      }
      return { remoteCursors };
    }),
  removeRemoteCursor: userId =>
    set(state => {
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.delete(userId);
      return { remoteCursors };
    }),
  clearRemoteCursors: () => set({ remoteCursors: new Map() }),

  setElementLock: (elementId, userId) =>
    set(state => {
      const elementLocks = new Map(state.elementLocks);
      elementLocks.set(elementId, userId);
      return { elementLocks };
    }),
  releaseElementLock: elementId =>
    set(state => {
      const elementLocks = new Map(state.elementLocks);
      elementLocks.delete(elementId);
      return { elementLocks };
    }),
  clearElementLocks: () => set({ elementLocks: new Map<string, string>() }),
});
