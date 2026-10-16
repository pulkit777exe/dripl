import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import { isPointNearElement } from '@dripl/math/intersection';
import { logError, type DriplElement, type LinearElement } from '@dripl/common';
import { resizeSingleElement } from '@dripl/element/resizeElements';
import { uploadImageToServer, loadImage } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import { calculateArrowBinding } from '@/utils/arrow-routing';
import { buildBoundArrowsByShape, resolveGestureUpdates } from '@/lib/canvas/binding-sync';
import {
  groupResizeMapping,
  groupRotateMapping,
  normalizeRotationDelta,
} from '@/lib/canvas/group-transform';
import { computeRotationAngle } from '@/lib/canvas/rotation';
import {
  computeBoxResize,
  dragLinearPoint,
  insertLinearMidpoint,
  shouldPushHistory,
} from '@/lib/canvas/resize-geometry';
import { handleDoubleClick } from '@/lib/canvas/double-click';
import {
  finalizeDragGesture,
  finalizeResizeGesture,
  finalizeRotateGesture,
} from '@/lib/canvas/gesture-teardown';
import { matchMarqueeElements, normalizeMarquee } from '@/lib/canvas/marquee';
import { dropImageFiles } from '@/lib/canvas/image-drop';
import { pinchDistance, pinchMidpoint, pinchZoomTransform } from '@/lib/canvas/pinch';
import {
  findBindableElementAtPoint,
  bindArrowToElement,
  unbindArrowFromElement,
} from '@/utils/arrow-binding';
import type { ToolType } from '@/hooks/useDrawingTools';
import type { ToolStartOptions, ToolUpdateOptions } from '@/lib/draw/tool-state';

/**
 * Screen-space press-then-move threshold before a press becomes a drag or a
 * marquee. Below it the gesture is a click: selection still applies on
 * pointer-down, but nothing else arms.
 */
export const CLICK_DRAG_THRESHOLD_PX = 4;

export function clickDragThresholdWorld(zoom: number): number {
  return CLICK_DRAG_THRESHOLD_PX / Math.max(zoom, 0.1);
}

export interface InteractionState {
  panning: boolean;
  panStartClient: { x: number; y: number } | null;
  isSpacePressed: boolean;
  dragStartCanvasPos: { x: number; y: number } | null;
  dragInitialElements: Map<string, DriplElement> | null;
  dragging: boolean;
  /**
   * Press recorded but not yet a drag: selection is applied on pointer-down,
   * but locks, history and `isDragging` wait until the pointer travels past
   * CLICK_DRAG_THRESHOLD_PX (screen). A plain click therefore never churns
   * collaboration locks or writes an undo step.
   */
  pendingDrag: {
    startPos: { x: number; y: number };
    snapshot: Map<string, DriplElement>;
  } | null;
  /** Empty-press recorded but not yet a marquee (same threshold gating). */
  pendingMarqueeStart: { x: number; y: number } | null;
  historyPushed: boolean;
  resizing: boolean;
  resizeHandle: string | null;
  resizeStartCanvasPos: { x: number; y: number } | null;
  resizeInitialEl: DriplElement | null;
  /** Multi-selection resize baseline: one frozen clone per selected element. */
  resizeInitialEls: Map<string, DriplElement> | null;
  /** Union frame of the multi-selection at gesture start. */
  resizeGroupFrame: { x: number; y: number; width: number; height: number } | null;
  rotating: boolean;
  rotateInitialEl: DriplElement | null;
  /** Multi-selection rotate baseline + center/angle at gesture start. */
  rotateInitialEls: Map<string, DriplElement> | null;
  rotateCenter: { x: number; y: number } | null;
  rotateStartAngle: number;
  touchPointers: Map<number, { x: number; y: number }>;
  pinchStartDistance: number;
  pinchStartMid: { x: number; y: number } | null;
  pinchStartZoom: number;
  pinchStartPan: { x: number; y: number };
  boundArrowsByShape: Map<string, Set<string>>;
  bindingIndexReady: boolean;
}

interface CanvasPointerEventsProps {
  readOnly: boolean;
  /** Container for client→canvas offsetting (pinch anchor, like the wheel path). */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  getCanvasCoordinates: (e: React.PointerEvent | React.DragEvent) => { x: number; y: number };
  snapPointToGrid: (point: { x: number; y: number }) => { x: number; y: number };
  broadcastCursor: (x: number, y: number) => void;
  addElement: (element: DriplElement) => void;
  getElementAtPosition: (x: number, y: number) => DriplElement | null | undefined;
  getElementsAtPosition: (x: number, y: number) => DriplElement[];
  updateElementTransient: (id: string, element: DriplElement) => void;
  updateElementsTransient: (updates: ReadonlyMap<string, Partial<DriplElement>>) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  pushHistory: () => void;
  lockElementsForGesture: (ids: Iterable<string>) => void;
  unlockElement: (id: string) => void;
  unlockGestureElements: () => void;
  setEditingElementId: (id: string | null) => void;
  startDrawing: (
    point: { x: number; y: number },
    tool: ToolType,
    options: ToolStartOptions,
    baseProps: {
      strokeColor: string;
      backgroundColor: string;
      strokeWidth: number;
      opacity: number;
      roughness: number;
      strokeStyle: 'solid' | 'dashed' | 'dotted';
      fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
      arrowStyle?: 'straight' | 'curved' | 'elbow';
    },
    elements?: DriplElement[]
  ) => void;
  updateDrawing: (
    point: { x: number; y: number },
    options: ToolUpdateOptions,
    elements: DriplElement[]
  ) => void;
  setDrawingState: (drawing: boolean) => void;
  maybeRevertToSelectTool: (tool: ActiveTool) => void;
  finishDrawing: () => DriplElement | null;
  cancelDrawing: () => void;
  applyFrameGrouping: (frameElement: DriplElement) => void;
  spatialIndex: {
    tree: {
      search: (bbox: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      }) => Array<{ id: string }>;
    };
    byId: Map<string, DriplElement>;
  };
}

export function useCanvasPointerEvents({
  readOnly,
  containerRef,
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
  maybeRevertToSelectTool,
  finishDrawing,
  cancelDrawing,
  applyFrameGrouping,
  spatialIndex,
}: CanvasPointerEventsProps) {
  const interactionRef = useRef<InteractionState>({
    panning: false,
    panStartClient: null,
    isSpacePressed: false,
    dragStartCanvasPos: null,
    dragInitialElements: null,
    dragging: false,
    pendingDrag: null,
    pendingMarqueeStart: null,
    historyPushed: false,
    resizing: false,
    resizeHandle: null,
    resizeStartCanvasPos: null,
    resizeInitialEl: null,
    resizeInitialEls: null,
    resizeGroupFrame: null,
    rotating: false,
    rotateInitialEl: null,
    rotateInitialEls: null,
    rotateCenter: null,
    rotateStartAngle: 0,
    touchPointers: new Map(),
    pinchStartDistance: 0,
    pinchStartMid: null,
    pinchStartZoom: 1,
    pinchStartPan: { x: 0, y: 0 },
    boundArrowsByShape: new Map(),
    bindingIndexReady: false,
  });

  const lastToolBeforeSpaceRef = useRef<string | null>(null);
  const eraserHitIdsRef = useRef<Set<string>>(new Set());
  const hoveredBindingIdRef = useRef<string | null>(null);
  const startPointBindingIdRef = useRef<string | null>(null);
  const [hoveredBindingId, setHoveredBindingId] = useState<string | null>(null);
  const [startPointBindingId, setStartPointBindingId] = useState<string | null>(null);
  const [bindMode] = useState<'orbit' | 'inside'>('orbit');

  // Helper to update both ref and state for hoveredBindingId
  const updateHoveredBindingId = useCallback((id: string | null) => {
    hoveredBindingIdRef.current = id;
    setHoveredBindingId(id);
  }, []);

  // Helper to update both ref and state for startPointBindingId
  const updateStartPointBindingId = useCallback((id: string | null) => {
    startPointBindingIdRef.current = id;
    setStartPointBindingId(id);
  }, []);

  // Eraser samples accumulate here until the trailing-edge flush appends the
  // frame's batch in a single store commit (see the eraser branch of
  // handlePointerMove). Eraser input preserves every coalesced sample, so a
  // frame can carry several; committing each one re-rendered the canvas
  // subtree per sample for a single visible frame.
  const eraserPendingRef = useRef<Array<{ x: number; y: number }>>([]);
  const eraserFlushRef = useRef<number | null>(null);
  // One undo step per stroke: pushed at the first batch that actually hits,
  // so a stroke that erases nothing writes no history at all.
  const eraserHistoryPushedRef = useRef(false);

  const flushEraserAccumulator = useCallback(() => {
    if (eraserFlushRef.current !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(eraserFlushRef.current);
      }
      eraserFlushRef.current = null;
    }
    const batch = eraserPendingRef.current;
    if (batch.length === 0) return;
    eraserPendingRef.current = [];
    useCanvasStore.getState().setEraserPath(prev => [...prev, ...batch]);
    const state = useCanvasStore.getState();
    // Screen-space constant radius: a fixed world radius is a 2px needle at
    // zoom 0.1 and an 80px bomb at zoom 4 (Excalidraw parity).
    const radius = 20 / Math.max(state.zoom, 0.1);
    for (const point of batch) {
      const candidates = spatialIndex.tree.search({
        minX: point.x - radius,
        minY: point.y - radius,
        maxX: point.x + radius,
        maxY: point.y + radius,
      });
      candidates.forEach(candidate => {
        const element = spatialIndex.byId.get(candidate.id);
        if (!element) return;
        const lockOwner = state.elementLocks.get(element.id);
        if (lockOwner && lockOwner !== state.userId) return;
        if (isPointNearElement(point, element, radius)) {
          eraserHitIdsRef.current.add(element.id);
        }
      });
    }
    // Delete on contact, not on release (Excalidraw parity): the stroke
    // erases as it touches. History is pushed once at the first hitting
    // batch and each batch deletes with skipHistory, so the whole stroke
    // stays one undo step — and a stroke that hits nothing writes none.
    if (eraserHitIdsRef.current.size > 0) {
      const live = useCanvasStore.getState();
      if (!eraserHistoryPushedRef.current) {
        live.pushHistory();
        eraserHistoryPushedRef.current = true;
      }
      const doomed = live.collectCascadeDeleteIds(eraserHitIdsRef.current);
      eraserHitIdsRef.current.clear();
      if (doomed.length > 0) live.deleteElements(doomed, { skipHistory: true });
    }
  }, [spatialIndex]);

  const scheduleEraserFlush = useCallback(() => {
    if (eraserFlushRef.current !== null) return;
    // No frame source: apply inline, which is exactly the pre-batching
    // behavior for environments without animation frames.
    if (typeof requestAnimationFrame === 'undefined') {
      flushEraserAccumulator();
      return;
    }
    eraserFlushRef.current = requestAnimationFrame(() => {
      eraserFlushRef.current = null;
      flushEraserAccumulator();
    });
  }, [flushEraserAccumulator]);

  useEffect(
    () => () => {
      if (eraserFlushRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(eraserFlushRef.current);
      }
    },
    []
  );

  // Pinch midpoints arrive in client pixels but the zoom transform works in
  // container pixels (pan is container-relative). The wheel path subtracts
  // getBoundingClientRect for the same reason; without it the anchor is off
  // by the toolbar/sidebar offset whenever the container isn't at the origin.
  const toContainerPoint = useCallback(
    (client: { x: number; y: number }): { x: number; y: number } => {
      const rect = containerRef?.current?.getBoundingClientRect();
      if (!rect) return { x: client.x, y: client.y };
      return { x: client.x - rect.left, y: client.y - rect.top };
    },
    [containerRef]
  );

  const getGestureBoundArrows = useCallback((): ReadonlyMap<string, ReadonlySet<string>> => {
    if (!interactionRef.current.bindingIndexReady) {
      interactionRef.current.boundArrowsByShape.clear();
      const nextIndex = buildBoundArrowsByShape(useCanvasStore.getState().elements);
      interactionRef.current.boundArrowsByShape = nextIndex;
      interactionRef.current.bindingIndexReady = true;
    }
    return interactionRef.current.boundArrowsByShape;
  }, []);

  const {
    setSelectedIds,
    setIsDragging,
    setIsPanning,
    setIsResizing,
    setIsRotating,
    setTextInput,
    setCursorPosition,
    setMarqueeSelection,
    setIsDrawing,
    setEraserPath,
    expandSelectionWithGroups,
    getSelectionBounds,
    setActiveTool,
  } = useCanvasStore(
    useShallow(state => ({
      setSelectedIds: state.setSelectedIds,
      setIsDragging: state.setIsDragging,
      setIsPanning: state.setIsPanning,
      setIsResizing: state.setIsResizing,
      setIsRotating: state.setIsRotating,
      setTextInput: state.setTextInput,
      setCursorPosition: state.setCursorPosition,
      setMarqueeSelection: state.setMarqueeSelection,
      setIsDrawing: state.setIsDrawing,
      setEraserPath: state.setEraserPath,
      expandSelectionWithGroups: state.expandSelectionWithGroups,
      getSelectionBounds: state.getSelectionBounds,
      setActiveTool: state.setActiveTool,
    }))
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!readOnly) e.preventDefault();
    },
    [readOnly]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const { x, y } = getCanvasCoordinates(e);
      const files = Array.from(e.dataTransfer.files);

      await dropImageFiles(
        files,
        { x, y },
        {
          uploadImage: uploadImageToServer,
          loadImageDims: loadImage,
          makeId: uuidv4,
          onElement: addElement,
          onError: error => {
            // The `try` spans both the upload and the decode, so this prefix has
            // to cover both. It used to say "Failed to upload image", which is
            // wrong for the common case: a decode failure happens *after* a
            // successful upload, and the line then read "Failed to upload image:
            // Failed to decode image: ...".
            logError('Failed to add image to canvas:', error);
          },
        }
      );
    },
    [addElement, getCanvasCoordinates, readOnly]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('pointer-events-auto')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      interactionRef.current.boundArrowsByShape.clear();
      interactionRef.current.bindingIndexReady = false;

      if (e.pointerType === 'touch') {
        interactionRef.current.touchPointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
        if (interactionRef.current.touchPointers.size === 2) {
          // A second finger preempts any pending press: the gesture is a
          // pinch now, not a drag or marquee in waiting.
          interactionRef.current.pendingDrag = null;
          interactionRef.current.pendingMarqueeStart = null;
          const points = Array.from(interactionRef.current.touchPointers.values());
          const first = points[0];
          const second = points[1];
          if (first && second) {
            interactionRef.current.pinchStartDistance = pinchDistance(first, second);
            interactionRef.current.pinchStartMid = toContainerPoint(pinchMidpoint(first, second));
            const state = useCanvasStore.getState();
            interactionRef.current.pinchStartZoom = state.zoom;
            interactionRef.current.pinchStartPan = {
              x: state.panX,
              y: state.panY,
            };
            interactionRef.current.panning = true;
            setIsPanning(true);
          }
        }
      }

      const rawPoint = getCanvasCoordinates(e);
      const point = snapPointToGrid(rawPoint);
      const { x, y } = point;
      const currentTool = useCanvasStore.getState().activeTool;

      broadcastCursor(x, y);

      const isTemporaryPan = interactionRef.current.isSpacePressed || e.button === 1;
      if (currentTool === 'hand' || isTemporaryPan) {
        e.preventDefault();
        // The tool itself never changes for a temporary pan (Space or middle
        // button), so there is nothing to restore — the flag alone drives it.
        // Recording the tool here would leave a stale restore behind.
        lastToolBeforeSpaceRef.current = null;
        interactionRef.current.panning = true;
        interactionRef.current.panStartClient = { x: e.clientX, y: e.clientY };
        setIsPanning(true);
        return;
      }

      if (currentTool === 'laser') {
        setIsDrawing(true);
        window.dispatchEvent(new CustomEvent('dripl:laser-start', { detail: { x, y } }));
        return;
      }

      if (readOnly) {
        return;
      }

      if (currentTool === 'select') {
        if (e.detail === 2) {
          if (
            handleDoubleClick({ x, y }, useCanvasStore.getState().elements, {
              getElementAtPosition,
              setTextInput,
              addElement,
              updateElement,
            })
          ) {
            return;
          }
        }

        // Get all elements at this point for overlap resolution
        const allHitElements = getElementsAtPosition(x, y);
        // `getElementsAtPosition` returns hits from top z-order to bottom.
        // Prefer an already-selected hit so a selected object can be dragged
        // through an overlapping object; otherwise select the first (topmost)
        // hit rather than the bottom-most one.
        let element: DriplElement | null = null;
        if (allHitElements.length > 0) {
          const state = useCanvasStore.getState();
          const selectedHit = allHitElements.find(el => state.selectedIds.has(el.id));
          element = selectedHit ?? allHitElements[0]!;
        }
        if (element && element.id) {
          const state = useCanvasStore.getState();
          const clickedSet = expandSelectionWithGroups(new Set([element.id]), state.elements);
          const nextSelection = e.shiftKey
            ? expandSelectionWithGroups(
                new Set([...state.selectedIds, ...clickedSet]),
                state.elements
              )
            : clickedSet;
          setSelectedIds(nextSelection);

          const idsToTrack = nextSelection;

          const snapshot = new Map<string, DriplElement>();
          state.elements.forEach(el => {
            if (idsToTrack.has(el.id)) snapshot.set(el.id, JSON.parse(JSON.stringify(el)));
          });

          // Record the press; the drag (locks, history, isDragging) arms on
          // the first supra-threshold move, so a click never churns them.
          interactionRef.current.pendingDrag = { startPos: { x, y }, snapshot };
          interactionRef.current.pendingMarqueeStart = null;
        } else {
          const state = useCanvasStore.getState();
          const selectionBounds = getSelectionBounds(state.selectedIds, state.elements);
          if (
            selectionBounds &&
            x >= selectionBounds.minX &&
            x <= selectionBounds.maxX &&
            y >= selectionBounds.minY &&
            y <= selectionBounds.maxY
          ) {
            const snapshot = new Map<string, DriplElement>();
            state.elements.forEach(candidate => {
              if (!state.selectedIds.has(candidate.id)) return;
              const lockOwner = state.elementLocks.get(candidate.id);
              if (lockOwner && lockOwner !== state.userId) return;
              snapshot.set(candidate.id, JSON.parse(JSON.stringify(candidate)));
            });

            if (snapshot.size > 0) {
              interactionRef.current.pendingDrag = { startPos: { x, y }, snapshot };
              interactionRef.current.pendingMarqueeStart = null;
              return;
            }
          }

          if (!e.shiftKey) {
            useCanvasStore.getState().clearSelection();
          }
          interactionRef.current.pendingDrag = null;
          interactionRef.current.pendingMarqueeStart = { x, y };
        }
        return;
      }

      if (currentTool === 'text') {
        setTextInput({ x, y, id: uuidv4(), value: '' });
        return;
      }

      if (currentTool === 'image') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async event => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (file) {
            try {
              const imageUrl = await uploadImageToServer(file);
              const dims = await loadImage(imageUrl, 500);
              const element: DriplElement = {
                id: uuidv4(),
                type: 'image',
                x: x - dims.displayWidth / 2,
                y: y - dims.displayHeight / 2,
                width: dims.displayWidth,
                height: dims.displayHeight,
                strokeColor: 'transparent',
                backgroundColor: 'transparent',
                strokeWidth: 0,
                opacity: 1,
                src: imageUrl,
              };
              addElement(element);
              if (useCanvasStore.getState().activeTool === 'image') {
                maybeRevertToSelectTool('image');
              }
            } catch (error) {
              logError('Failed to upload image:', error);
            }
          }
        };
        input.click();
        return;
      }

      if (currentTool === 'eraser') {
        setIsDrawing(true);
        eraserHitIdsRef.current.clear();
        eraserHistoryPushedRef.current = false;
        // Drop a batch stranded by an interrupted stroke; flushing here would
        // append stale points ahead of the new stroke.
        if (eraserFlushRef.current !== null) {
          if (typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(eraserFlushRef.current);
          }
          eraserFlushRef.current = null;
        }
        eraserPendingRef.current = [];
        setEraserPath([{ x, y }]);
        return;
      }

      if (
        currentTool === 'rectangle' ||
        currentTool === 'ellipse' ||
        currentTool === 'diamond' ||
        currentTool === 'arrow' ||
        currentTool === 'line' ||
        currentTool === 'freedraw' ||
        currentTool === 'frame' ||
        currentTool === 'embed'
      ) {
        const state = useCanvasStore.getState();
        startDrawing(
          { x, y },
          currentTool,
          {
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            pressure: e.pressure,
            pointerType: e.pointerType,
          },
          {
            strokeColor: state.currentStrokeColor,
            backgroundColor: state.currentBackgroundColor,
            strokeWidth: state.currentStrokeWidth,
            opacity: 1,
            roughness: state.currentRoughness,
            strokeStyle: state.currentStrokeStyle,
            fillStyle: state.currentFillStyle,
            arrowStyle: state.currentArrowStyle,
          },
          state.elements
        );
        setIsDrawing(true);
        return;
      }
    },
    [
      readOnly,
      getCanvasCoordinates,
      snapPointToGrid,
      broadcastCursor,
      getElementAtPosition,
      setSelectedIds,
      expandSelectionWithGroups,
      getSelectionBounds,
      setIsDragging,
      setIsPanning,
      setEditingElementId,
      lockElementsForGesture,
      setTextInput,
      setMarqueeSelection,
      addElement,
      startDrawing,
      setIsDrawing,
      setEraserPath,
      maybeRevertToSelectTool,
      pushHistory,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoordinates(e);
      const currentTool = useCanvasStore.getState().activeTool;

      if (e.pointerType === 'touch' && interactionRef.current.touchPointers.has(e.pointerId)) {
        interactionRef.current.touchPointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });

        if (
          interactionRef.current.touchPointers.size === 2 &&
          interactionRef.current.pinchStartMid
        ) {
          const points = Array.from(interactionRef.current.touchPointers.values());
          const first = points[0];
          const second = points[1];
          if (first && second) {
            const mid = toContainerPoint(pinchMidpoint(first, second));
            const { zoom, panX, panY } = pinchZoomTransform(
              {
                mid: interactionRef.current.pinchStartMid,
                zoom: interactionRef.current.pinchStartZoom,
                pan: interactionRef.current.pinchStartPan,
                distance: interactionRef.current.pinchStartDistance,
              },
              mid,
              pinchDistance(first, second)
            );

            useCanvasStore.getState().setViewport(zoom, panX, panY);
            return;
          }
        }
      }

      setCursorPosition({ x, y });
      broadcastCursor(x, y);

      if (interactionRef.current.panning && interactionRef.current.panStartClient) {
        const dx = e.clientX - interactionRef.current.panStartClient.x;
        const dy = e.clientY - interactionRef.current.panStartClient.y;
        const state = useCanvasStore.getState();
        useCanvasStore.getState().setPan(state.panX + dx, state.panY + dy);
        interactionRef.current.panStartClient = { x: e.clientX, y: e.clientY };
        return;
      }

      const state = useCanvasStore.getState();
      if (state.marqueeSelection?.active) {
        useCanvasStore.getState().setMarqueeSelection({ ...state.marqueeSelection, end: { x, y } });
        return;
      }

      // Arm a pending press once it travels past the click threshold. Locks,
      // history and isDragging all start here — never on pointer-down — so a
      // click is side-effect-free beyond the selection itself.
      const pendingDrag = interactionRef.current.pendingDrag;
      if (pendingDrag && !interactionRef.current.dragging) {
        const threshold = clickDragThresholdWorld(useCanvasStore.getState().zoom);
        if (Math.hypot(x - pendingDrag.startPos.x, y - pendingDrag.startPos.y) >= threshold) {
          interactionRef.current.dragging = true;
          interactionRef.current.historyPushed = false;
          interactionRef.current.dragStartCanvasPos = pendingDrag.startPos;
          interactionRef.current.dragInitialElements = pendingDrag.snapshot;
          interactionRef.current.pendingDrag = null;
          setIsDragging(true);
          const ids = Array.from(pendingDrag.snapshot.keys());
          setEditingElementId(ids.length === 1 ? (ids[0] ?? null) : null);
          if (ids.length > 0) lockElementsForGesture(pendingDrag.snapshot.keys());
        }
      }

      const pendingMarquee = interactionRef.current.pendingMarqueeStart;
      if (pendingMarquee) {
        const threshold = clickDragThresholdWorld(useCanvasStore.getState().zoom);
        if (Math.hypot(x - pendingMarquee.x, y - pendingMarquee.y) >= threshold) {
          interactionRef.current.pendingMarqueeStart = null;
          setMarqueeSelection({ start: pendingMarquee, end: { x, y }, active: true });
        }
      }

      if (currentTool === 'laser' && useCanvasStore.getState().isDrawing) {
        window.dispatchEvent(new CustomEvent('dripl:laser-move', { detail: { x, y } }));
        return;
      }

      if (readOnly) return;

      if (
        interactionRef.current.resizing &&
        interactionRef.current.resizeInitialEls &&
        interactionRef.current.resizeGroupFrame &&
        interactionRef.current.resizeStartCanvasPos
      ) {
        const dx = x - interactionRef.current.resizeStartCanvasPos.x;
        const dy = y - interactionRef.current.resizeStartCanvasPos.y;
        if (shouldPushHistory(interactionRef.current.historyPushed, dx, dy)) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }
        const updates = groupResizeMapping(
          interactionRef.current.resizeInitialEls,
          interactionRef.current.resizeGroupFrame,
          interactionRef.current.resizeHandle ?? 'se',
          dx,
          dy,
          { shiftKey: e.shiftKey, altKey: e.altKey }
        );
        // Bound arrows outside the selection follow via the gesture index,
        // exactly like the single-element path.
        updateElementsTransient(
          resolveGestureUpdates(
            useCanvasStore.getState().elementsById,
            updates,
            getGestureBoundArrows()
          )
        );
        return;
      }

      if (
        interactionRef.current.resizing &&
        interactionRef.current.resizeInitialEl &&
        interactionRef.current.resizeStartCanvasPos
      ) {
        const el = interactionRef.current.resizeInitialEl;
        const handle = interactionRef.current.resizeHandle!;
        const dx = x - interactionRef.current.resizeStartCanvasPos.x;
        const dy = y - interactionRef.current.resizeStartCanvasPos.y;
        if (shouldPushHistory(interactionRef.current.historyPushed, dx, dy)) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }

        const isArrowEndpoint = handle === 'arrow-start' || handle === 'arrow-end';
        const arrowPointMatch =
          typeof handle === 'string' && handle.startsWith('arrow-point-')
            ? parseInt(handle.slice('arrow-point-'.length), 10)
            : -1;
        const arrowInsertMatch =
          typeof handle === 'string' && handle.startsWith('arrow-insert-')
            ? parseInt(handle.slice('arrow-insert-'.length), 10)
            : -1;

        // Handle midpoint insertion - insert a new point at the midpoint of the segment
        if (arrowInsertMatch >= 0) {
          const updatedElement = insertLinearMidpoint(el, arrowInsertMatch);
          if (!updatedElement) return;

          if (el.id) updateElementTransient(el.id, updatedElement);

          // Set up for dragging the newly inserted point
          interactionRef.current.resizeHandle = `arrow-point-${arrowInsertMatch}` as string;
          interactionRef.current.resizeInitialEl = updatedElement;
          interactionRef.current.resizeStartCanvasPos = { x, y };
          interactionRef.current.historyPushed = true;
          return;
        }

        if (isArrowEndpoint || arrowPointMatch >= 0) {
          // Point count validation lives in dragLinearPoint (null → return).
          const pointCount =
            'points' in el && Array.isArray((el as { points?: unknown }).points)
              ? (el as { points: unknown[] }).points.length
              : 0;
          const idx =
            handle === 'arrow-start'
              ? 0
              : handle === 'arrow-end'
                ? pointCount - 1
                : arrowPointMatch;
          const dragged = dragLinearPoint(el, idx, dx, dy);
          if (!dragged) return;
          const target = dragged.movedPoint;
          let updatedElement: DriplElement = dragged.element;

          // Dynamic binding detection for arrow endpoints
          const allElements = useCanvasStore.getState().elements;
          const arrowEl = updatedElement as LinearElement;
          const startOrEnd =
            handle === 'arrow-start' ? 'start' : handle === 'arrow-end' ? 'end' : null;

          /**
           * Apply the shape-side half of a bind or unbind.
           *
           * `bindArrowToElement` / `unbindArrowFromElement` return a whole element list
           * because they update two rows: the arrow, and the target's `boundElements`
           * reverse index. Taking only the arrow out of that list — which is what this
           * handler used to do — silently dropped the target's half, and since
           * `buildBoundArrowsByShape` is what `updateBoundArrows` reads when a *shape*
           * later moves, an arrow bound by dragging an endpoint never followed the shape.
           * Only `finishDrawing` -> `bindCommittedArrow` populated it, so only a *drawn*
           * arrow behaved.
           *
           * Applied transiently, like the arrow itself: this is pointer-move feedback, not
           * a commit.
           */
          const applyShapeSideBindingUpdates = (
            before: readonly DriplElement[],
            after: readonly DriplElement[],
            excludeId: string
          ): void => {
            const previous = new Map(before.map(e => [e.id, e]));
            const updates = new Map<string, Partial<DriplElement>>();
            for (const element of after) {
              if (element.id === excludeId) continue;
              if (previous.get(element.id) === element) continue;
              updates.set(element.id, element);
            }
            if (updates.size > 0) updateElementsTransient(updates);
          };

          if (startOrEnd) {
            // Geometry comes from `arrowEl`, which derives from the gesture-start
            // snapshot on purpose, so repeated moves cannot accumulate drift. A
            // *binding*, though, is state this very gesture mutates — and the
            // snapshot never learns about one written on the previous move.
            //
            // Reading `currentBinding` from the snapshot therefore made it
            // permanently the pre-gesture value: after one move bound the endpoint
            // to a shape, the next move still saw no binding, so the unbind branch
            // below could never fire and dragging away left the arrow stuck to the
            // shape until the pointer was released. Composing the dragged geometry
            // with the live binding state fixes that without giving up the
            // snapshot the geometry depends on.
            const liveArrow = allElements.find(e => e.id === el.id) as LinearElement | undefined;
            const arrowWithLiveBinding = {
              ...arrowEl,
              startBinding: liveArrow?.startBinding ?? arrowEl.startBinding,
              endBinding: liveArrow?.endBinding ?? arrowEl.endBinding,
            } as LinearElement;
            const currentBinding =
              startOrEnd === 'start'
                ? arrowWithLiveBinding.startBinding
                : arrowWithLiveBinding.endBinding;
            const nearbyShape = findBindableElementAtPoint(target, allElements, el.id, 20);

            if (nearbyShape) {
              // Bind to the nearby shape
              updateHoveredBindingId(nearbyShape.id);
              if (!currentBinding || currentBinding.elementId !== nearbyShape.id) {
                // Unbind from current target if different
                let newElements = currentBinding
                  ? unbindArrowFromElement(arrowWithLiveBinding, startOrEnd, allElements)
                  : allElements;
                // Bind to new target
                const binding = calculateArrowBinding(target, nearbyShape);
                if (binding) {
                  newElements = bindArrowToElement(
                    arrowWithLiveBinding,
                    nearbyShape.id,
                    startOrEnd,
                    { x: binding.focus, y: 0.5 },
                    'orbit',
                    newElements
                  );
                  // Update the arrow in the store, and the target's reverse
                  // index with it -- see applyShapeSideBindingUpdates.
                  const boundArrow = newElements.find(e => e.id === el.id) as LinearElement;
                  if (boundArrow) {
                    updatedElement = boundArrow;
                    applyShapeSideBindingUpdates(allElements, newElements, el.id);
                  }
                }
              }
            } else {
              // No nearby shape - unbind if currently bound
              updateHoveredBindingId(null);
              if (currentBinding) {
                const newElements = unbindArrowFromElement(
                  arrowWithLiveBinding,
                  startOrEnd,
                  allElements
                );
                applyShapeSideBindingUpdates(allElements, newElements, el.id);
                const unboundArrow = newElements.find(e => e.id === el.id) as LinearElement;
                if (unboundArrow) {
                  updatedElement = unboundArrow;
                }
              }
            }
          }

          if (el.id) updateElementTransient(el.id, updatedElement);
          return;
        }

        const storeState = useCanvasStore.getState();
        const frame = computeBoxResize(el, handle, dx, dy, {
          shiftKey: e.shiftKey,
          gridEnabled: storeState.gridEnabled,
          gridSize: storeState.gridSize,
          snapPoint: snapPointToGrid,
        });
        let newX = frame.x;
        let newY = frame.y;
        const newWidth = frame.width;
        const newHeight = frame.height;

        const origEl = interactionRef.current.resizeInitialEl || el;
        const resizeHandle = handle as 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
        const resizeFlags = {
          shouldMaintainAspectRatio: e.shiftKey,
          shouldResizeFromCenter: e.altKey,
        };

        // Rotation-aware origin and point mapping live in @dripl/element.
        // For unrotated shapes the package origin coincides with the
        // axis-aligned computation above, so only rotated shapes take the
        // package origin. Linear/freedraw points always come from the package,
        // scaled once from the gesture-start snapshot instead of
        // re-scaling transient points on every move.
        // An axis-aligned linear -- a perfectly horizontal or vertical arrow, which
        // is exactly what a shift-snapped drag produces and what `commitDraft` does
        // not clamp -- has one zero extent. Excluding those here meant the points
        // branch below never ran for them: `width`/`height` were still written onto
        // `updatedElement`, but the path was not, and since a linear element's
        // rendered bounds come from its points the frame snapped straight back and
        // the drag read as inert.
        //
        // No non-zero guard is needed here. `resizeSingleLinearElement` already
        // treats a zero extent as "do not scale this axis"
        // (`prevWidth === 0 ? 1 : nextWidth / prevWidth`), which is the correct
        // reading: a horizontal arrow scales along x and keeps its y.
        const isLinearElement =
          (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') &&
          el.points &&
          el.points.length > 0;
        let packageResize: Partial<DriplElement> | null = null;
        if (el.type !== 'text') {
          packageResize = resizeSingleElement(
            newWidth,
            newHeight,
            el,
            origEl,
            resizeHandle,
            resizeFlags
          );
          if ((el.angle || 0) !== 0) {
            if (typeof packageResize.x === 'number') newX = packageResize.x;
            if (typeof packageResize.y === 'number') newY = packageResize.y;
          }
        }

        const updatedElement: DriplElement = {
          ...el,
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        };

        if (el.type === 'text') {
          const resizedProps = resizeSingleElement(
            newWidth,
            newHeight,
            el,
            interactionRef.current.resizeInitialEl || el,
            handle as 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw',
            { shouldMaintainAspectRatio: e.shiftKey, shouldResizeFromCenter: e.altKey }
          );
          Object.assign(updatedElement, resizedProps);
        } else if (isLinearElement && packageResize?.points) {
          updatedElement.points = packageResize.points;
        }

        if (el.id) {
          // Primary plus binding follow-ups in one commit, as the drag path.
          updateElementsTransient(
            resolveGestureUpdates(
              useCanvasStore.getState().elementsById,
              new Map([[el.id, updatedElement]]),
              getGestureBoundArrows()
            )
          );
        }
        return;
      }

      if (
        interactionRef.current.rotating &&
        interactionRef.current.rotateInitialEls &&
        interactionRef.current.rotateCenter
      ) {
        const center = interactionRef.current.rotateCenter;
        const pointerAngle = Math.atan2(y - center.y, x - center.x);
        // Snap the relative delta (the single path snaps the absolute angle;
        // groups have no absolute angle, only this delta).
        const rawDelta = normalizeRotationDelta(
          pointerAngle - interactionRef.current.rotateStartAngle
        );
        const delta = e.shiftKey
          ? Math.round(rawDelta / (Math.PI / 12)) * (Math.PI / 12)
          : rawDelta;
        if (!interactionRef.current.historyPushed) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }
        updateElementsTransient(
          resolveGestureUpdates(
            useCanvasStore.getState().elementsById,
            groupRotateMapping(interactionRef.current.rotateInitialEls, center, delta),
            getGestureBoundArrows(),
            { includeBoundArrows: false }
          )
        );
        return;
      }

      if (interactionRef.current.rotating && interactionRef.current.rotateInitialEl) {
        const el = interactionRef.current.rotateInitialEl;
        // Shift snaps to 15° increments (Excalidraw parity).
        const rawAngle = computeRotationAngle(el, x, y);
        const angle = e.shiftKey
          ? Math.round(rawAngle / (Math.PI / 12)) * (Math.PI / 12)
          : rawAngle;
        if (!interactionRef.current.historyPushed) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }
        const updatedElement: DriplElement = { ...el, angle };
        if (el.id) {
          // Labels only: rebinding arrow endpoints mid-rotate would be a
          // behavior change of its own, not batching.
          updateElementsTransient(
            resolveGestureUpdates(
              useCanvasStore.getState().elementsById,
              new Map([[el.id, updatedElement]]),
              getGestureBoundArrows(),
              { includeBoundArrows: false }
            )
          );
        }
        return;
      }

      if (
        interactionRef.current.dragging &&
        interactionRef.current.dragInitialElements &&
        interactionRef.current.dragStartCanvasPos
      ) {
        const totalDeltaX = x - interactionRef.current.dragStartCanvasPos.x;
        const totalDeltaY = y - interactionRef.current.dragStartCanvasPos.y;

        if (shouldPushHistory(interactionRef.current.historyPushed, totalDeltaX, totalDeltaY)) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }

        // Shift constrains the move to the dominant axis (Excalidraw parity).
        const moveX = e.shiftKey && Math.abs(totalDeltaY) > Math.abs(totalDeltaX) ? 0 : totalDeltaX;
        const moveY =
          e.shiftKey && Math.abs(totalDeltaX) >= Math.abs(totalDeltaY) ? 0 : totalDeltaY;

        const primaryUpdates = new Map<string, Partial<DriplElement>>();
        interactionRef.current.dragInitialElements.forEach((initialEl, id) => {
          const updatedEl: DriplElement = {
            ...initialEl,
            x: initialEl.x + moveX,
            y: initialEl.y + moveY,
          };

          primaryUpdates.set(id, updatedEl);
        });
        // Primary geometry plus binding follow-ups (bound arrows, labels) in
        // one commit: two commits re-render the canvas subtree twice per frame
        // for a single visible frame.
        updateElementsTransient(
          resolveGestureUpdates(
            useCanvasStore.getState().elementsById,
            primaryUpdates,
            getGestureBoundArrows()
          )
        );

        return;
      }

      if (!useCanvasStore.getState().isDrawing) return;

      if (currentTool === 'eraser') {
        // Accumulate the sample; the scheduled flush appends the frame's
        // batch in one commit (see flushEraserAccumulator).
        eraserPendingRef.current.push({ x, y });
        scheduleEraserFlush();
        return;
      }

      if (
        currentTool === 'rectangle' ||
        currentTool === 'ellipse' ||
        currentTool === 'diamond' ||
        currentTool === 'arrow' ||
        currentTool === 'line' ||
        currentTool === 'freedraw' ||
        currentTool === 'frame' ||
        currentTool === 'embed'
      ) {
        const snapped = snapPointToGrid({ x, y });
        updateDrawing(
          snapped,
          {
            shiftKey: e.shiftKey || false,
            altKey: e.altKey,
            pressure: e.pressure,
            pointerType: e.pointerType,
            // Only pen pressure is real; mouse/touch report a constant 0.5,
            // which would render every stroke flat. Derive it from velocity.
            simulatePressure: e.pointerType !== 'pen',
          },
          useCanvasStore.getState().elements
        );

        // Detect nearby shapes for binding visual feedback during arrow drawing
        if (currentTool === 'arrow') {
          const allElements = useCanvasStore.getState().elements;
          const draftEl = useCanvasStore.getState().draftElement;

          if (
            draftEl &&
            'points' in draftEl &&
            Array.isArray(draftEl.points) &&
            draftEl.points.length >= 2
          ) {
            // Get the current endpoint position (last point)
            const points = draftEl.points as Array<{ x: number; y: number }>;
            const endPoint = points[points.length - 1];
            const startPoint = points[0];

            if (endPoint) {
              const globalEndPoint = { x: draftEl.x + endPoint.x, y: draftEl.y + endPoint.y };
              const nearbyShape = findBindableElementAtPoint(
                globalEndPoint,
                allElements,
                draftEl.id,
                20
              );

              if (nearbyShape) {
                updateHoveredBindingId(nearbyShape.id);
              } else {
                updateHoveredBindingId(null);
              }
            }

            // Also detect binding at start point
            if (startPoint) {
              const globalStartPoint = { x: draftEl.x + startPoint.x, y: draftEl.y + startPoint.y };
              const nearbyStartShape = findBindableElementAtPoint(
                globalStartPoint,
                allElements,
                draftEl.id,
                20
              );

              if (nearbyStartShape) {
                updateStartPointBindingId(nearbyStartShape.id);
              } else {
                updateStartPointBindingId(null);
              }
            }
          } else {
            updateHoveredBindingId(null);
            updateStartPointBindingId(null);
          }
        }

        return;
      }
    },
    [
      readOnly,
      getCanvasCoordinates,
      snapPointToGrid,
      broadcastCursor,
      setCursorPosition,
      updateElementTransient,
      updateElementsTransient,
      pushHistory,
      updateDrawing,
      getGestureBoundArrows,
      scheduleEraserFlush,
    ]
  );

  const handlePointerUp = useCallback(
    (e?: React.PointerEvent) => {
      const currentTool = useCanvasStore.getState().activeTool;
      if (e?.pointerType === 'touch') {
        interactionRef.current.touchPointers.delete(e.pointerId);
        if (interactionRef.current.touchPointers.size < 2) {
          interactionRef.current.pinchStartDistance = 0;
          interactionRef.current.pinchStartMid = null;
        }
      }
      setCursorPosition(null);

      if (interactionRef.current.panning) {
        interactionRef.current.panning = false;
        interactionRef.current.panStartClient = null;
        setIsPanning(false);
        if (
          !interactionRef.current.isSpacePressed &&
          currentTool === 'hand' &&
          lastToolBeforeSpaceRef.current &&
          lastToolBeforeSpaceRef.current !== 'hand'
        ) {
          setActiveTool(lastToolBeforeSpaceRef.current as ActiveTool);
        }
        return;
      }

      const state = useCanvasStore.getState();
      if (state.marqueeSelection?.active) {
        const rect = normalizeMarquee(state.marqueeSelection.start, state.marqueeSelection.end);
        // Use spatial index to narrow candidates, then check intersection
        const candidates = spatialIndex.tree.search(rect);
        const candidateIds = new Set(candidates.map(c => c.id));
        const hitIds = matchMarqueeElements(
          state.elements,
          rect,
          state.marqueeSelectionMode,
          candidateIds
        );
        const expandedHitIds = expandSelectionWithGroups(hitIds, state.elements);

        if (e?.shiftKey) {
          setSelectedIds(
            expandSelectionWithGroups(
              new Set([...state.selectedIds, ...expandedHitIds]),
              state.elements
            )
          );
        } else {
          setSelectedIds(expandedHitIds);
        }
        useCanvasStore.getState().setMarqueeSelection(null);
        return;
      }

      // A press that never travelled past the click threshold commits
      // nothing: a click on empty space (selection was already cleared on
      // pointer-down) or a click on an element (selection already applied).
      if (interactionRef.current.pendingMarqueeStart) {
        interactionRef.current.pendingMarqueeStart = null;
        return;
      }
      interactionRef.current.pendingDrag = null;

      if (interactionRef.current.resizing) {
        const state = useCanvasStore.getState();
        // Group path: commit every member the same way the single path
        // commits its one element (version bump + broadcast + cache
        // invalidation through updateElement).
        const groupIds = interactionRef.current.resizeInitialEls
          ? Array.from(interactionRef.current.resizeInitialEls.keys())
          : null;
        if (groupIds) {
          for (const id of groupIds) updateElement(id, {});
        }
        finalizeResizeGesture(interactionRef.current, {
          editingId: state.isEditingElementId,
          resizedId: groupIds ? undefined : interactionRef.current.resizeInitialEl?.id,
          clearHoverBinding: () => updateHoveredBindingId(null),
          commitTransient: (id, updates) => updateElement(id, updates),
          setIsActive: setIsResizing,
          setEditingElementId,
          unlockElement,
          unlockGestureElements,
        });
        return;
      }

      if (interactionRef.current.rotating) {
        finalizeRotateGesture(interactionRef.current, {
          editingId: useCanvasStore.getState().isEditingElementId,
          setIsActive: setIsRotating,
          setEditingElementId,
          unlockElement,
          unlockGestureElements,
        });
        return;
      }

      if (interactionRef.current.dragging) {
        finalizeDragGesture(interactionRef.current, {
          editingId: useCanvasStore.getState().isEditingElementId,
          setIsActive: setIsDragging,
          setEditingElementId,
          unlockElement,
          unlockGestureElements,
        });
        return;
      }

      if (useCanvasStore.getState().isDrawing) {
        if (currentTool === 'laser') {
          setIsDrawing(false);
          window.dispatchEvent(new CustomEvent('dripl:laser-end'));
          return;
        }

        if (currentTool === 'eraser') {
          // Drain samples that never reached a frame. Hits were already
          // deleted live per batch (single undo step from stroke start), so
          // this only completes a tap with no frame in between.
          flushEraserAccumulator();

          useCanvasStore.getState().setEraserPath([]);
          eraserHitIdsRef.current.clear();
          setIsDrawing(false);
          maybeRevertToSelectTool('eraser');
          return;
        }

        if (
          currentTool === 'rectangle' ||
          currentTool === 'ellipse' ||
          currentTool === 'diamond' ||
          currentTool === 'arrow' ||
          currentTool === 'line' ||
          currentTool === 'freedraw' ||
          currentTool === 'frame'
        ) {
          const finishedElement = finishDrawing();
          if (finishedElement) {
            if (finishedElement.type === 'frame') {
              applyFrameGrouping(finishedElement);
            }
          }
          setIsDrawing(false);
          maybeRevertToSelectTool(currentTool);
          return;
        }

        setIsDrawing(false);
      }
    },
    [
      expandSelectionWithGroups,
      setSelectedIds,
      setIsPanning,
      setIsDragging,
      setIsResizing,
      setIsRotating,
      setCursorPosition,
      setEditingElementId,
      unlockElement,
      unlockGestureElements,
      setIsDrawing,
      maybeRevertToSelectTool,
      setActiveTool,
      finishDrawing,
      applyFrameGrouping,
      flushEraserAccumulator,
    ]
  );

  /**
   * Roll back the armed gesture to its start snapshot and tear it down,
   * without committing anything. Returns whether a gesture was armed.
   *
   * Escape calls this first (a second Escape clears the selection), and
   * pointer-cancel calls it instead of the commit path in `handlePointerUp`.
   * Snapshots are restored through the transient updater so no history entry
   * is written; the matching finalize releases the collaboration locks.
   */
  const cancelActiveGesture = useCallback((): boolean => {
    const interaction = interactionRef.current;
    const state = useCanvasStore.getState();
    let cancelled = false;

    // Presses that never travelled past the click threshold evaporate: there
    // is nothing visible to roll back, so they do not count as armed.
    interaction.pendingDrag = null;
    interaction.pendingMarqueeStart = null;

    if (interaction.panning) {
      interaction.panning = false;
      interaction.panStartClient = null;
      setIsPanning(false);
      cancelled = true;
    }

    if (state.marqueeSelection?.active) {
      setMarqueeSelection(null);
      cancelled = true;
    }

    if (interaction.dragging && interaction.dragInitialElements) {
      updateElementsTransient(
        new Map<string, Partial<DriplElement>>(interaction.dragInitialElements)
      );
      finalizeDragGesture(interaction, {
        editingId: state.isEditingElementId,
        setIsActive: setIsDragging,
        setEditingElementId,
        unlockElement,
        unlockGestureElements,
      });
      cancelled = true;
    }

    if (interaction.resizing && (interaction.resizeInitialEl || interaction.resizeInitialEls)) {
      const restore = new Map<string, Partial<DriplElement>>();
      if (interaction.resizeInitialEl) {
        restore.set(interaction.resizeInitialEl.id, interaction.resizeInitialEl);
      }
      interaction.resizeInitialEls?.forEach((element, id) => restore.set(id, element));
      updateElementsTransient(restore);
      finalizeResizeGesture(interaction, {
        editingId: state.isEditingElementId,
        resizedId: undefined,
        clearHoverBinding: () => updateHoveredBindingId(null),
        commitTransient: () => {},
        setIsActive: setIsResizing,
        setEditingElementId,
        unlockElement,
        unlockGestureElements,
      });
      cancelled = true;
    }

    if (interaction.rotating && (interaction.rotateInitialEl || interaction.rotateInitialEls)) {
      const restore = new Map<string, Partial<DriplElement>>();
      if (interaction.rotateInitialEl) {
        restore.set(interaction.rotateInitialEl.id, interaction.rotateInitialEl);
      }
      interaction.rotateInitialEls?.forEach((element, id) => restore.set(id, element));
      updateElementsTransient(restore);
      finalizeRotateGesture(interaction, {
        editingId: state.isEditingElementId,
        setIsActive: setIsRotating,
        setEditingElementId,
        unlockElement,
        unlockGestureElements,
      });
      cancelled = true;
    }

    if (state.isDrawing) {
      const tool = state.activeTool;
      if (tool === 'laser') {
        window.dispatchEvent(new CustomEvent('dripl:laser-end'));
      } else if (tool === 'eraser') {
        // Drop the pending batch and the accumulated hits without deleting:
        // Escape ends the stroke, it does not erase.
        if (eraserFlushRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(eraserFlushRef.current);
          eraserFlushRef.current = null;
        }
        eraserPendingRef.current = [];
        eraserHitIdsRef.current.clear();
        setEraserPath([]);
      } else {
        cancelDrawing();
      }
      setIsDrawing(false);
      cancelled = true;
    }

    return cancelled;
  }, [
    setIsPanning,
    setMarqueeSelection,
    updateElementsTransient,
    setIsDragging,
    setEditingElementId,
    unlockElement,
    unlockGestureElements,
    setIsResizing,
    setIsRotating,
    updateHoveredBindingId,
    setEraserPath,
    setIsDrawing,
    cancelDrawing,
  ]);

  return {
    interactionRef,
    lastToolBeforeSpaceRef,
    eraserHitIdsRef,
    hoveredBindingId,
    startPointBindingId,
    bindMode,
    handleDragOver,
    handleDrop,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    cancelActiveGesture,
  };
}
