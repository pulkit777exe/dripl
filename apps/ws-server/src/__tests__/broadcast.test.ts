/**
 * `broadcast.ts` — the only place this server writes to a socket that is not
 * the one being handled.
 *
 * Small module, but it holds two properties nothing else does: that a message
 * is never handed to a socket that is not open, and that a snapshot payload is
 * built defensively from room state that other code is concurrently deleting
 * from.
 */
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { broadcast, roomCursorsPayload, roomUsersPayload, send } from '../broadcast';
import { getOrCreateRoom, rooms } from '../rooms';
import type { UserConnection } from '../types';

function fakeSocket(readyState: number): WebSocket {
  return { readyState, send: vi.fn() } as unknown as WebSocket;
}

function user(userId: string, socket: WebSocket): UserConnection {
  return { userId, displayName: `Name-${userId}`, color: '#abcdef', ws: socket, isAlive: true };
}

describe('send', () => {
  it('writes a JSON payload to an open socket', () => {
    const socket = fakeSocket(WebSocket.OPEN);
    send(socket, { type: 'pong' });
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
  });

  it('drops the payload for a socket that is not open', () => {
    // Regression: `ws.send` on a closing or closed socket throws
    // `WebSocket is not open`, and `send` is called from inside sweep and
    // handler code with no try/catch of its own. One client hanging up mid-
    // broadcast must not take down the tick that was broadcasting to everyone
    // else.
    for (const readyState of [WebSocket.CONNECTING, WebSocket.CLOSING, WebSocket.CLOSED]) {
      const socket = fakeSocket(readyState);
      expect(() => send(socket, { type: 'pong' })).not.toThrow();
      expect(socket.send).not.toHaveBeenCalled();
    }
  });
});

describe('broadcast', () => {
  it('sends to every open member', () => {
    const room = getOrCreateRoom('b-all');
    const first = fakeSocket(WebSocket.OPEN);
    const second = fakeSocket(WebSocket.OPEN);
    room.users.set('a', user('a', first));
    room.users.set('b', user('b', second));

    broadcast(room, { type: 'ping-relay' });

    expect(first.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping-relay' }));
    expect(second.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping-relay' }));
  });

  it('excludes the named member', () => {
    // This is what keeps a client's own edit from being echoed back to it,
    // which would re-apply the mutation on top of the optimistic local copy.
    const room = getOrCreateRoom('b-except');
    const sender = fakeSocket(WebSocket.OPEN);
    const other = fakeSocket(WebSocket.OPEN);
    room.users.set('a', user('a', sender));
    room.users.set('b', user('b', other));

    broadcast(room, { type: 'scene-delta' }, 'a');

    expect(sender.send).not.toHaveBeenCalled();
    expect(other.send).toHaveBeenCalledTimes(1);
  });

  it('skips a closing member without disturbing the others', () => {
    const room = getOrCreateRoom('b-mixed');
    const gone = fakeSocket(WebSocket.CLOSING);
    const alive = fakeSocket(WebSocket.OPEN);
    room.users.set('gone', user('gone', gone));
    room.users.set('alive', user('alive', alive));

    expect(() => broadcast(room, { type: 'user-leave' })).not.toThrow();
    expect(gone.send).not.toHaveBeenCalled();
    expect(alive.send).toHaveBeenCalledTimes(1);
  });

  it('serializes once for the whole room', () => {
    // The delta is built once and reused: JSON.stringify per recipient would
    // cost one full scene serialization per connected client on the hottest
    // path in the server.
    const room = getOrCreateRoom('b-once');
    room.users.set('a', user('a', fakeSocket(WebSocket.OPEN)));
    room.users.set('b', user('b', fakeSocket(WebSocket.OPEN)));

    broadcast(room, { type: 'scene-delta', added: [] });

    const serialized = new Set(
      [...room.users.values()].flatMap(entry =>
        vi.mocked(entry.ws.send).mock.calls.map(call => String(call[0]))
      )
    );
    expect(serialized.size).toBe(1);
  });
});

describe('room snapshot payloads', () => {
  it('lists members with both userName and displayName', () => {
    // Two spellings on the wire: older clients read `userName`.
    const room = getOrCreateRoom('p-users');
    room.users.set('a', user('a', fakeSocket(WebSocket.OPEN)));
    expect(roomUsersPayload(room)).toEqual([
      { userId: 'a', userName: 'Name-a', displayName: 'Name-a', color: '#abcdef' },
    ]);
  });

  it('returns an empty list for an empty room', () => {
    expect(roomUsersPayload(getOrCreateRoom('p-empty'))).toEqual([]);
  });

  it('substitutes placeholders for a cursor whose user has gone', () => {
    // The join snapshot is built from `room.cursors`, which is not cleaned in
    // lockstep with `room.users` by every exit path. A cursor left behind must
    // not become `undefined` in the payload every joining client receives —
    // that is a client-side render error caused by someone else's disconnect.
    const room = getOrCreateRoom('p-cursor-orphan');
    room.users.set('present', user('present', fakeSocket(WebSocket.OPEN)));
    room.cursors.set('present', { x: 1, y: 2 });
    room.cursors.set('orphan', { x: 3, y: 4 });

    expect(roomCursorsPayload(room)).toEqual([
      {
        userId: 'present',
        x: 1,
        y: 2,
        userName: 'Name-present',
        displayName: 'Name-present',
        color: '#abcdef',
      },
      {
        userId: 'orphan',
        x: 3,
        y: 4,
        userName: 'Unknown',
        displayName: 'Unknown',
        color: '#000000',
      },
    ]);
  });

  it('returns an empty list when no cursor has been reported', () => {
    expect(roomCursorsPayload(getOrCreateRoom('p-no-cursor'))).toEqual([]);
  });

  it('reads the rooms it is given, not a module-level snapshot', () => {
    const room = getOrCreateRoom('p-live');
    room.users.set('a', user('a', fakeSocket(WebSocket.OPEN)));
    expect(rooms.get('p-live')?.users.size).toBe(1);
    expect(roomUsersPayload(room)).toHaveLength(1);
  });
});
