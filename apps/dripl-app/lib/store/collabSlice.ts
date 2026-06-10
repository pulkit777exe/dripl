import type { StateCreator } from 'zustand';
import type { CanvasStoreState, CollabSlice } from './types';

export const createCollabSlice: StateCreator<CanvasStoreState, [], [], CollabSlice> = (set) => ({
  roomId: null,
  roomSlug: null,
  isConnected: false,
  shouldLeaveRoom: false,
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
      remoteUsers.set(user.userId, user);
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
      return { remoteCursors };
    }),
  removeRemoteCursor: userId =>
    set(state => {
      const remoteCursors = new Map(state.remoteCursors);
      remoteCursors.delete(userId);
      return { remoteCursors };
    }),

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
