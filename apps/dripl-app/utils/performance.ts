export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  let lastResult: ReturnType<T>;

  return function executedFunction(...args: Parameters<T>): ReturnType<T> {
    if (!inThrottle) {
      lastResult = func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
    return lastResult;
  };
}

export function batch<T extends (...args: any[]) => any>(
  func: T,
  delay: number = 0
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  let pendingArgs: Parameters<T> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    pendingArgs = args;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      if (pendingArgs) {
        func(...pendingArgs);
        pendingArgs = null;
      }
    }, delay);
  };
}

export function memoize<T extends (...args: any[]) => any>(
  func: T,
  keyGenerator?: (...args: Parameters<T>) => string
): T {
  const cache = new Map<string, ReturnType<T>>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyGenerator
      ? keyGenerator(...args)
      : JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = func(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

export function limitCacheSize<K, V>(
  cache: Map<K, V>,
  maxSize: number
): void {
  if (cache.size > maxSize) {
    const keysToDelete = Array.from(cache.keys()).slice(
      0,
      cache.size - maxSize
    );
    keysToDelete.forEach((key) => cache.delete(key));
  }
}
