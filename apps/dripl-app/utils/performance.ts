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
const perfEnabled =
  typeof window !== 'undefined' && 'performance' in window && process.env.NODE_ENV !== 'production';

export function perfMark(name: string) {
  if (perfEnabled) performance.mark(name);
}

export function perfMeasure(name: string, startMark: string, endMark: string) {
  if (!perfEnabled) return 0;
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
