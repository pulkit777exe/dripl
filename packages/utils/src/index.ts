/**
 * Generate a random ID string.
 * Uses `Math.random` and base‑36 conversion to create a 9‑character identifier.
 */
export function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Deep‑clone a JSON‑serializable value.
 * Note: Functions, Dates and other non‑JSON types are not preserved.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Create a throttled version of a function.
 * The returned function will invoke `func` at most once per `limit` ms.
 * Subsequent calls within the limit are ignored.
 */
export function throttle(func: (...args: any[]) => void, limit: number) {
  let inThrottle: boolean;
  return function (this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export * from './encryption/index';
export * from './storage/index';
