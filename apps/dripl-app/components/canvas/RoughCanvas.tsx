'use client';

import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/canvas-store';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useCanvasWorker } from '@/hooks/useCanvasWorker';
import { getElementBounds, isPointInElement } from '@dripl/math/intersection';
import { type DriplElement } from '@dripl/common';
import { getOrCreateCollaboratorName } from '@/utils/username';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import RBush from 'rbush';
import { SelectionOverlay, ResizeHandle } from './SelectionOverlay';
import { RemoteCursors } from './RemoteCursors';
import { LaserCanvas } from './LaserCanvas';
import { DualCanvas } from './DualCanvas';
import { screenToCanvas, Viewport } from '@/utils/canvas-coordinates';
import { useDrawingTools } from '@/hooks/useDrawingTools';
import { useCanvasPersistence } from '@/hooks/canvas/useCanvasPersistence';
import { useCanvasViewport } from '@/hooks/canvas/useCanvasViewport';
import { useCanvasClipboard } from '@/hooks/canvas/useCanvasClipboard';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import { useCanvasKeyboard } from '@/hooks/canvas/useCanvasKeyboard';
import { useCanvasWheel } from '@/hooks/canvas/useCanvasWheel';

const PropertiesPanel = lazy(() => import('./PropertiesPanel').then(m => ({ default: m.PropertiesPanel })));
const ContextMenu = lazy(() => import('./ContextMenu').then(m => ({ default: m.ContextMenu })));
const NameInputModal = lazy(() => import('./NameInputModal').then(m => ({ default: m.NameInputModal })));
const WelcomeScreen = lazy(() => import('./WelcomeScreen').then(m => ({ default: m.WelcomeScreen })));

interface Point {
  x: number;
  y: number;
}

interface CanvasProps {
  roomSlug: string | null;
  theme: 'light' | 'dark';
}

interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

interface SpatialIndexState {
  tree: RBush<SpatialItem>;
  byId: Map<string, DriplElement>;
  elementIds: Set<string>;
}



export default function RoughCanvas({ roomSlug, theme }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerReady, setContainerReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setContainerReady(!!el);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const entry = entries[0];
      if (!entry) return;
      const rect = entry.contentRect;
      setContainerSize({
        width: rect.width || container.clientWidth,
        height: rect.height || container.clientHeight,
      });
    });

    observer.observe(container);

    setContainerSize({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => {
      observer.disconnect();
    };
  }, [containerReady]);

  const [userName, setUserName] = useState<string | null>(() => getOrCreateCollaboratorName());

  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    id: string;
    value?: string;
    existingElementId?: string;
  } | null>(null);
  const [eraserPath, setEraserPath] = useState<Point[]>([]);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [welcomeScreenDismissed, setWelcomeScreenDismissed] = useState(false);
  const [marqueeSelection, setMarqueeSelection] = useState<{
    start: Point;
    end: Point;
    active: boolean;
  } | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    elementId: string;
  } | null>(null);


  const setDrawingState = useCallback((next: boolean) => {
    isDrawingRef.current = next;
    setIsDrawing(next);
  }, []);
  const activeGestureLocksRef = useRef<Set<string>>(new Set());

  const { startDrawing, updateDrawing, finishDrawing, cancelDrawing } = useDrawingTools();

  const elements = useCanvasStore(useShallow(state => state.elements));
  // draftElement lives in Zustand — the single source of truth for the in-progress shape.
  const draftElement = useCanvasStore(state => state.draftElement);
  const activeTool = useCanvasStore(state => state.activeTool);
  const toolLocked = useCanvasStore(state => state.toolLocked);
  const selectedIds = useCanvasStore(state => state.selectedIds);
  const currentStrokeColor = useCanvasStore(state => state.currentStrokeColor);
  const currentStrokeWidth = useCanvasStore(state => state.currentStrokeWidth);
  const currentRoughness = useCanvasStore(state => state.currentRoughness);
  const currentBackgroundColor = useCanvasStore(state => state.currentBackgroundColor);
  const currentStrokeStyle = useCanvasStore(state => state.currentStrokeStyle);
  const currentFillStyle = useCanvasStore(state => state.currentFillStyle);
  const readOnly = useCanvasStore(state => state.readOnly);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const gridSize = useCanvasStore(state => state.gridSize);
  const marqueeSelectionMode = useCanvasStore(state => state.marqueeSelectionMode);
  const elementLocks = useCanvasStore(state => state.elementLocks);
  const userId = useCanvasStore(state => state.userId);

  const setElements = useCanvasStore(state => state.setElements);
  const addElement = useCanvasStore(state => state.addElement);
  const updateElement = useCanvasStore(state => state.updateElement);
  const updateElementTransient = useCanvasStore(state => state.updateElementTransient);
  const deleteElements = useCanvasStore(state => state.deleteElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const clearSelection = useCanvasStore(state => state.clearSelection);
  const setEditingElementId = useCanvasStore(state => state.setEditingElementId);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const setGridEnabled = useCanvasStore(state => state.setGridEnabled);
  const bringForward = useCanvasStore(state => state.bringForward);
  const sendBackward = useCanvasStore(state => state.sendBackward);
  const bringToFront = useCanvasStore(state => state.bringToFront);
  const sendToBack = useCanvasStore(state => state.sendToBack);
  const undo = useCanvasStore(state => state.undo);
  const redo = useCanvasStore(state => state.redo);
  const pushHistory = useCanvasStore(state => state.pushHistory);
  const groupElements = useCanvasStore(state => state.groupElements);
  const ungroupElements = useCanvasStore(state => state.ungroupElements);

  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);
  const setPan = useCanvasStore(state => state.setPan);
  const setZoom = useCanvasStore(state => state.setZoom);

  const suppressRemoteBroadcastRef = useRef(false);
  const prevElementsRef = useRef<DriplElement[]>([]);
  const {
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
  } = useCollaboration(roomSlug, {
    displayName: userName,
    onFullSync: elements => {
      suppressRemoteBroadcastRef.current = true;
      setElements(elements, { skipHistory: true });
    },
    onRemoteElements: (added, updated, deleted) => {
      suppressRemoteBroadcastRef.current = true;
      const state = useCanvasStore.getState();
      let nextElements = [...state.elements];
      for (const el of added) {
        if (!nextElements.some(e => e.id === el.id)) {
          nextElements.push(el);
        }
      }
      for (const el of updated) {
        const idx = nextElements.findIndex(e => e.id === el.id);
        if (idx !== -1) {
          nextElements[idx] = el;
        }
      }
      if (deleted.length > 0) {
        const deletedSet = new Set(deleted);
        nextElements = nextElements.filter(e => !deletedSet.has(e.id));
      }
      state.setElements(nextElements, { skipHistory: true });
    },
  });

  const lockElementsForGesture = useCallback(
    (ids: Iterable<string>) => {
      for (const id of ids) {
        activeGestureLocksRef.current.add(id);
        lockElement(id);
      }
    },
    [lockElement]
  );

  const unlockGestureElements = useCallback(() => {
    activeGestureLocksRef.current.forEach(id => {
      unlockElement(id);
    });
    activeGestureLocksRef.current.clear();
  }, [unlockElement]);

  useEffect(() => {
    if (!roomSlug) return;
    if (suppressRemoteBroadcastRef.current) {
      suppressRemoteBroadcastRef.current = false;
      prevElementsRef.current = [...elements];
      return;
    }
    const prev = prevElementsRef.current;
    prevElementsRef.current = [...elements];
    broadcastElements(prev, elements);
  }, [broadcastElements, elements, roomSlug]);

  // ── Persist local canvas ─────────────────────────────────────────────────
  useCanvasPersistence({ roomSlug, theme, isDrawingRef });

  useEffect(() => {
    const stored = getOrCreateCollaboratorName();
    setUserName(stored);
  }, []);

  const handleNameSubmit = (name: string) => {
    setUserName(name);
    localStorage.setItem('dripl_username', name);
  };

  // ── Viewport ─────────────────────────────────────────────────────────────
  const viewport: Viewport = {
    x: panX,
    y: panY,
    width: containerSize.width,
    height: containerSize.height,
    zoom,
  };

  const { fitAllToScreen, fitElementsToScreen } = useCanvasViewport(containerRef);

  // Listen for dripl:fit-elements event (dispatched by AI generation modal)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ elementIds: string[] }>;
      if (customEvent.detail?.elementIds?.length) {
        fitElementsToScreen(customEvent.detail.elementIds);
      }
    };
    window.addEventListener('dripl:fit-elements', handler);
    return () => window.removeEventListener('dripl:fit-elements', handler);
  }, [fitElementsToScreen]);

  // ── Clipboard ────────────────────────────────────────────────────────────
  const { duplicateSelection, copySelectedToClipboard, pasteFromClipboard, findOnCanvas } = useCanvasClipboard();

  // ── Spatial index (worker-accelerated rebuild) ──────────────────────────────
  const spatialIndexRef = useRef<SpatialIndexState>({
    tree: new RBush<SpatialItem>(),
    byId: new Map<string, DriplElement>(),
    elementIds: new Set<string>(),
  });

  // Track spatial signature to skip useMemo re-run when only non-spatial props change
  const spatialSigRef = useRef('');
  const spatialSig = elements
    .map(e => `${e.id}:${e.x}:${e.y}:${e.width}:${e.height}:${e.angle ?? 0}`)
    .join('|');
  const spatialChanged = spatialSig !== spatialSigRef.current;
  if (spatialChanged) spatialSigRef.current = spatialSig;
  const { buildIndex, isReady: workerReady } = useCanvasWorker();
  const workerBusyRef = useRef(false);

  // Worker-based spatial index rebuild — offloads getElementBounds + tree construction
  useEffect(() => {
    if (!workerReady) return;

    // Debounce: skip if previous worker build still in progress
    if (workerBusyRef.current) return;
    workerBusyRef.current = true;

    buildIndex(elements).then(() => {
      workerBusyRef.current = false;
    }).catch(() => {
      workerBusyRef.current = false;
    });
  }, [elements, workerReady, buildIndex]);

  // Synchronous local RBush for hit testing (loaded from worker result)
  // Fallback: rebuild inline if worker not ready
  const spatialIndex = useMemo<SpatialIndexState>(() => {
    // Skip expensive diffing if only non-spatial props changed
    if (!spatialChanged) return spatialIndexRef.current;

    const prev = spatialIndexRef.current;

    const prevIds = prev.elementIds;
    const currentIds = new Set(elements.map(e => e.id));

    const added = elements.filter(e => !prevIds.has(e.id));
    const removed = [...prevIds].filter(id => !currentIds.has(id));
    const updated = elements.filter(e => {
      if (!prevIds.has(e.id)) return false;
      const prevEl = prev.byId.get(e.id);
      if (!prevEl) return true;
      return (
        prevEl.x !== e.x ||
        prevEl.y !== e.y ||
        prevEl.width !== e.width ||
        prevEl.height !== e.height ||
        prevEl.angle !== e.angle
      );
    });

    if (added.length + removed.length + updated.length > elements.length * 0.4) {
      const tree = new RBush<SpatialItem>();
      const byId = new Map<string, DriplElement>();
      const elementIds = new Set<string>();
      elements.forEach(element => {
        const bounds = getElementBounds(element);
        tree.insert({
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          id: element.id,
        });
        byId.set(element.id, element);
        elementIds.add(element.id);
      });
      spatialIndexRef.current = { tree, byId, elementIds };
    } else {
      for (const id of removed) {
        const prevEl = prev.byId.get(id);
        if (prevEl) {
          const bounds = getElementBounds(prevEl);
          prev.tree.remove({
            minX: bounds.x,
            minY: bounds.y,
            maxX: bounds.x + bounds.width,
            maxY: bounds.y + bounds.height,
            id,
          });
          prev.byId.delete(id);
          prevIds.delete(id);
        }
      }
      for (const el of added) {
        const bounds = getElementBounds(el);
        prev.tree.insert({
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          id: el.id,
        });
        prev.byId.set(el.id, el);
        prevIds.add(el.id);
      }
      for (const el of updated) {
        const prevEl = prev.byId.get(el.id);
        if (prevEl) {
          const prevBounds = getElementBounds(prevEl);
          prev.tree.remove({
            minX: prevBounds.x,
            minY: prevBounds.y,
            maxX: prevBounds.x + prevBounds.width,
            maxY: prevBounds.y + prevBounds.height,
            id: el.id,
          });
        }
        const bounds = getElementBounds(el);
        prev.tree.insert({
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          id: el.id,
        });
        prev.byId.set(el.id, el);
      }
    }

    return spatialIndexRef.current;
  }, [elements]);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): Point => {
      const target = e.target as Node;
      const canvas =
        target && target instanceof HTMLCanvasElement
          ? target
          : containerRef.current?.querySelector('canvas');
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;
      return screenToCanvas(pixelX, pixelY, viewport);
    },

    [panX, panY, zoom]
  );

  const snapPointToGrid = useCallback(
    (point: Point): Point => {
      if (!gridEnabled || gridSize <= 1) return point;
      return {
        x: Math.round(point.x / gridSize) * gridSize,
        y: Math.round(point.y / gridSize) * gridSize,
      };
    },
    [gridEnabled, gridSize]
  );

  const getDistanceToBounds = useCallback((point: Point, element: DriplElement): number => {
    const bounds = getElementBounds(element);
    const nearestX = Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width));
    const nearestY = Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height));
    const dx = point.x - nearestX;
    const dy = point.y - nearestY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const isPointNearElement = useCallback(
    (point: Point, element: DriplElement, tolerance: number): boolean => {
      if (isPointInElement(point, element)) return true;
      return getDistanceToBounds(point, element) <= tolerance;
    },
    [getDistanceToBounds]
  );

  const getElementAtPosition = useCallback(
    (x: number, y: number): DriplElement | null => {
      const state = useCanvasStore.getState();
      // Zoom-aware hit threshold: wider tolerance at low zoom, narrower at high zoom (TODO #34)
      const hitThreshold = Math.max(2, 8 / state.zoom);
      const candidates = spatialIndex.tree.search({
        minX: x - hitThreshold,
        minY: y - hitThreshold,
        maxX: x + hitThreshold,
        maxY: y + hitThreshold,
      });
      const candidateIds = new Set(candidates.map(candidate => candidate.id));
      for (let i = state.elements.length - 1; i >= 0; i -= 1) {
        const element = state.elements[i];
        if (!element) continue;
        if (!candidateIds.has(element.id)) continue;
        if (
          state.elementLocks.has(element.id) &&
          state.elementLocks.get(element.id) !== state.userId
        ) {
          continue;
        }
        // Per-element zoom-aware tolerance: thin elements get extra slack at low zoom
        const elThreshold = Math.max((element.strokeWidth ?? 2) / 2 + 0.1, 8 / state.zoom);
        if (!isPointNearElement({ x, y }, element, elThreshold)) continue;
        if (element.type === 'text' && ('boundElementId' in element || 'containerId' in element)) {
          const containerId =
            ('boundElementId' in element ? element.boundElementId : undefined) ??
            ('containerId' in element ? element.containerId : undefined);
          if (containerId) {
            const container = state.elements.find(candidate => candidate.id === containerId);
            if (
              container &&
              (!state.elementLocks.has(container.id) ||
                state.elementLocks.get(container.id) === state.userId)
            ) {
              return container;
            }
          }
        }
        return element;
      }
      return null;
    },
    [isPointNearElement, spatialIndex.tree]
  );

  const collectCascadeDeleteIds = useCallback(
    (seedIds: Iterable<string>): string[] => {
      const toDelete = new Set<string>(seedIds);
      if (toDelete.size === 0) return [];

      let changed = true;
      while (changed) {
        changed = false;
        elements.forEach(element => {
          if (toDelete.has(element.id)) {
            if (
              (element.type === 'arrow' || element.type === 'line') &&
              'labelId' in element &&
              element.labelId &&
              !toDelete.has(element.labelId)
            ) {
              toDelete.add(element.labelId);
              changed = true;
            }
            return;
          }

          if (element.type !== 'text') return;
          const boundTargetId =
            ('boundElementId' in element ? element.boundElementId : undefined) ??
            ('containerId' in element ? element.containerId : undefined);
          if (boundTargetId && toDelete.has(boundTargetId)) {
            toDelete.add(element.id);
            changed = true;
          }
        });
      }

      return Array.from(toDelete);
    },
    [elements]
  );

  const getSelectionBounds = useCallback((selected: Set<string>, sceneElements: DriplElement[]) => {
    const selectedElements = sceneElements.filter(element => selected.has(element.id));
    if (selectedElements.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    selectedElements.forEach(element => {
      const bounds = getElementBounds(element);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    });

    return { minX, minY, maxX, maxY };
  }, []);

  const maybeRevertToSelectTool = useCallback(
    (completedTool: ActiveTool) => {
      if (toolLocked || completedTool === 'laser') return;
      // RULE: Tool Reversion
      setActiveTool('select');
    },
    [setActiveTool, toolLocked]
  );

  const expandSelectionWithGroups = useCallback(
    (ids: Set<string>, sceneElements: DriplElement[]): Set<string> => {
      const expanded = new Set(ids);
      if (ids.size === 0) return expanded;

      const groupIds = new Set<string>();
      sceneElements.forEach(element => {
        if (ids.has(element.id) && element.groupId) {
          groupIds.add(element.groupId);
        }
      });

      if (groupIds.size === 0) return expanded;

      sceneElements.forEach(element => {
        if (element.groupId && groupIds.has(element.groupId)) {
          expanded.add(element.id);
        }
      });

      return expanded;
    },
    []
  );

  const applyFrameGrouping = useCallback(
    (frameElement: DriplElement) => {
      if (frameElement.type !== 'frame') return;

      const state = useCanvasStore.getState();
      const frameBounds = getElementBounds(frameElement);
      const frameRight = frameBounds.x + frameBounds.width;
      const frameBottom = frameBounds.y + frameBounds.height;

      const groupedIds = state.elements
        .filter(element => element.id !== frameElement.id)
        .filter(element => {
          const bounds = getElementBounds(element);
          return (
            bounds.x >= frameBounds.x &&
            bounds.y >= frameBounds.y &&
            bounds.x + bounds.width <= frameRight &&
            bounds.y + bounds.height <= frameBottom
          );
        })
        .map(element => element.id);

      if (groupedIds.length === 0) return;

      const frameGroupId = `frame-${frameElement.id}`;
      const idsToGroup = new Set([frameElement.id, ...groupedIds]);

      const nextElements = state.elements.map(element => {
        if (!idsToGroup.has(element.id)) return element;
        return { ...element, groupId: frameGroupId } as DriplElement;
      });

      state.setElements(nextElements);
      setSelectedIds(new Set([frameElement.id, ...groupedIds]));
    },
    [setSelectedIds]
  );

  // ── Pointer events hook ──────────────────────────────────────────────────
  const {
    interactionRef,
    lastToolBeforeSpaceRef,
    eraserHitIdsRef,
    handleDragOver,
    handleDrop: hookHandleDrop,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useCanvasPointerEvents({
    readOnly,
    getCanvasCoordinates,
    snapPointToGrid,
    broadcastCursor,
    addElement,
    getElementAtPosition,
    updateElementTransient,
    pushHistory,
    lockElementsForGesture,
    unlockElement,
    unlockGestureElements,
    setEditingElementId,
    updateDrawing,
    setDrawingState,
    maybeRevertToSelectTool,
    finishDrawing,
    applyFrameGrouping,
    spatialIndex,
  });

  // Legacy createElement is removed — all element creation goes through
  // useDrawingTools (startDrawing → updateDrawing → finishDrawing → commitDraft).

  // ── Resize start ──────────────────────────────────────────────────────────
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation();
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find(el => el.id === selectedIdsArray[0]);
      if (!element) return;
      const lockOwner = state.elementLocks.get(element.id);
      if (lockOwner && lockOwner !== state.userId) return;

      const startPos = getCanvasCoordinates(e);

      // Deep clone element to freeze it as the baseline
      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

      interactionRef.current.resizing = true;
      interactionRef.current.historyPushed = false;
      interactionRef.current.resizeHandle = handle;
      interactionRef.current.resizeStartCanvasPos = startPos;
      interactionRef.current.resizeInitialEl = frozenEl;

      setIsResizing(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      // Capture pointer on the canvas so we still get events outside
      const canvas = containerRef.current?.querySelector(
        'canvas:last-child'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [getCanvasCoordinates, lockElementsForGesture, setEditingElementId]
  );

  // ── Rotate start ──────────────────────────────────────────────────────────
  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find(el => el.id === selectedIdsArray[0]);
      if (!element) return;
      const lockOwner = state.elementLocks.get(element.id);
      if (lockOwner && lockOwner !== state.userId) return;

      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

      interactionRef.current.rotating = true;
      interactionRef.current.historyPushed = false;
      interactionRef.current.rotateInitialEl = frozenEl;

      setIsRotating(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      const canvas = containerRef.current?.querySelector(
        'canvas:last-child'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [lockElementsForGesture, setEditingElementId]
  );

  useEffect(() => {
    return () => {
      unlockGestureElements();
    };
  }, [unlockGestureElements]);

  const handleTextSubmit = (text: string) => {
    if (!textInput || !text.trim()) {
      setTextInput(null);
      if (activeTool === 'text') {
        maybeRevertToSelectTool('text'); // RULE: Tool Reversion
      }
      return;
    }

    const lines = text.split('\n');
    const lineHeightFactor = 1.25;
    // Use a base fontSize for measurement; actual fontSize comes from element (if editing) or default
    const baseFontSize = textInput.existingElementId
      ? (elements.find(el => el.id === textInput.existingElementId)?.fontSize ?? 20)
      : 20;
    const lineHeight = baseFontSize * lineHeightFactor;
    const measuredWidth = Math.max(40, ...lines.map(line => line.length * (baseFontSize * 0.55)));
    const measuredHeight = Math.max(lineHeight, lines.length * lineHeight);

    if (textInput.existingElementId) {
      const existingElement = elements.find(el => el.id === textInput.existingElementId);
      updateElement(textInput.existingElementId, {
        text,
        width: measuredWidth,
        height: measuredHeight,
        // Re-measure and update fontSize/width/height based on new content while preserving user's font
        fontSize: existingElement?.fontSize ?? 20,
        fontFamily: existingElement?.fontFamily ?? getDefaultFontFamily(),
      } as Partial<DriplElement>);
      setTextInput(null);
      if (activeTool === 'text') {
        maybeRevertToSelectTool('text'); // RULE: Tool Reversion
      }
      return;
    }

    const textElement: DriplElement = {
      id: textInput.id,
      type: 'text',
      x: textInput.x,
      y: textInput.y,
      width: measuredWidth,
      height: measuredHeight,
      strokeColor: currentStrokeColor,
      backgroundColor: 'transparent',
      strokeWidth: 1,
      opacity: 1,
      text,
      fontSize: baseFontSize,
      fontFamily: getDefaultFontFamily(),
    };

    addElement(textElement);
    setTextInput(null);
    if (activeTool === 'text') {
      maybeRevertToSelectTool('text'); // RULE: Tool Reversion
    }
  };

  const openContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const point = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, viewport);
      const element = getElementAtPosition(point.x, point.y);
      if (!element) {
        setContextMenuState(null);
        return;
      }
      if (!selectedIds.has(element.id)) {
        setSelectedIds(new Set([element.id]));
      }
      setContextMenuState({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        elementId: element.id,
      });
    },
    [getElementAtPosition, readOnly, selectedIds, setSelectedIds, viewport]
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useCanvasKeyboard({
    interactionRef,
    lastToolBeforeSpaceRef,
    activeTool,
    readOnly,
    elements,
    setTextInput,
    setDrawingState,
    cancelDrawing,
    collectCascadeDeleteIds,
    copySelectedToClipboard,
    pasteFromClipboard,
    duplicateSelection,
    findOnCanvas,
    fitAllToScreen,
  });

  // ── Mouse wheel zoom & momentum ───────────────────────────────────────
  const { stopMomentum } = useCanvasWheel({ containerRef, containerReady });

  const collaboratorCursors = collaborators;
  const shouldShowPropertiesPanel = activeTool === 'select' && selectedIds.size > 0; // RULE: Sidebar Visibility
  const primarySelectedElement =
    selectedIds.size > 0 ? (elements.find(element => selectedIds.has(element.id)) ?? null) : null;

  return (
    <div
      ref={setContainerRef}
      className="relative w-full h-full"
      onDragOver={handleDragOver}
      onDrop={hookHandleDrop}
      onContextMenu={openContextMenu}
      style={{ backgroundColor: 'var(--color-canvas-bg)' }}
    >
      {containerReady && (
        <DualCanvas
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
          elements={elements}
          selectedIds={selectedIds}
          draftElement={draftElement}
          eraserPath={eraserPath}
          viewport={viewport}
          theme={theme}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          cursorPosition={cursorPosition}
          isDragging={isDragging}
          isResizing={isResizing}
          isDrawing={isDrawing}
          marqueeSelection={marqueeSelection}
          gridEnabled={gridEnabled}
          gridSize={gridSize}
          collaborators={collaboratorCursors}
          lockOwners={elementLocks}
          localUserId={userId}
        />
      )}

      <LaserCanvas />

      {!readOnly && (
        <SelectionOverlay
          zoom={zoom}
          panX={panX}
          panY={panY}
          elements={elements}
          selectedIds={selectedIds}
          onResizeStart={handleResizeStart}
          onRotateStart={handleRotateStart}
          marqueeSelection={marqueeSelection}
        />
      )}

      <RemoteCursors />

      {roomSlug === null && elements.length === 0 && !welcomeScreenDismissed && (
        <Suspense fallback={null}>
          <WelcomeScreen onClose={() => setWelcomeScreenDismissed(true)} />
        </Suspense>
      )}

      {!userName && roomSlug !== null && (
        <Suspense fallback={null}>
          <NameInputModal onSubmit={handleNameSubmit} />
        </Suspense>
      )}

      {shouldShowPropertiesPanel && (
        <div className="absolute top-20 left-4 z-20">
          <Suspense fallback={null}>
            <PropertiesPanel
              selectedElement={primarySelectedElement}
              onUpdateElement={updatedElement => {
                if (updatedElement.id) {
                  updateElement(updatedElement.id, updatedElement);
                }
              }}
            />
          </Suspense>
        </div>
      )}

      {textInput && (
        <textarea
          ref={el => el?.focus()}
          defaultValue={textInput.value ?? ''}
          className="canvas-text-input absolute outline-none resize-none"
          style={{
            left: `${textInput.x * zoom + panX}px`,
            top: `${textInput.y * zoom + panY}px`,
            fontSize: `${20 * zoom}px`,
            lineHeight: 1.4,
            color: 'var(--color-default-stroke)',
            background: 'transparent',
            border: '1.5px dashed #6965db',
            borderRadius: 2,
            minWidth: '160px',
            minHeight: '28px',
            padding: '2px 4px',
            zIndex: 1000,
          }}
          onBlur={e => {
            if (e.target.value.trim()) handleTextSubmit(e.target.value);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleTextSubmit(e.currentTarget.value);
            }
            if (e.key === 'Escape') setTextInput(null);
          }}
          placeholder="Type text…"
        />
      )}

      {activeTool === 'eraser' && cursorPosition && (
        <div
          className="absolute pointer-events-none rounded-full border"
          style={{
            left: `${cursorPosition.x * zoom + panX - 20}px`,
            top: `${cursorPosition.y * zoom + panY - 20}px`,
            width: 40,
            height: 40,
            borderColor: 'rgba(255,255,255,0.75)',
            backgroundColor: 'rgba(255,255,255,0.08)',
            zIndex: 40,
          }}
        />
      )}

      {contextMenuState && (
        <Suspense fallback={null}>
          <ContextMenu
            x={contextMenuState.x}
            y={contextMenuState.y}
            element={elements.find(element => element.id === contextMenuState.elementId) ?? null}
            onClose={() => setContextMenuState(null)}
            onDuplicate={duplicateSelection}
            onDelete={() => {
              const ids = Array.from(useCanvasStore.getState().selectedIds);
              deleteElements(collectCascadeDeleteIds(ids));
              clearSelection();
            }}
            onBringToFront={() => {
              const ids = Array.from(useCanvasStore.getState().selectedIds);
              bringToFront(ids);
            }}
            onSendToBack={() => {
              const ids = Array.from(useCanvasStore.getState().selectedIds);
              sendToBack(ids);
            }}
            onCopy={() => {
              void copySelectedToClipboard();
            }}
            onPaste={() => {
              void pasteFromClipboard();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
