export function debounce<TArgs extends unknown[], TReturn>(
  func: (...args: TArgs) => TReturn,
  wait: number
): (...args: TArgs) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: TArgs) {
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

export function throttle<TArgs extends unknown[], TReturn>(
  func: (...args: TArgs) => TReturn,
  limit: number
): (...args: TArgs) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: TArgs): void {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Keep user timing instrumentation opt-in outside development. The canvas
// render path can run on every pointer frame; accumulating measures in a
// production build adds work without a consumer.
//
// The one exception is an explicit `?perf=1` in the URL: the Playwright
// performance spec runs against production builds through exactly that flag,
// because the collector it reads would otherwise not exist there. Default
// traffic never carries it, so users pay nothing.
let cachedMeasurementEnabled: boolean | null = null;

function hasPerfFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('perf');
  } catch {
    return false;
  }
}

export function isPerfMeasurementEnabled(): boolean {
  if (cachedMeasurementEnabled === null) {
    cachedMeasurementEnabled =
      typeof window !== 'undefined' &&
      'performance' in window &&
      (process.env.NODE_ENV !== 'production' || hasPerfFlag());
  }
  return cachedMeasurementEnabled;
}

/** Test-only escape hatch: `vi.resetModules` gives a fresh module (and a fresh
 * cache), but tests that toggle the URL within one import need this. */
export function resetPerfMeasurementCache(): void {
  cachedMeasurementEnabled = null;
}

export function perfMark(name: string) {
  if (!isPerfMeasurementEnabled()) return;
  performance.mark(name);
}

export function perfMeasure(name: string, startMark: string, endMark: string) {
  if (!isPerfMeasurementEnabled()) return 0;
  try {
    const entry = performance.measure(name, startMark, endMark);
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    return entry.duration;
  } catch {
    return 0;
  }
}

export function useRenderTiming(componentName: string) {
  if (typeof window === 'undefined') return;
  const start = `${componentName}:render:start`;
  const end = `${componentName}:render:end`;
  perfMark(start);
  return () => {
    perfMark(end);
    perfMeasure(`${componentName}:render`, start, end);
  };
}
