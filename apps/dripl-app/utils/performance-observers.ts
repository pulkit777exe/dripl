type PerformanceAttribution = {
  name: string;
  sourceURL: string;
  sourceFunctionName: string;
  duration: number;
};

type PerformanceSample = {
  type: string;
  name: string;
  startTime: number;
  duration: number;
  /**
   * Present for long-animation-frame entries: which scripts ran, and for how
   * long. This is what turns "a frame was slow" into "this function was slow".
   */
  attribution?: PerformanceAttribution[];
};

export type PerformanceSnapshot = {
  samples: PerformanceSample[];
  measures: PerformanceSample[];
};

type PerformanceWindow = Window & {
  __driplPerformance?: {
    snapshot: () => PerformanceSnapshot;
    clear: () => void;
  };
};

const MAX_SAMPLES = 200;
const observers: PerformanceObserver[] = [];
const samples: PerformanceSample[] = [];
let started = false;

function isEnabled(): boolean {
  return typeof window !== 'undefined' && process.env.NODE_ENV !== 'production';
}

/** Long animation frames expose per-script attribution; other entry types do not. */
function attributionFor(entry: PerformanceEntry): PerformanceAttribution[] | undefined {
  const scripts = (entry as PerformanceEntry & { scripts?: Array<Record<string, unknown>> })
    .scripts;
  if (!Array.isArray(scripts)) return undefined;

  return scripts.map(script => ({
    name: typeof script.name === 'string' ? script.name : '',
    sourceURL: typeof script.sourceURL === 'string' ? script.sourceURL : '',
    sourceFunctionName:
      typeof script.sourceFunctionName === 'string' ? script.sourceFunctionName : '',
    duration: typeof script.duration === 'number' ? script.duration : 0,
  }));
}

function addSample(entry: PerformanceEntry): void {
  const sample: PerformanceSample = {
    type: entry.entryType,
    name: entry.name,
    startTime: entry.startTime,
    duration: entry.duration,
  };
  const attribution = attributionFor(entry);
  if (attribution && attribution.length > 0) sample.attribution = attribution;

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function currentMeasures(): PerformanceSample[] {
  if (typeof performance === 'undefined') return [];
  return performance
    .getEntriesByType('measure')
    .filter(entry => entry.name.startsWith('canvas:'))
    .slice(-MAX_SAMPLES)
    .map(entry => ({
      type: entry.entryType,
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
    }));
}

function snapshot(): PerformanceSnapshot {
  return { samples: [...samples], measures: currentMeasures() };
}

function clear(): void {
  samples.length = 0;
  if (typeof performance !== 'undefined') performance.clearMeasures();
}

function stop(): void {
  while (observers.length > 0) observers.pop()?.disconnect();
  started = false;
  if (typeof window !== 'undefined') {
    delete (window as PerformanceWindow).__driplPerformance;
  }
}

/**
 * Collect browser performance evidence in development only.
 *
 * The observer is intentionally best-effort: browsers expose different
 * entry types, and an unsupported observer must never break the editor.
 */
export function startPerformanceObservers(): () => void {
  if (!isEnabled() || typeof PerformanceObserver === 'undefined') return () => {};
  if (started) return stop;

  started = true;
  const supported = new Set(PerformanceObserver.supportedEntryTypes ?? []);
  const observe = (type: string, durationThreshold?: number) => {
    if (!supported.has(type)) return;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) addSample(entry);
      });
      observer.observe({
        type,
        buffered: true,
        ...(durationThreshold === undefined ? {} : { durationThreshold }),
      } as PerformanceObserverInit);
      observers.push(observer);
    } catch {
      // A browser may advertise an entry type it cannot observe in this context.
    }
  };

  observe('longtask');
  observe('event', 16);
  observe('long-animation-frame');

  (window as PerformanceWindow).__driplPerformance = { snapshot, clear };
  return stop;
}

export function getPerformanceSnapshot(): PerformanceSnapshot {
  return snapshot();
}
