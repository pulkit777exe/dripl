import { useCallback, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/store';
import { isPointNearElement } from '@dripl/math/intersection';
import type { DriplElement, LinearElement } from '@dripl/common';
import { resizeSingleElement } from '@dripl/element/resizeElements';
import { uploadImageToServer, loadImage } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import { calculateArrowBinding } from '@/utils/arrow-routing';
import {
  buildBoundArrowsByShape,
  updateBoundArrows,
  updateBoundLabels,
} from '@/lib/canvas/binding-sync';
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

export interface InteractionState {
  panning: boolean;
  panStartClient: { x: number; y: number } | null;
  isSpacePressed: boolean;
  dragStartCanvasPos: { x: number; y: number } | null;
  dragInitialElements: Map<string, DriplElement> | null;
  dragging: boolean;
  historyPushed: boolean;
  resizing: boolean;
  resizeHandle: string | null;
  resizeStartCanvasPos: { x: number; y: number } | null;
  resizeInitialEl: DriplElement | null;
  rotating: boolean;
  rotateInitialEl: DriplElement | null;
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
    options: { shiftKey: boolean; altKey?: boolean },
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
    options: { shiftKey: boolean; altKey: boolean; pressure?: number },
    elements: DriplElement[]
  ) => void;
  setDrawingState: (drawing: boolean) => void;
  maybeRevertToSelectTool: (tool: ActiveTool) => void;
  finishDrawing: () => DriplElement | null;
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
    historyPushed: false,
    resizing: false,
    resizeHandle: null,
    resizeStartCanvasPos: null,
    resizeInitialEl: null,
    rotating: false,
    rotateInitialEl: null,
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
    deleteElements,
    setMarqueeSelection,
    setIsDrawing,
    setEraserPath,
    expandSelectionWithGroups,
    getSelectionBounds,
    collectCascadeDeleteIds,
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
      deleteElements: state.deleteElements,
      setMarqueeSelection: state.setMarqueeSelection,
      setIsDrawing: state.setIsDrawing,
      setEraserPath: state.setEraserPath,
      expandSelectionWithGroups: state.expandSelectionWithGroups,
      getSelectionBounds: state.getSelectionBounds,
      collectCascadeDeleteIds: state.collectCascadeDeleteIds,
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
            // eslint-disable-next-line no-console -- image upload failure telemetry
            console.error('Failed to upload image:', error);
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
          const points = Array.from(interactionRef.current.touchPointers.values());
          const first = points[0];
          const second = points[1];
          if (first && second) {
            interactionRef.current.pinchStartDistance = pinchDistance(first, second);
            interactionRef.current.pinchStartMid = pinchMidpoint(first, second);
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
        if (isTemporaryPan && currentTool !== 'hand') {
          lastToolBeforeSpaceRef.current = currentTool;
        }
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

          interactionRef.current.dragging = true;
          interactionRef.current.historyPushed = false;
          interactionRef.current.dragStartCanvasPos = { x, y };
          interactionRef.current.dragInitialElements = snapshot;

          setIsDragging(true);
          if (idsToTrack.size > 0) {
            setEditingElementId(idsToTrack.size === 1 ? (Array.from(idsToTrack)[0] ?? null) : null);
            lockElementsForGesture(idsToTrack);
          }
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
              interactionRef.current.dragging = true;
              interactionRef.current.historyPushed = false;
              interactionRef.current.dragStartCanvasPos = { x, y };
              interactionRef.current.dragInitialElements = snapshot;
              setIsDragging(true);
              setEditingElementId(
                snapshot.size === 1 ? (Array.from(snapshot.keys())[0] ?? null) : null
              );
              lockElementsForGesture(snapshot.keys());
              return;
            }
          }

          if (!e.shiftKey) {
            useCanvasStore.getState().clearSelection();
          }
          setMarqueeSelection({ start: { x, y }, end: { x, y }, active: true });
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
              // eslint-disable-next-line no-console -- image tool upload failure telemetry
              console.error('Failed to upload image:', error);
            }
          }
        };
        input.click();
        return;
      }

      if (currentTool === 'eraser') {
        setIsDrawing(true);
        eraserHitIdsRef.current.clear();
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
          { shiftKey: e.shiftKey, altKey: e.altKey },
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
            const mid = pinchMidpoint(first, second);
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

      if (currentTool === 'laser' && useCanvasStore.getState().isDrawing) {
        window.dispatchEvent(new CustomEvent('dripl:laser-move', { detail: { x, y } }));
        return;
      }

      if (readOnly) return;

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

          if (startOrEnd) {
            const currentBinding =
              startOrEnd === 'start' ? arrowEl.startBinding : arrowEl.endBinding;
            const nearbyShape = findBindableElementAtPoint(target, allElements, el.id, 20);

            if (nearbyShape) {
              // Bind to the nearby shape
              updateHoveredBindingId(nearbyShape.id);
              if (!currentBinding || currentBinding.elementId !== nearbyShape.id) {
                // Unbind from current target if different
                let newElements = currentBinding
                  ? unbindArrowFromElement(arrowEl, startOrEnd, allElements)
                  : allElements;
                // Bind to new target
                const binding = calculateArrowBinding(target, nearbyShape);
                if (binding) {
                  newElements = bindArrowToElement(
                    arrowEl,
                    nearbyShape.id,
                    startOrEnd,
                    { x: binding.focus, y: 0.5 },
                    'orbit',
                    newElements
                  );
                  // Update the arrow in the store
                  const boundArrow = newElements.find(e => e.id === el.id) as LinearElement;
                  if (boundArrow) {
                    updatedElement = boundArrow;
                  }
                }
              }
            } else {
              // No nearby shape - unbind if currently bound
              updateHoveredBindingId(null);
              if (currentBinding) {
                const newElements = unbindArrowFromElement(arrowEl, startOrEnd, allElements);
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
        const isLinearElement =
          (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') &&
          el.points &&
          el.points.length > 0 &&
          el.width !== 0 &&
          el.height !== 0;
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
          updateElementTransient(el.id, updatedElement);
          // Update arrows bound to the resized element in one state batch.
          const elementsById = useCanvasStore.getState().elementsById;
          const boundUpdates = new Map<string, Partial<DriplElement>>();
          updateBoundArrows(new Set([el.id]), elementsById, getGestureBoundArrows(), boundUpdates);
          updateBoundLabels(new Set([el.id]), elementsById, boundUpdates);
          updateElementsTransient(boundUpdates);
        }
        return;
      }

      if (interactionRef.current.rotating && interactionRef.current.rotateInitialEl) {
        const el = interactionRef.current.rotateInitialEl;
        const angle = computeRotationAngle(el, x, y);
        if (!interactionRef.current.historyPushed) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }
        const updatedElement: DriplElement = { ...el, angle };
        if (el.id) {
          updateElementTransient(el.id, updatedElement);
          const elementsById = useCanvasStore.getState().elementsById;
          const boundUpdates = new Map<string, Partial<DriplElement>>();
          updateBoundLabels(new Set([el.id]), elementsById, boundUpdates);
          updateElementsTransient(boundUpdates);
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

        const movedIds = new Set<string>();
        const primaryUpdates = new Map<string, Partial<DriplElement>>();
        interactionRef.current.dragInitialElements.forEach((initialEl, id) => {
          const updatedEl: DriplElement = {
            ...initialEl,
            x: initialEl.x + totalDeltaX,
            y: initialEl.y + totalDeltaY,
          };

          primaryUpdates.set(id, updatedEl);
          movedIds.add(id);
        });
        updateElementsTransient(primaryUpdates);

        // Update arrows bound to moved elements in one state batch.
        const elementsById = useCanvasStore.getState().elementsById;
        const boundUpdates = new Map<string, Partial<DriplElement>>();
        updateBoundArrows(movedIds, elementsById, getGestureBoundArrows(), boundUpdates);
        updateBoundLabels(movedIds, elementsById, boundUpdates);
        updateElementsTransient(boundUpdates);

        return;
      }

      if (!useCanvasStore.getState().isDrawing) return;

      if (currentTool === 'eraser') {
        useCanvasStore.getState().setEraserPath(prev => [...prev, { x, y }]);
        const state = useCanvasStore.getState();
        const candidates = spatialIndex.tree.search({
          minX: x - 20,
          minY: y - 20,
          maxX: x + 20,
          maxY: y + 20,
        });
        candidates.forEach(candidate => {
          const element = spatialIndex.byId.get(candidate.id);
          if (!element) return;
          const lockOwner = state.elementLocks.get(element.id);
          if (lockOwner && lockOwner !== state.userId) return;
          if (isPointNearElement({ x, y }, element, 20)) {
            eraserHitIdsRef.current.add(element.id);
          }
        });
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

      if (interactionRef.current.resizing) {
        const state = useCanvasStore.getState();
        finalizeResizeGesture(interactionRef.current, {
          editingId: state.isEditingElementId,
          resizedId: interactionRef.current.resizeInitialEl?.id,
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
          const elementsToErase = collectCascadeDeleteIds(eraserHitIdsRef.current);

          if (elementsToErase.length > 0) {
            deleteElements(elementsToErase);
          }

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
      deleteElements,
      setIsDrawing,
      maybeRevertToSelectTool,
      setActiveTool,
      collectCascadeDeleteIds,
      finishDrawing,
      applyFrameGrouping,
    ]
  );

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
  };
}
