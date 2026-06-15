import { useCallback, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/canvas-store';
import { getElementBounds, isPointInElement, inverseRotatePoint, getDistanceToBounds, isPointNearElement } from '@dripl/math/intersection';
import type { DriplElement, LinearElement } from '@dripl/common';
import { resizeSingleElement } from '@dripl/element/resizeElements';
import { uploadImageToServer, loadImage } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import { recalculateBinding, calculateArrowBinding } from '@/utils/arrow-routing';
import { findBindableElementAtPoint, bindArrowToElement, unbindArrowFromElement } from '@/utils/arrow-binding';
import type { ToolType } from '@/hooks/useDrawingTools';

interface InteractionState {
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
    tree: { search: (bbox: { minX: number; minY: number; maxX: number; maxY: number }) => Array<{ id: string }> };
    byId: Map<string, DriplElement>;
  };
}

function updateBoundArrows(
  movedElementIds: Set<string>,
  elements: DriplElement[],
  updateElementTransient: (id: string, element: DriplElement) => void
) {
  const elementsById = new Map(elements.map(e => [e.id, e]));
  
  // Build reverse index: shapeId -> Set<arrowId> using boundElements
  const boundArrowsByShape = new Map<string, Set<string>>();
  for (const el of elements) {
    const bounds = (el as DriplElement & { boundElements?: Array<{ id: string; type: 'arrow' | 'text' }> }).boundElements;
    if (bounds) {
      for (const bound of bounds) {
        if (bound.type === 'arrow') {
          let arrowSet = boundArrowsByShape.get(el.id);
          if (!arrowSet) {
            arrowSet = new Set();
            boundArrowsByShape.set(el.id, arrowSet);
          }
          arrowSet.add(bound.id);
        }
      }
    }
  }

  // Only process arrows that are bound to moved shapes (O(k) where k = number of bound arrows)
  const arrowsToUpdate = new Set<string>();
  for (const movedId of movedElementIds) {
    const boundArrows = boundArrowsByShape.get(movedId);
    if (boundArrows) {
      for (const arrowId of boundArrows) {
        arrowsToUpdate.add(arrowId);
      }
    }
  }

  for (const arrowId of arrowsToUpdate) {
    const el = elementsById.get(arrowId);
    if (!el || (el.type !== 'arrow' && el.type !== 'line')) continue;
    const linearEl = el as LinearElement;

    let needsUpdate = false;

    if (linearEl.startBinding && movedElementIds.has(linearEl.startBinding.elementId)) {
      const targetEl = elementsById.get(linearEl.startBinding.elementId);
      if (targetEl) {
        const startPoint = recalculateBinding(
          { elementId: targetEl.id, focus: linearEl.startBinding.fixedPoint.x },
          targetEl
        );
        const relStart = { x: startPoint.x - el.x, y: startPoint.y - el.y };
        if (el.points.length > 0) {
          const newPoints = [...el.points];
          newPoints[0] = relStart;
          linearEl.points = newPoints;
          needsUpdate = true;
        }
      }
    }

    if (linearEl.endBinding && movedElementIds.has(linearEl.endBinding.elementId)) {
      const targetEl = elementsById.get(linearEl.endBinding.elementId);
      if (targetEl) {
        const endPoint = recalculateBinding(
          { elementId: targetEl.id, focus: linearEl.endBinding.fixedPoint.x },
          targetEl
        );
        const relEnd = { x: endPoint.x - el.x, y: endPoint.y - el.y };
        if (el.points.length > 1) {
          const newPoints = [...el.points];
          newPoints[newPoints.length - 1] = relEnd;
          linearEl.points = newPoints;
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      updateElementTransient(el.id, { ...linearEl });
    }
  }
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
  });

  const lastToolBeforeSpaceRef = useRef<string | null>(null);
  const eraserHitIdsRef = useRef<Set<string>>(new Set());
  const hoveredBindingIdRef = useRef<string | null>(null);

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

  const handleDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const { x, y } = getCanvasCoordinates(e);
      const files = Array.from(e.dataTransfer.files);

      for (const file of files) {
        if (file.type.startsWith('image/')) {
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
          } catch (error) {
            console.error('Failed to upload image:', error);
          }
        }
      }
    },
    [getCanvasCoordinates, addElement]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('pointer-events-auto')) return;
      e.currentTarget.setPointerCapture(e.pointerId);

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
            const dx = second.x - first.x;
            const dy = second.y - first.y;
            interactionRef.current.pinchStartDistance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            interactionRef.current.pinchStartMid = {
              x: (first.x + second.x) / 2,
              y: (first.y + second.y) / 2,
            };
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
          const doubleClicked = getElementAtPosition(x, y);
          if (doubleClicked?.type === 'text') {
            const existingText = 'text' in doubleClicked ? doubleClicked.text : '';
            setTextInput({
              x: doubleClicked.x,
              y: doubleClicked.y,
              id: uuidv4(),
              existingElementId: doubleClicked.id,
              value: existingText,
            });
            return;
          }
        }

        // Get all elements at this point for overlap resolution
        const allHitElements = getElementsAtPosition(x, y);
        // preferSelected: if any hit element is already selected, prefer it
        // over the topmost element. This lets you start dragging a selected element
        // even when a higher-z element overlaps it.
        let element: DriplElement | null = null;
        if (allHitElements.length > 0) {
          const state = useCanvasStore.getState();
          const selectedHit = allHitElements.find(el => state.selectedIds.has(el.id));
          element = selectedHit ?? allHitElements[allHitElements.length - 1]!;
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
        currentTool === 'frame'
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

        if (interactionRef.current.touchPointers.size === 2 && interactionRef.current.pinchStartMid) {
          const points = Array.from(interactionRef.current.touchPointers.values());
          const first = points[0];
          const second = points[1];
          if (first && second) {
            const dx = second.x - first.x;
            const dy = second.y - first.y;
            const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const mid = {
              x: (first.x + second.x) / 2,
              y: (first.y + second.y) / 2,
            };
            const startMid = interactionRef.current.pinchStartMid;
            const startZoom = interactionRef.current.pinchStartZoom;
            const startPan = interactionRef.current.pinchStartPan;

            const worldX = (startMid.x - startPan.x) / startZoom;
            const worldY = (startMid.y - startPan.y) / startZoom;
            const scaledZoom = Math.max(
              0.1,
              Math.min(20, startZoom * (distance / interactionRef.current.pinchStartDistance))
            );

            useCanvasStore.getState().setViewport(scaledZoom, mid.x - worldX * scaledZoom, mid.y - worldY * scaledZoom);
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
        if (!interactionRef.current.historyPushed && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }

        const isArrowEndpoint = handle === 'arrow-start' || handle === 'arrow-end';
        const arrowPointMatch = typeof handle === 'string' && handle.startsWith('arrow-point-')
          ? parseInt(handle.slice('arrow-point-'.length), 10)
          : -1;

        if (isArrowEndpoint || arrowPointMatch >= 0) {
          if (!('points' in el) || !el.points || el.points.length < 2) return;
          const pts = el.points as Array<{ x: number; y: number }>;
          const absPts = pts.map((p) => ({ x: el.x + p.x, y: el.y + p.y }));
          const idx = handle === 'arrow-start' ? 0
            : handle === 'arrow-end' ? pts.length - 1
            : arrowPointMatch;
          const target = absPts[idx];
          if (!target) return;
          const angle = el.angle ?? 0;
          if (angle) {
            const localDelta = inverseRotatePoint({ x: dx, y: dy }, 0, 0, angle);
            target.x += localDelta.x;
            target.y += localDelta.y;
          } else {
            target.x += dx;
            target.y += dy;
          }
          const allX = absPts.map(p => p.x);
          const allY = absPts.map(p => p.y);
          const newMinX = Math.min(...allX);
          const newMinY = Math.min(...allY);
          const newMaxX = Math.max(...allX);
          const newMaxY = Math.max(...allY);
          const relPts = absPts.map(p => ({ x: p.x - newMinX, y: p.y - newMinY }));
          let updatedElement: DriplElement = {
            ...el,
            x: newMinX,
            y: newMinY,
            width: Math.max(4, newMaxX - newMinX),
            height: Math.max(4, newMaxY - newMinY),
            points: relPts,
          };

          // Dynamic binding detection for arrow endpoints
          const allElements = useCanvasStore.getState().elements;
          const arrowEl = updatedElement as LinearElement;
          const startOrEnd = handle === 'arrow-start' ? 'start' : handle === 'arrow-end' ? 'end' : null;
          
          if (startOrEnd) {
            const currentBinding = startOrEnd === 'start' ? arrowEl.startBinding : arrowEl.endBinding;
            const nearbyShape = findBindableElementAtPoint(target, allElements, el.id, 20);
            
            if (nearbyShape) {
              // Bind to the nearby shape
              hoveredBindingIdRef.current = nearbyShape.id;
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
              hoveredBindingIdRef.current = null;
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

        let newX = el.x;
        let newY = el.y;
        let newWidth = el.width;
        let newHeight = el.height;
        const aspect = el.height !== 0 ? el.width / el.height : 1;

        switch (handle) {
          case 'se':
            newWidth = Math.max(4, el.width + dx);
            newHeight = Math.max(4, el.height + dy);
            break;
          case 'sw':
            newWidth = Math.max(4, el.width - dx);
            newX = el.x + el.width - newWidth;
            newHeight = Math.max(4, el.height + dy);
            break;
          case 'ne':
            newWidth = Math.max(4, el.width + dx);
            newHeight = Math.max(4, el.height - dy);
            newY = el.y + el.height - newHeight;
            break;
          case 'nw':
            newWidth = Math.max(4, el.width - dx);
            newX = el.x + el.width - newWidth;
            newHeight = Math.max(4, el.height - dy);
            newY = el.y + el.height - newHeight;
            break;
          case 'e':
            newWidth = Math.max(4, el.width + dx);
            break;
          case 'w':
            newWidth = Math.max(4, el.width - dx);
            newX = el.x + el.width - newWidth;
            break;
          case 's':
            newHeight = Math.max(4, el.height + dy);
            break;
          case 'n':
            newHeight = Math.max(4, el.height - dy);
            newY = el.y + el.height - newHeight;
            break;
        }

        if (e.shiftKey) {
          const base = Math.max(newWidth, newHeight);
          newWidth = base;
          newHeight = aspect !== 0 ? base / aspect : base;
          if (handle.includes('w')) {
            newX = el.x + el.width - newWidth;
          }
          if (handle.includes('n')) {
            newY = el.y + el.height - newHeight;
          }
        }

        if (useCanvasStore.getState().gridEnabled) {
          const snapped = snapPointToGrid({ x: newX, y: newY });
          newX = snapped.x;
          newY = snapped.y;
          const gridSize = useCanvasStore.getState().gridSize;
          newWidth = Math.max(4, Math.round(newWidth / gridSize) * gridSize);
          newHeight = Math.max(4, Math.round(newHeight / gridSize) * gridSize);
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
            handle as any,
            { shouldMaintainAspectRatio: e.shiftKey, shouldResizeFromCenter: e.altKey }
          );
          Object.assign(updatedElement, resizedProps);
        }

        if (
          (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') &&
          el.points &&
          el.points.length > 0 &&
          el.width !== 0 &&
          el.height !== 0
        ) {
          const pts = el.points as Array<{ x: number; y: number }>;
          const sx = newWidth / el.width;
          const sy = newHeight / el.height;
          updatedElement.points = pts.map(p => ({ x: p.x * sx, y: p.y * sy }));
        }

        if (el.id) {
          updateElementTransient(el.id, updatedElement);
          // Update arrows bound to the resized element
          const allElements = useCanvasStore.getState().elements;
          updateBoundArrows(new Set([el.id]), allElements, updateElementTransient);
        }
        return;
      }

      if (interactionRef.current.rotating && interactionRef.current.rotateInitialEl) {
        const el = interactionRef.current.rotateInitialEl;
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        const angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;
        if (!interactionRef.current.historyPushed) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }
        const updatedElement: DriplElement = { ...el, angle };
        if (el.id) updateElementTransient(el.id, updatedElement);
        return;
      }

      if (interactionRef.current.dragging && interactionRef.current.dragInitialElements && interactionRef.current.dragStartCanvasPos) {
        const totalDeltaX = x - interactionRef.current.dragStartCanvasPos.x;
        const totalDeltaY = y - interactionRef.current.dragStartCanvasPos.y;

        if (
          !interactionRef.current.historyPushed &&
          (Math.abs(totalDeltaX) > 0.5 || Math.abs(totalDeltaY) > 0.5)
        ) {
          pushHistory();
          interactionRef.current.historyPushed = true;
        }

        const movedIds = new Set<string>();
        interactionRef.current.dragInitialElements.forEach((initialEl, id) => {
          const updatedEl: DriplElement = {
            ...initialEl,
            x: initialEl.x + totalDeltaX,
            y: initialEl.y + totalDeltaY,
          };

          updateElementTransient(id, updatedEl);
          movedIds.add(id);
        });

        // Update arrows bound to moved elements
        const allElements = useCanvasStore.getState().elements;
        updateBoundArrows(movedIds, allElements, updateElementTransient);

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
        currentTool === 'frame'
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
      pushHistory,
      updateDrawing,
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
        const rect = {
          minX: Math.min(state.marqueeSelection.start.x, state.marqueeSelection.end.x),
          minY: Math.min(state.marqueeSelection.start.y, state.marqueeSelection.end.y),
          maxX: Math.max(state.marqueeSelection.start.x, state.marqueeSelection.end.x),
          maxY: Math.max(state.marqueeSelection.start.y, state.marqueeSelection.end.y),
        };
        // Use spatial index to narrow candidates, then check intersection
        const candidates = spatialIndex.tree.search(rect);
        const candidateIds = new Set(candidates.map(c => c.id));
        const hitIds = new Set<string>();
        state.elements.forEach(element => {
          if (!candidateIds.has(element.id)) return;
          const bounds = getElementBounds(element);
          if (
            bounds.x < rect.maxX &&
            bounds.x + bounds.width > rect.minX &&
            bounds.y < rect.maxY &&
            bounds.y + bounds.height > rect.minY
          ) {
            hitIds.add(element.id);
          }
        });
        const expandedHitIds = expandSelectionWithGroups(hitIds, state.elements);

        if (e?.shiftKey) {
          setSelectedIds(
            expandSelectionWithGroups(new Set([...state.selectedIds, ...expandedHitIds]), state.elements)
          );
        } else {
          setSelectedIds(expandedHitIds);
        }
        useCanvasStore.getState().setMarqueeSelection(null);
        return;
      }

      if (interactionRef.current.resizing) {
        const state = useCanvasStore.getState();
        const editingId = state.isEditingElementId;
        const resizedId = interactionRef.current.resizeInitialEl?.id;
        interactionRef.current.resizing = false;
        interactionRef.current.historyPushed = false;
        interactionRef.current.resizeHandle = null;
        interactionRef.current.resizeStartCanvasPos = null;
        interactionRef.current.resizeInitialEl = null;
        hoveredBindingIdRef.current = null;
        setIsResizing(false);
        setEditingElementId(null);
        if (resizedId) updateElement(resizedId, {});
        if (editingId) unlockElement(editingId);
        unlockGestureElements();
        return;
      }

      if (interactionRef.current.rotating) {
        const editingId = useCanvasStore.getState().isEditingElementId;
        interactionRef.current.rotating = false;
        interactionRef.current.historyPushed = false;
        interactionRef.current.rotateInitialEl = null;
        setIsRotating(false);
        setEditingElementId(null);
        if (editingId) unlockElement(editingId);
        unlockGestureElements();
        return;
      }

      if (interactionRef.current.dragging) {
        const editingId = useCanvasStore.getState().isEditingElementId;
        interactionRef.current.dragging = false;
        interactionRef.current.historyPushed = false;
        interactionRef.current.dragStartCanvasPos = null;
        interactionRef.current.dragInitialElements = null;
        setIsDragging(false);
        setEditingElementId(null);
        if (editingId) unlockElement(editingId);
        unlockGestureElements();
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
    hoveredBindingIdRef,
    handleDragOver,
    handleDrop,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
