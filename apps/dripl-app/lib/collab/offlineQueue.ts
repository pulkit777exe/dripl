/**
 * Bounded offline queue — pure helper extracted from `useCollaboration`.
 *
 * Scene messages produced while the socket is down wait here for the
 * post-`sync_room_state` replay. The cap keeps a long offline stretch from
 * growing memory (and the replay burst) without bound; oldest-first eviction
 * preserves the newest edits, which is what the next delta would carry
 * anyway.
 */

export const OFFLINE_QUEUE_MAX = 100;

export interface QueuedMessage<T> {
  msg: T;
  timestamp: number;
}

export function enqueueOfflineMessage<T>(
  queue: Array<QueuedMessage<T>>,
  msg: T,
  max: number = OFFLINE_QUEUE_MAX,
  now: number = Date.now()
): Array<QueuedMessage<T>> {
  if (queue.length >= max) {
    queue.shift();
  }
  queue.push({ msg, timestamp: now });
  return queue;
}
