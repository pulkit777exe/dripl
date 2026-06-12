import { useCallback, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useCanvasStore, type ActiveTool } from '@/lib/canvas-store';
import { getElementBounds, isPointInElement, inverseRotatePoint } from '@dripl/math/intersection';
import type { DriplElement, LinearElement } from '@dripl/common';
import { uploadImageToServer } from '@/utils/tools/image';
import { v4 as uuidv4 } from 'uuid';
import { recalculateBinding } from '@/utils/arrow-routing';

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
  updateElementTransient: (id: string, element: DriplElement) => void;
  pushHistory: () => void;
  lockElementsForGesture: (ids: Iterable<string>) => void;
  unlockElement: (id: string) => void;
  unlockGestureElements: () => void;
  setEditingElementId: (id: string | null) => void;
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

  for (const el of elements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const linearEl = el as LinearElement;

    let needsUpdate = false;
    let newStartBinding = linearEl.startBinding;
    let newEndBinding = linearEl.endBinding;

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

  const getDistanceToBounds = useCallback((point: { x: number; y: number }, element: DriplElement): number => {
    const bounds = getElementBounds(element);
    const nearestX = Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width));
    const nearestY = Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height));
    const dx = point.x - nearestX;
    const dy = point.y - nearestY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const isPointNearElement = useCallback(
    (point: { x: number; y: number }, element: DriplElement, tolerance: number): boolean => {
      if (isPointInElement(point, element)) return true;
      return getDistanceToBounds(point, element) <= tolerance;
    },
    [getDistanceToBounds]
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
            const img = new Image();
            img.onload = () => {
              let width = img.width;
              let height = img.height;
              const maxSize = 500;
              if (width > maxSize || height > maxSize) {
                const ratio = Math.min(maxSize / width, maxSize / height);
                width *= ratio;
                height *= ratio;
              }
              const element: DriplElement = {
                id: uuidv4(),
                type: 'image',
                x: x - width / 2,
                y: y - height / 2,
                width,
                height,
                strokeColor: 'transparent',
                backgroundColor: 'transparent',
                strokeWidth: 0,
                opacity: 1,
                src: imageUrl,
              };
              addElement(element);
            };
            img.src = imageUrl;
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

        const element = getElementAtPosition(x, y);
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
              const img = new Image();
              img.onload = () => {
                let width = img.width;
                let height = img.height;
                const maxSize = 500;
                if (width > maxSize || height > maxSize) {
                  const ratio = Math.min(maxSize / width, maxSize / height);
                  width *= ratio;
                  height *= ratio;
                }
                const element: DriplElement = {
                  id: uuidv4(),
                  type: 'image',
                  x: x - width / 2,
                  y: y - height / 2,
                  width,
                  height,
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
              };
              img.src = imageUrl;
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
        updateDrawing(
          { x, y },
          {
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            pressure: e.pressure,
          },
          useCanvasStore.getState().elements
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
      updateDrawing,
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
          const updatedElement: DriplElement = {
            ...el,
            x: newMinX,
            y: newMinY,
            width: Math.max(4, newMaxX - newMinX),
            height: Math.max(4, newMaxY - newMinY),
            points: relPts,
          };
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
          const originalFontSize = el.fontSize ?? 20;
          const scaleX = newWidth / el.width;
          const scaleY = newHeight / el.height;
          const scale = Math.sqrt(scaleX * scaleY);
          const newFontSize = Math.max(6, Math.round(originalFontSize * scale));
          updatedElement.fontSize = newFontSize;
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
        // Simple marquee selection using element bounds
        const hitIds = new Set<string>();
        state.elements.forEach(element => {
          const bounds = getElementBounds(element);
          if (
            bounds.x >= rect.minX &&
            bounds.y >= rect.minY &&
            bounds.x + bounds.width <= rect.maxX &&
            bounds.y + bounds.height <= rect.maxY
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
        const editingId = useCanvasStore.getState().isEditingElementId;
        interactionRef.current.resizing = false;
        interactionRef.current.historyPushed = false;
        interactionRef.current.resizeHandle = null;
        interactionRef.current.resizeStartCanvasPos = null;
        interactionRef.current.resizeInitialEl = null;
        setIsResizing(false);
        setEditingElementId(null);
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
    handleDragOver,
    handleDrop,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
