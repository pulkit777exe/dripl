import type { User, Presence } from '@dripl/common';

let userCounter = 0;

export function createTestUser(overrides: Partial<User> = {}): User {
  userCounter += 1;
  return {
    id: overrides.id ?? `user-${userCounter}`,
    name: overrides.name ?? `User ${userCounter}`,
    color: overrides.color ?? `hsl(${userCounter * 60}, 70%, 50%)`,
  };
}

export function createTestPresence(
  userId: string,
  overrides: Partial<Presence> = {}
): Presence {
  return {
    userId,
    cursor: overrides.cursor ?? { x: 0, y: 0 },
    selection: overrides.selection ?? [],
  };
}

export function resetUserCounter(): void {
  userCounter = 0;
}
