/**
 * Generate a random ID string.
 * Uses `Math.random` and base‑36 conversion to create a 9‑character identifier.
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
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
export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return function (this: unknown, ...args: Parameters<T>): void {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export * from './encryption/index';
export * from './storage/index';
export * from './env';
