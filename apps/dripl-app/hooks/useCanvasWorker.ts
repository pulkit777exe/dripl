'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import type { Bounds } from '@dripl/math/geometry';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

interface RBushData {
  children: unknown[];
  leaf: boolean;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialIndexState {
  tree: RBushData | null;
  byId: Map<string, DriplElement>;
  elementIds: Set<string>;
  boundsMap: Map<string, Bounds>;
}

interface WorkerResponse {
  id: string;
  type: string;
  payload: unknown;
}

// ── Worker Pool ───────────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;
let messageId = 0;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker(
    new URL('../workers/canvas-worker.ts', import.meta.url),
    { type: 'module' }
  );

  workerInstance.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { id, type, payload } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);

    if (type === 'error') {
      p.reject(new Error(payload as string));
    } else {
      p.resolve(payload);
    }
  };

  workerInstance.onerror = (e) => {
    console.error('[canvas-worker]', e.message);
    for (const p of pending.values()) {
      p.reject(new Error(e.message));
    }
    pending.clear();
  };

  return workerInstance;
}

function postMessage<T>(type: string, payload: unknown): Promise<T> {
  const worker = getWorker();
  const id = `msg-${++messageId}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, type, payload });
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseCanvasWorkerReturn {
  spatialIndex: SpatialIndexState;
  buildIndex: (elements: DriplElement[]) => Promise<void>;
  hitTest: (
    x: number,
    y: number,
    hitThreshold: number,
    elements: DriplElement[],
    lockedIds: Set<string>,
    userId: string | null,
  ) => Promise<string | null>;
  queryViewport: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => Promise<string[]>;
  isReady: boolean;
}

export function useCanvasWorker(): UseCanvasWorkerReturn {
  const [isReady, setIsReady] = useState(false);
  const spatialIndexRef = useRef<SpatialIndexState>({
    tree: null,
    byId: new Map(),
    elementIds: new Set(),
    boundsMap: new Map(),
  });
  const [spatialIndex, setSpatialIndex] = useState<SpatialIndexState>(spatialIndexRef.current);

  useEffect(() => {
    // Initialize worker
    getWorker();
    setIsReady(true);

    return () => {
      // Don't terminate — shared singleton
    };
  }, []);

  const buildIndex = useCallback(async (elements: DriplElement[]) => {
    try {
      const result = await postMessage<{
        tree: RBushData;
        bounds: Array<{ id: string; bounds: Bounds }>;
      }>('build-index', elements);

      const byId = new Map<string, DriplElement>();
      const elementIds = new Set<string>();
      const boundsMap = new Map<string, Bounds>();

      for (const element of elements) {
        byId.set(element.id, element);
        elementIds.add(element.id);
      }
      for (const { id, bounds } of result.bounds) {
        boundsMap.set(id, bounds);
      }

      const newIndex: SpatialIndexState = {
        tree: result.tree,
        byId,
        elementIds,
        boundsMap,
      };
      spatialIndexRef.current = newIndex;
      setSpatialIndex(newIndex);
    } catch (err) {
      console.error('[useCanvasWorker] buildIndex failed:', err);
    }
  }, []);

  const hitTest = useCallback(
    async (
      x: number,
      y: number,
      hitThreshold: number,
      elements: DriplElement[],
      lockedIds: Set<string>,
      userId: string | null,
    ): Promise<string | null> => {
      try {
        const result = await postMessage<{ id: string | null }>('hit-test', {
          x,
          y,
          hitThreshold,
          elements,
          lockedIds: Array.from(lockedIds),
          userId,
        });
        return result.id;
      } catch (err) {
        console.error('[useCanvasWorker] hitTest failed:', err);
        return null;
      }
    },
    [],
  );

  const queryViewport = useCallback(
    async (bounds: { minX: number; minY: number; maxX: number; maxY: number }): Promise<string[]> => {
      try {
        const result = await postMessage<string[]>('query-viewport', bounds);
        return result;
      } catch (err) {
        console.error('[useCanvasWorker] queryViewport failed:', err);
        return [];
      }
    },
    [],
  );

  return {
    spatialIndex,
    buildIndex,
    hitTest,
    queryViewport,
    isReady,
  };
}
