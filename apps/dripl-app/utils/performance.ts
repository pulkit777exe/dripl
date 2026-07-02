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

const perfEnabled = typeof window !== 'undefined' && 'performance' in window;

export function perfMark(name: string) {
  if (perfEnabled) performance.mark(name);
}

export function perfMeasure(name: string, startMark: string, endMark: string) {
  if (!perfEnabled) return 0;
  try {
    const entry = performance.measure(name, startMark, endMark);
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

export function reportPerf() {
  if (!perfEnabled) return;
  const entries = performance.getEntriesByType('measure');
  const filtered = entries.filter(e => e.name.endsWith(':render'));
  if (filtered.length === 0) return;
  console.groupCollapsed('[perf] render timings');
  filtered.forEach(e => console.log(`${e.name}: ${e.duration.toFixed(1)}ms`));
  console.groupEnd();
  performance.clearMeasures();
}
