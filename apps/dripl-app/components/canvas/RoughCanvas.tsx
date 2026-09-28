'use client';

import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import { useCollaboration } from '@/hooks/useCollaboration';
import {
  getElementBounds,
  isPointNearElement,
  shouldTestInside,
  isPointOnElementOutline,
} from '@dripl/math/intersection';
import { type DriplElement } from '@dripl/common';
import { shouldAcceptElement } from '@dripl/common/reconciliation';
import { collectCascadeDeleteIds } from '@dripl/common/cascade-delete';
import { getOrCreateCollaboratorName } from '@/utils/username';
import { getDefaultFontFamily } from '@/utils/fontPreferences';
import { useAuth } from '@/app/context/AuthContext';
import { MemoizedSelectionOverlay, ResizeHandle } from './SelectionOverlay';
import { MemoizedRemoteCursors } from './RemoteCursors';
import { LaserCanvas } from './LaserCanvas';
import DualCanvas from './DualCanvas';
import { screenToCanvas, Viewport } from '@/utils/canvas-coordinates';
import { useDrawingTools } from '@/hooks/useDrawingTools';
import { useCanvasPersistence } from '@/hooks/canvas/useCanvasPersistence';
import { perfMark, perfMeasure } from '@/utils/performance';
import { useCanvasViewport } from '@/hooks/canvas/useCanvasViewport';
import { useSpatialIndex } from '@/hooks/canvas/useSpatialIndex';
import { useCanvasClipboard } from '@/hooks/canvas/useCanvasClipboard';
import { useCanvasPointerEvents } from '@/hooks/canvas/useCanvasPointerEvents';
import { useCanvasKeyboard } from '@/hooks/canvas/useCanvasKeyboard';
import { useCanvasWheel } from '@/hooks/canvas/useCanvasWheel';

const PropertiesPanel = lazy(() =>
  import('./PropertiesPanel').then(m => ({ default: m.PropertiesPanel }))
);
const ContextMenu = lazy(() => import('./ContextMenu').then(m => ({ default: m.ContextMenu })));
const NameInputModal = lazy(() =>
  import('./NameInputModal').then(m => ({ default: m.NameInputModal }))
);
const WelcomeScreen = lazy(() =>
  import('./WelcomeScreen').then(m => ({ default: m.WelcomeScreen }))
);

interface Point {
  x: number;
  y: number;
}

interface CanvasProps {
  roomSlug: string | null;
  theme: 'light' | 'dark';
  shareToken?: string | null;
}

export default function RoughCanvas({ roomSlug, theme, shareToken = null }: CanvasProps) {
  perfMark('RoughCanvas:render:start');
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

  const { user } = useAuth();
  const [userName, setUserName] = useState<string | null>(
    () => user?.name?.trim() || getOrCreateCollaboratorName()
  );

  const isDrawing = useCanvasStore(s => s.isDrawing);
  const isDrawingRef = useRef(false);
  const isDragging = useCanvasStore(s => s.isDragging);
  const isResizing = useCanvasStore(s => s.isResizing);
  const textInput = useCanvasStore(s => s.textInput);
  const eraserPath = useCanvasStore(state => state.eraserPath);
  const cursorPosition = useCanvasStore(state => state.cursorPosition);
  const [welcomeScreenDismissed, setWelcomeScreenDismissed] = useState(false);
  const marqueeSelection = useCanvasStore(state => state.marqueeSelection);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    elementId: string;
  } | null>(null);

  const setDrawingState = useCallback((next: boolean) => {
    isDrawingRef.current = next;
    useCanvasStore.getState().setIsDrawing(next);
  }, []);
  const activeGestureLocksRef = useRef<Set<string>>(new Set());

  const { startDrawing, updateDrawing, finishDrawing, cancelDrawing } = useDrawingTools();

  const elements = useCanvasStore(useShallow(state => state.elements));
  // draftElement lives in Zustand — the single source of truth for the in-progress shape.
  const draftElement = useCanvasStore(state => state.draftElement);
  const activeTool = useCanvasStore(state => state.activeTool);
  const toolLocked = useCanvasStore(state => state.toolLocked);
  const selectedIds = useCanvasStore(useShallow(state => state.selectedIds));
  const currentStrokeColor = useCanvasStore(state => state.currentStrokeColor);
  const readOnly = useCanvasStore(state => state.readOnly);
  useEffect(() => {
    if (readOnly) setContextMenuState(null);
  }, [readOnly]);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const gridSize = useCanvasStore(state => state.gridSize);
  const elementLocks = useCanvasStore(state => state.elementLocks);
  const userId = useCanvasStore(state => state.userId);
  const shouldCacheIgnoreZoom = useCanvasStore(state => state.shouldCacheIgnoreZoom);

  const setElements = useCanvasStore(state => state.setElements);
  const addElement = useCanvasStore(state => state.addElement);
  const updateElement = useCanvasStore(state => state.updateElement);
  const updateElementTransient = useCanvasStore(state => state.updateElementTransient);
  const updateElementsTransient = useCanvasStore(state => state.updateElementsTransient);
  const deleteElements = useCanvasStore(state => state.deleteElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const clearSelection = useCanvasStore(state => state.clearSelection);
  const setEditingElementId = useCanvasStore(state => state.setEditingElementId);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const bringToFront = useCanvasStore(state => state.bringToFront);
  const sendToBack = useCanvasStore(state => state.sendToBack);
  const pushHistory = useCanvasStore(state => state.pushHistory);

  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);

  const suppressRemoteBroadcastRef = useRef(false);
  const hasReceivedInitialSyncRef = useRef(false);
  useEffect(() => {
    hasReceivedInitialSyncRef.current = false;
    suppressRemoteBroadcastRef.current = false;
  }, [roomSlug, shareToken]);
  const {
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
    isConnected,
    connectionMessage,
  } = useCollaboration(roomSlug, {
    displayName: userName,
    shareToken,
    onFullSync: elements => {
      hasReceivedInitialSyncRef.current = true;
      suppressRemoteBroadcastRef.current = true;
      setElements(elements, { skipHistory: true });
    },
    onRemoteElements: (added, updated, deleted) => {
      const state = useCanvasStore.getState();
      const nextById = new Map(state.elementsById);
      const draftId = state.draftElement?.id;
      let changed = false;
      const isLocallyEditing = (id: string) =>
        activeGestureLocksRef.current.has(id) || id === draftId;

      for (const el of added) {
        if (isLocallyEditing(el.id)) continue;
        const current = nextById.get(el.id);
        if (!current || shouldAcceptElement(el, current)) {
          nextById.set(el.id, el);
          changed = true;
        }
      }
      for (const el of updated) {
        if (isLocallyEditing(el.id)) continue;
        const current = nextById.get(el.id);
        if (!current || shouldAcceptElement(el, current)) {
          nextById.set(el.id, el);
          changed = true;
        }
      }
      if (deleted.length > 0) {
        const deletedSet = new Set(deleted);
        for (const id of deletedSet) {
          if (isLocallyEditing(id)) continue;
          if (nextById.delete(id)) changed = true;
        }
      }
      if (changed) {
        suppressRemoteBroadcastRef.current = true;
        state.setElements(Array.from(nextById.values()), { skipHistory: true });
      }
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
      return;
    }
    broadcastElements(elements);
  }, [broadcastElements, elements, roomSlug]);

  useEffect(() => {
    if (roomSlug && !hasReceivedInitialSyncRef.current) {
      // Do not let a room page create local edits before the authenticated
      // initial sync. Once sync has arrived, the server's readOnly flag owns
      // the state and offline edits remain queueable.
      useCanvasStore.getState().setReadOnly(true);
    }
  }, [isConnected, roomSlug, shareToken]);

  // ── Persist local canvas ─────────────────────────────────────────────────
  useCanvasPersistence({ roomSlug, theme, isDrawingRef, readOnly });

  useEffect(() => {
    const stored = getOrCreateCollaboratorName();
    setUserName(stored);
  }, []);

  const handleNameSubmit = (name: string) => {
    setUserName(name);
    localStorage.setItem('dripl_username', name);
  };

  // ── Viewport ─────────────────────────────────────────────────────────────
  const viewport: Viewport = useMemo(
    () => ({
      x: panX,
      y: panY,
      width: containerSize.width,
      height: containerSize.height,
      zoom,
    }),
    [panX, panY, containerSize.width, containerSize.height, zoom]
  );

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
  const { duplicateSelection, copySelectedToClipboard, pasteFromClipboard, findOnCanvas } =
    useCanvasClipboard();

  const { spatialIndex, visibleElements } = useSpatialIndex(elements, viewport);

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

  const getOrderedSpatialCandidates = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }): DriplElement[] =>
      spatialIndex.tree
        .search(bounds)
        .sort((a, b) => (spatialIndex.order.get(b.id) ?? 0) - (spatialIndex.order.get(a.id) ?? 0))
        .map(candidate => spatialIndex.byId.get(candidate.id))
        .filter((element): element is DriplElement => Boolean(element && !element.isDeleted)),
    [spatialIndex]
  );

  const getElementAtPosition = useCallback(
    (x: number, y: number): DriplElement | null => {
      const state = useCanvasStore.getState();
      // Zoom-aware hit threshold: wider tolerance at low zoom, narrower at high zoom
      const hitThreshold = Math.max(2, 8 / state.zoom);
      const candidates = getOrderedSpatialCandidates({
        minX: x - hitThreshold,
        minY: y - hitThreshold,
        maxX: x + hitThreshold,
        maxY: y + hitThreshold,
      });
      for (const element of candidates) {
        // Skip elements locked by other users (collaborative locks)
        if (
          state.elementLocks.has(element.id) &&
          state.elementLocks.get(element.id) !== state.userId
        ) {
          continue;
        }
        // Skip individually locked elements — they should not be selectable
        if (element.locked) continue;
        // Per-element zoom-aware tolerance: thin elements get extra slack at low zoom
        const elThreshold = Math.max((element.strokeWidth ?? 2) / 2 + 0.1, 8 / state.zoom);
        // For unfilled shapes, only test the stroke outline; for filled shapes, test inside + outline
        const hit = shouldTestInside(element)
          ? isPointNearElement({ x, y }, element, elThreshold)
          : isPointOnElementOutline({ x, y }, element, elThreshold);
        if (!hit) continue;
        if (element.type === 'text' && ('boundElementId' in element || 'containerId' in element)) {
          const containerId =
            ('boundElementId' in element ? element.boundElementId : undefined) ??
            ('containerId' in element ? element.containerId : undefined);
          if (containerId) {
            const container = state.elementsById.get(containerId);
            if (
              container &&
              !container.locked &&
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
    [getOrderedSpatialCandidates, isPointNearElement]
  );

  /**
   * Returns ALL elements at a given point, ordered from highest to lowest z-index.
   * Used for overlap resolution (preferSelected, bounding-box tiebreak).
   */
  const getElementsAtPosition = useCallback(
    (x: number, y: number): DriplElement[] => {
      const state = useCanvasStore.getState();
      const hitThreshold = Math.max(2, 8 / state.zoom);
      const candidates = getOrderedSpatialCandidates({
        minX: x - hitThreshold,
        minY: y - hitThreshold,
        maxX: x + hitThreshold,
        maxY: y + hitThreshold,
      });
      const hits: DriplElement[] = [];
      for (const element of candidates) {
        if (
          state.elementLocks.has(element.id) &&
          state.elementLocks.get(element.id) !== state.userId
        ) {
          continue;
        }
        if (element.locked) continue;
        const elThreshold = Math.max((element.strokeWidth ?? 2) / 2 + 0.1, 8 / state.zoom);
        const hit = shouldTestInside(element)
          ? isPointNearElement({ x, y }, element, elThreshold)
          : isPointOnElementOutline({ x, y }, element, elThreshold);
        if (!hit) continue;
        // Skip bound text — hitting text hits the container
        if (element.type === 'text' && ('boundElementId' in element || 'containerId' in element)) {
          continue;
        }
        hits.push(element);
      }
      return hits;
    },
    [getOrderedSpatialCandidates, isPointNearElement]
  );

  const collectCascadeDeleteIdsCallback = useCallback(
    (seedIds: Iterable<string>): string[] => {
      return collectCascadeDeleteIds(seedIds, elements);
    },
    [elements]
  );

  const maybeRevertToSelectTool = useCallback(
    (completedTool: ActiveTool) => {
      if (toolLocked || completedTool === 'laser') return;
      // RULE: Tool Reversion
      setActiveTool('select');
    },
    [setActiveTool, toolLocked]
  );

  const applyFrameGrouping = useCallback(
    (frameElement: DriplElement) => {
      if (readOnly || frameElement.type !== 'frame') return;

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
    [readOnly, setSelectedIds]
  );

  // ── Pointer events hook ──────────────────────────────────────────────────
  const {
    interactionRef,
    lastToolBeforeSpaceRef,
    hoveredBindingId,
    startPointBindingId,
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
    getElementsAtPosition,
    updateElementTransient,
    updateElementsTransient,
    updateElement,
    pushHistory,
    lockElementsForGesture,
    unlockElement,
    unlockGestureElements,
    setEditingElementId,
    startDrawing,
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
      if (readOnly) return;
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

      useCanvasStore.getState().setIsResizing(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      // Capture pointer on the canvas so we still get events outside
      const canvas = containerRef.current?.querySelector(
        'canvas:last-child'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [getCanvasCoordinates, lockElementsForGesture, readOnly, setEditingElementId]
  );

  // ── Rotate start ──────────────────────────────────────────────────────────
  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (readOnly) return;
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

      useCanvasStore.getState().setIsRotating(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      const canvas = containerRef.current?.querySelector(
        'canvas:last-child'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [lockElementsForGesture, readOnly, setEditingElementId]
  );

  useEffect(() => {
    return () => {
      unlockGestureElements();
    };
  }, [unlockGestureElements]);

  const handleTextSubmit = (text: string) => {
    if (readOnly) {
      useCanvasStore.getState().setTextInput(null);
      return;
    }
    if (!textInput || !text.trim()) {
      useCanvasStore.getState().setTextInput(null);
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
      useCanvasStore.getState().setTextInput(null);
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
    useCanvasStore.getState().setTextInput(null);
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
    setTextInput: useCanvasStore.getState().setTextInput as (
      state: { x: number; y: number; id: string; value?: string; existingElementId?: string } | null
    ) => void,
    setDrawingState,
    cancelDrawing,
    collectCascadeDeleteIds: collectCascadeDeleteIdsCallback,
    copySelectedToClipboard,
    pasteFromClipboard,
    duplicateSelection,
    findOnCanvas,
    fitAllToScreen,
  });

  // ── Mouse wheel zoom & momentum ───────────────────────────────────────
  useCanvasWheel({ containerRef, containerReady });

  const collaboratorCursors = collaborators;
  const shouldShowPropertiesPanel = activeTool === 'select' && selectedIds.size > 0; // RULE: Sidebar Visibility
  const primarySelectedElement = useMemo(
    () =>
      selectedIds.size > 0 ? (elements.find(element => selectedIds.has(element.id)) ?? null) : null,
    [elements, selectedIds]
  );

  perfMark('RoughCanvas:render:end');
  perfMeasure('RoughCanvas:render', 'RoughCanvas:render:start', 'RoughCanvas:render:end');

  return (
    <div
      ref={setContainerRef}
      className="canvas-surface relative w-full h-full"
      role="application"
      aria-label="Dripl drawing canvas"
      aria-describedby="dripl-canvas-instructions"
      tabIndex={0}
      onDragOver={handleDragOver}
      onDrop={hookHandleDrop}
      onContextMenu={openContextMenu}
      style={{ backgroundColor: 'var(--color-canvas-bg)' }}
    >
      <p id="dripl-canvas-instructions" className="sr-only">
        Drawing canvas. Choose a tool from the toolbar. Press V for selection, R for a rectangle, or
        H for the hand tool. Hold Space to pan temporarily and press Escape to cancel the current
        gesture.
      </p>
      {roomSlug && (!isConnected || connectionMessage !== 'Connected' || readOnly) && (
        <div
          className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full border border-[#D4D0C9] bg-white/95 px-3 py-1.5 text-xs text-[#6B6860] shadow"
          role="status"
          aria-live="polite"
        >
          {readOnly ? 'View only' : connectionMessage}
        </div>
      )}
      {containerReady && (
        <DualCanvas
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
          elements={elements}
          visibleElements={visibleElements}
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
          hoveredBindingId={hoveredBindingId}
          startPointBindingId={startPointBindingId}
          shouldCacheIgnoreZoom={shouldCacheIgnoreZoom}
          preservePointerSamples={activeTool === 'freedraw' || activeTool === 'eraser'}
        />
      )}

      <LaserCanvas />

      {!readOnly && (
        <MemoizedSelectionOverlay
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

      <MemoizedRemoteCursors />

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

      {shouldShowPropertiesPanel && !readOnly && (
        <div className="absolute top-20 left-4 z-20">
          <Suspense fallback={null}>
            <PropertiesPanel
              selectedElement={primarySelectedElement}
              onUpdateElement={updatedElement => {
                if (updatedElement.id) {
                  updateElement(updatedElement.id, updatedElement);
                }
              }}
              onDuplicateElement={duplicateSelection}
              onDeleteElement={() => {
                const ids = collectCascadeDeleteIdsCallback(
                  Array.from(useCanvasStore.getState().selectedIds)
                );
                deleteElements(ids);
                clearSelection();
              }}
            />
          </Suspense>
        </div>
      )}

      {textInput && !readOnly && (
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
            if (e.key === 'Escape') useCanvasStore.getState().setTextInput(null);
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

      {contextMenuState && !readOnly && (
        <Suspense fallback={null}>
          <ContextMenu
            x={contextMenuState.x}
            y={contextMenuState.y}
            element={elements.find(element => element.id === contextMenuState.elementId) ?? null}
            onClose={() => setContextMenuState(null)}
            onDuplicate={duplicateSelection}
            onDelete={() => {
              const ids = Array.from(useCanvasStore.getState().selectedIds);
              deleteElements(collectCascadeDeleteIdsCallback(ids));
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
