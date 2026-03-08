"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useCanvasStore, type ActiveTool } from "@/lib/canvas-store";
import { useCollaboration } from "@/hooks/useCollaboration";
import {
  saveLocalCanvasToStorage,
  LocalCanvasState,
  LOCAL_CANVAS_STORAGE_KEYS,
  loadLocalCanvasFromStorage,
} from "@/utils/localCanvasStorage";
import { getElementBounds, isPointInElement } from "@dripl/math";
import {
  ActionCreator,
  CanvasContentSchema,
  type DriplElement,
} from "@dripl/common";
import {
  getRuntimeStore,
  updateRuntimeStoreSnapshot,
  snapshotFromState,
} from "@/lib/runtime-store-bridge";
import { getOrCreateCollaboratorName } from "@/utils/username";
import { v4 as uuidv4 } from "uuid";
import RBush from "rbush";
import { SelectionOverlay, ResizeHandle } from "./SelectionOverlay";
import { NameInputModal } from "./NameInputModal";
import { CollaboratorsList } from "./CollaboratorsList";
import { PropertiesPanel } from "./PropertiesPanel";
import { ContextMenu } from "./ContextMenu";
import { DualCanvas } from "./DualCanvas";
import { screenToCanvas, Viewport } from "@/utils/canvas-coordinates";
import { useDrawingTools } from "@/hooks/useDrawingTools";

interface Point {
  x: number;
  y: number;
}

interface CanvasProps {
  roomSlug: string | null;
  theme: "light" | "dark";
}

interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

export default function RoughCanvas({ roomSlug, theme }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerReady, setContainerReady] = useState(false);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current =
      el;
    setContainerReady(!!el);
  }, []);

  const [userName, setUserName] = useState<string | null>(() =>
    getOrCreateCollaboratorName(),
  );

  const [isDrawing, setIsDrawing] = useState(false);
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
  const eraserHitIdsRef = useRef<Set<string>>(new Set());
  const lastToolBeforeSpaceRef = useRef<ActiveTool | null>(null);
  const activeGestureLocksRef = useRef<Set<string>>(new Set());

  // ── Interaction refs ─────────────────────────────────────────────────────
  // All mutable interaction state lives here to avoid stale closures.
  const interactionRef = useRef({
    // Resize
    resizing: false,
    resizeHandle: null as ResizeHandle | null,
    resizeStartCanvasPos: null as Point | null,
    resizeInitialEl: null as DriplElement | null,

    // Drag
    dragging: false,
    dragStartCanvasPos: null as Point | null,
    // Snapshot of elements at drag start (by id → element)
    dragInitialElements: null as Map<string, DriplElement> | null,

    // Rotate
    rotating: false,
    rotateInitialEl: null as DriplElement | null,
    rotateCenterX: 0,
    rotateCenterY: 0,

    // Panning
    panning: false,
    panStartClient: null as Point | null,

    // Gesture
    isSpacePressed: false,
    touchPointers: new Map<number, Point>(),
    pinchStartDistance: 0,
    pinchStartMid: null as Point | null,
    pinchStartZoom: 1,
    pinchStartPan: { x: 0, y: 0 },
  });

  const {
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: isToolDrawing,
  } = useDrawingTools();

  const elements = useCanvasStore((state) => state.elements);
  // draftElement lives in Zustand — the single source of truth for the in-progress shape.
  const draftElement = useCanvasStore((state) => state.draftElement);
  const activeTool = useCanvasStore((state) => state.activeTool);
  const toolLocked = useCanvasStore((state) => state.toolLocked);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const currentStrokeColor = useCanvasStore(
    (state) => state.currentStrokeColor,
  );
  const currentStrokeWidth = useCanvasStore(
    (state) => state.currentStrokeWidth,
  );
  const currentRoughness = useCanvasStore((state) => state.currentRoughness);
  const currentBackgroundColor = useCanvasStore(
    (state) => state.currentBackgroundColor,
  );
  const currentStrokeStyle = useCanvasStore(
    (state) => state.currentStrokeStyle,
  );
  const currentFillStyle = useCanvasStore((state) => state.currentFillStyle);
  const readOnly = useCanvasStore((state) => state.readOnly);
  const gridEnabled = useCanvasStore((state) => state.gridEnabled);
  const gridSize = useCanvasStore((state) => state.gridSize);
  const elementLocks = useCanvasStore((state) => state.elementLocks);
  const userId = useCanvasStore((state) => state.userId);

  const setElements = useCanvasStore((state) => state.setElements);
  const addElement = useCanvasStore((state) => state.addElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const deleteElements = useCanvasStore((state) => state.deleteElements);
  const setSelectedIds = useCanvasStore((state) => state.setSelectedIds);
  const selectElement = useCanvasStore((state) => state.selectElement);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const setEditingElementId = useCanvasStore(
    (state) => state.setEditingElementId,
  );
  const setActiveTool = useCanvasStore((state) => state.setActiveTool);
  const setGridEnabled = useCanvasStore((state) => state.setGridEnabled);
  const bringForward = useCanvasStore((state) => state.bringForward);
  const sendBackward = useCanvasStore((state) => state.sendBackward);
  const bringToFront = useCanvasStore((state) => state.bringToFront);
  const sendToBack = useCanvasStore((state) => state.sendToBack);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);
  const setPan = useCanvasStore((state) => state.setPan);
  const setZoom = useCanvasStore((state) => state.setZoom);

  const suppressRemoteBroadcastRef = useRef(false);
  const {
    isConnected,
    collaborators,
    broadcastElements,
    broadcastCursor,
    lockElement,
    unlockElement,
  } = useCollaboration(roomSlug, {
    displayName: userName,
    onRemoteUpdate: (remoteElements) => {
      suppressRemoteBroadcastRef.current = true;
      setElements(remoteElements, { skipHistory: true });
    },
  });

  const lockElementsForGesture = useCallback(
    (ids: Iterable<string>) => {
      for (const id of ids) {
        activeGestureLocksRef.current.add(id);
        lockElement(id);
      }
    },
    [lockElement],
  );

  const unlockGestureElements = useCallback(() => {
    activeGestureLocksRef.current.forEach((id) => {
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

  // ── Persist local canvas ─────────────────────────────────────────────────
  useEffect(() => {
    if (roomSlug === null) {
      const appState: LocalCanvasState = {
        theme,
        zoom,
        panX,
        panY,
        currentStrokeColor,
        currentBackgroundColor,
        currentStrokeWidth,
        currentRoughness,
        currentStrokeStyle,
        currentFillStyle,
        activeTool,
      };
      const timeoutId = setTimeout(() => {
        saveLocalCanvasToStorage(elements, appState, selectedIds);
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [
    roomSlug,
    elements,
    selectedIds,
    theme,
    zoom,
    panX,
    panY,
    currentStrokeColor,
    currentBackgroundColor,
    currentStrokeWidth,
    currentRoughness,
    currentStrokeStyle,
    currentFillStyle,
    activeTool,
  ]);

  useEffect(() => {
    if (roomSlug !== null) return;

    const flushToStorage = () => {
      const state = useCanvasStore.getState();
      const appState: LocalCanvasState = {
        theme,
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
        currentStrokeColor: state.currentStrokeColor,
        currentBackgroundColor: state.currentBackgroundColor,
        currentStrokeWidth: state.currentStrokeWidth,
        currentRoughness: state.currentRoughness,
        currentStrokeStyle: state.currentStrokeStyle,
        currentFillStyle: state.currentFillStyle,
        activeTool: state.activeTool,
      };
      saveLocalCanvasToStorage(state.elements, appState, state.selectedIds);
    };

    const handleVisibilityOrBlur = () => {
      if (document.hidden) flushToStorage();
    };
    const handleBeforeUnload = () => flushToStorage();

    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        (event.key !== LOCAL_CANVAS_STORAGE_KEYS.CANVAS &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.STATE &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.STRUCTURED)
      )
        return;

      const {
        elements: savedElements,
        appState,
        selectedIds: savedSelectedIds,
      } = loadLocalCanvasFromStorage();

      if (savedElements && savedElements.length) {
        setElements(savedElements, { skipHistory: true });
        updateRuntimeStoreSnapshot(
          snapshotFromState(savedElements, savedSelectedIds ?? []),
        );
      }
      if (savedSelectedIds?.length) setSelectedIds(new Set(savedSelectedIds));
      if (appState) {
        if (appState.zoom) setZoom(appState.zoom);
        if (appState.panX !== undefined && appState.panY !== undefined)
          setPan(appState.panX, appState.panY);
      }
    };

    window.addEventListener("blur", handleVisibilityOrBlur);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityOrBlur);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("blur", handleVisibilityOrBlur);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityOrBlur);
      window.removeEventListener("storage", handleStorage);
    };
  }, [roomSlug, theme, setElements, setPan, setZoom]);

  useEffect(() => {
    const stored = getOrCreateCollaboratorName();
    setUserName(stored);
  }, []);

  const handleNameSubmit = (name: string) => {
    setUserName(name);
    localStorage.setItem("dripl_username", name);
  };

  // ── Viewport ─────────────────────────────────────────────────────────────
  const viewport: Viewport = {
    x: panX,
    y: panY,
    width: containerRef.current?.clientWidth || 0,
    height: containerRef.current?.clientHeight || 0,
    zoom,
  };

  const spatialIndex = useMemo(() => {
    const tree = new RBush<SpatialItem>();
    const byId = new Map<string, DriplElement>();
    const items: SpatialItem[] = [];
    elements.forEach((element) => {
      const bounds = getElementBounds(element);
      items.push({
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height,
        id: element.id,
      });
      byId.set(element.id, element);
    });
    tree.load(items);
    return { tree, byId };
  }, [elements]);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): Point => {
      const target = e.target as Node;
      const canvas =
        target && target instanceof HTMLCanvasElement
          ? target
          : containerRef.current?.querySelector("canvas");
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;
      return screenToCanvas(pixelX, pixelY, viewport);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panX, panY, zoom],
  );

  const snapPointToGrid = useCallback(
    (point: Point): Point => {
      if (!gridEnabled || gridSize <= 1) return point;
      return {
        x: Math.round(point.x / gridSize) * gridSize,
        y: Math.round(point.y / gridSize) * gridSize,
      };
    },
    [gridEnabled, gridSize],
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
    [getDistanceToBounds],
  );

  const getElementAtPosition = useCallback(
    (x: number, y: number): DriplElement | null => {
      const state = useCanvasStore.getState();
      const candidates = spatialIndex.tree.search({
        minX: x - 8,
        minY: y - 8,
        maxX: x + 8,
        maxY: y + 8,
      });
      const candidateIds = new Set(candidates.map((candidate) => candidate.id));
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

        if (!isPointNearElement({ x, y }, element, 8)) continue;
        if (
          element.type === "text" &&
          ("boundElementId" in element || "containerId" in element)
        ) {
          const containerId =
            ("boundElementId" in element ? element.boundElementId : undefined) ??
            ("containerId" in element ? element.containerId : undefined);
          if (containerId) {
            const container = state.elements.find((candidate) => candidate.id === containerId);
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
    [isPointNearElement, spatialIndex.tree],
  );

  const collectCascadeDeleteIds = useCallback(
    (seedIds: Iterable<string>): string[] => {
      const toDelete = new Set<string>(seedIds);
      if (toDelete.size === 0) return [];

      let changed = true;
      while (changed) {
        changed = false;
        elements.forEach((element) => {
          if (toDelete.has(element.id)) {
            if (
              (element.type === "arrow" || element.type === "line") &&
              "labelId" in element &&
              element.labelId &&
              !toDelete.has(element.labelId)
            ) {
              toDelete.add(element.labelId);
              changed = true;
            }
            return;
          }

          if (element.type !== "text") return;
          const boundTargetId =
            ("boundElementId" in element ? element.boundElementId : undefined) ??
            ("containerId" in element ? element.containerId : undefined);
          if (boundTargetId && toDelete.has(boundTargetId)) {
            toDelete.add(element.id);
            changed = true;
          }
        });
      }

      return Array.from(toDelete);
    },
    [elements],
  );

  const getSelectionBounds = useCallback(
    (selected: Set<string>, sceneElements: DriplElement[]) => {
      const selectedElements = sceneElements.filter((element) =>
        selected.has(element.id),
      );
      if (selectedElements.length === 0) return null;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      selectedElements.forEach((element) => {
        const bounds = getElementBounds(element);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      });

      return { minX, minY, maxX, maxY };
    },
    [],
  );

  // Legacy createElement is removed — all element creation goes through
  // useDrawingTools (startDrawing → updateDrawing → finishDrawing → commitDraft).

  // ── Resize start ──────────────────────────────────────────────────────────
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation();
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find(
        (el) => el.id === selectedIdsArray[0],
      );
      if (!element) return;
      const lockOwner = state.elementLocks.get(element.id);
      if (lockOwner && lockOwner !== state.userId) return;

      const startPos = getCanvasCoordinates(e);

      // Deep clone element to freeze it as the baseline
      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

      interactionRef.current.resizing = true;
      interactionRef.current.resizeHandle = handle;
      interactionRef.current.resizeStartCanvasPos = startPos;
      interactionRef.current.resizeInitialEl = frozenEl;

      setIsResizing(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      // Capture pointer on the canvas so we still get events outside
      const canvas = containerRef.current?.querySelector(
        "canvas:last-child",
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [getCanvasCoordinates, lockElementsForGesture, setEditingElementId],
  );

  // ── Rotate start ──────────────────────────────────────────────────────────
  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find(
        (el) => el.id === selectedIdsArray[0],
      );
      if (!element) return;
      const lockOwner = state.elementLocks.get(element.id);
      if (lockOwner && lockOwner !== state.userId) return;

      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;

      interactionRef.current.rotating = true;
      interactionRef.current.rotateInitialEl = frozenEl;
      interactionRef.current.rotateCenterX = cx;
      interactionRef.current.rotateCenterY = cy;

      setIsRotating(true);
      // Lock: prevent remote reconciliation from overwriting this element.
      setEditingElementId(element.id);
      lockElementsForGesture([element.id]);

      const canvas = containerRef.current?.querySelector(
        "canvas:last-child",
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [lockElementsForGesture, setEditingElementId],
  );

  // ── Drag / drop images ────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const { x, y } = getCanvasCoordinates(e);
    const files = Array.from(e.dataTransfer.files);

    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
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
                type: "image",
                x: x - width / 2,
                y: y - height / 2,
                width,
                height,
                strokeColor: "transparent",
                backgroundColor: "transparent",
                strokeWidth: 0,
                opacity: 1,
                src: event.target!.result as string,
              };
              addElement(element);
            };
            img.src = event.target.result as string;
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // ── Pointer down ──────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("pointer-events-auto")) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.pointerType === "touch") {
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
          interactionRef.current.pinchStartDistance = Math.max(
            1,
            Math.sqrt(dx * dx + dy * dy),
          );
          interactionRef.current.pinchStartMid = {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          };
          const state = useCanvasStore.getState();
          interactionRef.current.pinchStartZoom = state.zoom;
          interactionRef.current.pinchStartPan = { x: state.panX, y: state.panY };
          interactionRef.current.panning = true;
          setIsPanning(true);
        }
      }
    }

    const rawPoint = getCanvasCoordinates(e);
    const point = snapPointToGrid(rawPoint);
    const { x, y } = point;

    broadcastCursor(x, y);

    const isTemporaryPan = interactionRef.current.isSpacePressed || e.button === 1;
    if (activeTool === "hand" || isTemporaryPan) {
      e.preventDefault();
      if (isTemporaryPan && activeTool !== "hand") {
        lastToolBeforeSpaceRef.current = activeTool;
      }
      interactionRef.current.panning = true;
      interactionRef.current.panStartClient = { x: e.clientX, y: e.clientY };
      setIsPanning(true);
      return;
    }

    if (readOnly) {
      return;
    }

    if (activeTool === "select") {
      if (e.detail === 2) {
        const doubleClicked = getElementAtPosition(x, y);
        if (doubleClicked?.type === "text") {
          const existingText = "text" in doubleClicked ? doubleClicked.text : "";
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
        if (e.shiftKey) {
          selectElement(element.id, true);
        } else {
          const state = useCanvasStore.getState();
          if (!state.selectedIds.has(element.id)) {
            setSelectedIds(new Set([element.id]));
          }
        }

        // Snapshot ALL currently-selected elements (after selection update)
        // Use a microtask delay so the selection state has settled
        const state = useCanvasStore.getState();
        const idsToTrack = e.shiftKey
          ? new Set([...state.selectedIds, element.id])
          : state.selectedIds.has(element.id)
            ? state.selectedIds
            : new Set([element.id]);

        const snapshot = new Map<string, DriplElement>();
        state.elements.forEach((el) => {
          if (idsToTrack.has(el.id))
            snapshot.set(el.id, JSON.parse(JSON.stringify(el)));
        });

        interactionRef.current.dragging = true;
        interactionRef.current.dragStartCanvasPos = { x, y };
        interactionRef.current.dragInitialElements = snapshot;

        setIsDragging(true);
        if (idsToTrack.size > 0) {
          setEditingElementId(idsToTrack.size === 1 ? Array.from(idsToTrack)[0] ?? null : null);
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
          state.elements.forEach((candidate) => {
            if (!state.selectedIds.has(candidate.id)) return;
            const lockOwner = state.elementLocks.get(candidate.id);
            if (lockOwner && lockOwner !== state.userId) return;
            snapshot.set(candidate.id, JSON.parse(JSON.stringify(candidate)));
          });

          if (snapshot.size > 0) {
            interactionRef.current.dragging = true;
            interactionRef.current.dragStartCanvasPos = { x, y };
            interactionRef.current.dragInitialElements = snapshot;
            setIsDragging(true);
            setEditingElementId(
              snapshot.size === 1 ? Array.from(snapshot.keys())[0] ?? null : null,
            );
            lockElementsForGesture(snapshot.keys());
            return;
          }
        }

        if (!e.shiftKey) clearSelection();
        setMarqueeSelection({ start: { x, y }, end: { x, y }, active: true });
      }
      return;
    }

    if (activeTool === "text") {
      setTextInput({ x, y, id: uuidv4(), value: "" });
      return;
    }

    if (activeTool === "image") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            if (e.target?.result) {
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
                  type: "image",
                  x: x - width / 2,
                  y: y - height / 2,
                  width,
                  height,
                  strokeColor: "transparent",
                  backgroundColor: "transparent",
                  strokeWidth: 0,
                  opacity: 1,
                  src: e.target!.result as string,
                };
                addElement(element);
              };
              img.src = e.target.result as string;
            }
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
      return;
    }

    if (activeTool === "eraser") {
      setIsDrawing(true);
      eraserHitIdsRef.current.clear();
      setEraserPath([{ x, y }]);
      return;
    }

    if (
      activeTool === "rectangle" ||
      activeTool === "ellipse" ||
      activeTool === "diamond" ||
      activeTool === "arrow" ||
      activeTool === "line" ||
      activeTool === "freedraw"
    ) {
      startDrawing(
        { x, y },
        activeTool,
        { shiftKey: e.shiftKey, altKey: e.altKey },
        {
          strokeColor: currentStrokeColor,
          backgroundColor: currentBackgroundColor,
          strokeWidth: currentStrokeWidth,
          opacity: 1,
          roughness: currentRoughness,
          strokeStyle: currentStrokeStyle,
          fillStyle: currentFillStyle,
        },
        elements,
      );
      setIsDrawing(true);
      return;
    }
  };

  // ── Pointer move ──────────────────────────────────────────────────────────
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(e);

    if (
      e.pointerType === "touch" &&
      interactionRef.current.touchPointers.has(e.pointerId)
    ) {
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
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
          const startMid = interactionRef.current.pinchStartMid;
          const startZoom = interactionRef.current.pinchStartZoom;
          const startPan = interactionRef.current.pinchStartPan;

          const worldX = (startMid.x - startPan.x) / startZoom;
          const worldY = (startMid.y - startPan.y) / startZoom;
          const scaledZoom = Math.max(
            0.1,
            Math.min(
              20,
              startZoom * (distance / interactionRef.current.pinchStartDistance),
            ),
          );

          setZoom(scaledZoom);
          setPan(mid.x - worldX * scaledZoom, mid.y - worldY * scaledZoom);
          return;
        }
      }
    }

    setCursorPosition({ x, y });
    broadcastCursor(x, y);

    // ── Panning ────────────────────────────────────────────────────────────
    if (
      interactionRef.current.panning &&
      interactionRef.current.panStartClient
    ) {
      const dx = e.clientX - interactionRef.current.panStartClient.x;
      const dy = e.clientY - interactionRef.current.panStartClient.y;
      const state = useCanvasStore.getState();
      setPan(state.panX + dx, state.panY + dy);
      interactionRef.current.panStartClient = { x: e.clientX, y: e.clientY };
      return;
    }

    // ── Marquee selection ──────────────────────────────────────────────────
    if (marqueeSelection?.active) {
      setMarqueeSelection({ ...marqueeSelection, end: { x, y } });
      return;
    }

    if (readOnly) return;

    // ── Resize ─────────────────────────────────────────────────────────────
    if (
      interactionRef.current.resizing &&
      interactionRef.current.resizeInitialEl &&
      interactionRef.current.resizeStartCanvasPos
    ) {
      const el = interactionRef.current.resizeInitialEl;
      const handle = interactionRef.current.resizeHandle!;
      const dx = x - interactionRef.current.resizeStartCanvasPos.x;
      const dy = y - interactionRef.current.resizeStartCanvasPos.y;

      let newX = el.x;
      let newY = el.y;
      let newWidth = el.width;
      let newHeight = el.height;
      const aspect = el.height !== 0 ? el.width / el.height : 1;

      switch (handle) {
        case "se":
          newWidth = Math.max(4, el.width + dx);
          newHeight = Math.max(4, el.height + dy);
          break;
        case "sw":
          newWidth = Math.max(4, el.width - dx);
          newX = el.x + el.width - newWidth;
          newHeight = Math.max(4, el.height + dy);
          break;
        case "ne":
          newWidth = Math.max(4, el.width + dx);
          newHeight = Math.max(4, el.height - dy);
          newY = el.y + el.height - newHeight;
          break;
        case "nw":
          newWidth = Math.max(4, el.width - dx);
          newX = el.x + el.width - newWidth;
          newHeight = Math.max(4, el.height - dy);
          newY = el.y + el.height - newHeight;
          break;
        case "e":
          newWidth = Math.max(4, el.width + dx);
          break;
        case "w":
          newWidth = Math.max(4, el.width - dx);
          newX = el.x + el.width - newWidth;
          break;
        case "s":
          newHeight = Math.max(4, el.height + dy);
          break;
        case "n":
          newHeight = Math.max(4, el.height - dy);
          newY = el.y + el.height - newHeight;
          break;
      }

      if (e.shiftKey) {
        const base = Math.max(newWidth, newHeight);
        newWidth = base;
        newHeight = aspect !== 0 ? base / aspect : base;
        if (handle.includes("w")) {
          newX = el.x + el.width - newWidth;
        }
        if (handle.includes("n")) {
          newY = el.y + el.height - newHeight;
        }
      }

      if (gridEnabled) {
        const snapped = snapPointToGrid({ x: newX, y: newY });
        newX = snapped.x;
        newY = snapped.y;
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

      // Scale points for line/arrow/freedraw
      if (
        (el.type === "arrow" || el.type === "line" || el.type === "freedraw") &&
        el.points &&
        el.points.length > 0 &&
        el.width !== 0 &&
        el.height !== 0
      ) {
        const scaleX = newWidth / el.width;
        const scaleY = newHeight / el.height;
        const scaledPoints = el.points.map((p: Point) => ({
          x: newX + (p.x - el.x) * scaleX,
          y: newY + (p.y - el.y) * scaleY,
        }));
        Object.assign(updatedElement, { points: scaledPoints });
      }

      if (el.id) {
        updateElement(el.id, updatedElement);
      }
      return;
    }

    // ── Rotate ─────────────────────────────────────────────────────────────
    if (
      interactionRef.current.rotating &&
      interactionRef.current.rotateInitialEl
    ) {
      const cx = interactionRef.current.rotateCenterX;
      const cy = interactionRef.current.rotateCenterY;
      // angle from center to cursor; offset by -PI/2 so 0 = pointing up
      const angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;

      const el = interactionRef.current.rotateInitialEl;
      const updatedElement = { ...el, angle };
      if (el.id) {
        updateElement(el.id, updatedElement);
      }
      return;
    }

    // ── Drag selected elements ─────────────────────────────────────────────
    if (
      interactionRef.current.dragging &&
      activeTool === "select" &&
      interactionRef.current.dragStartCanvasPos &&
      interactionRef.current.dragInitialElements
    ) {
      const currentPoint = gridEnabled ? snapPointToGrid({ x, y }) : { x, y };
      const totalDeltaX =
        currentPoint.x - interactionRef.current.dragStartCanvasPos.x;
      const totalDeltaY =
        currentPoint.y - interactionRef.current.dragStartCanvasPos.y;

      interactionRef.current.dragInitialElements.forEach((initialEl, id) => {
        const updatedEl: DriplElement = {
          ...initialEl,
          x: initialEl.x + totalDeltaX,
          y: initialEl.y + totalDeltaY,
        };

        updateElement(id, updatedEl);
      });

      return;
    }

    if (!isDrawing) return;

    if (activeTool === "eraser") {
      setEraserPath((prev) => [...prev, { x, y }]);
      const state = useCanvasStore.getState();
      const candidates = spatialIndex.tree.search({
        minX: x - 20,
        minY: y - 20,
        maxX: x + 20,
        maxY: y + 20,
      });
      candidates.forEach((candidate) => {
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
      isToolDrawing &&
      (activeTool === "rectangle" ||
        activeTool === "ellipse" ||
        activeTool === "diamond" ||
        activeTool === "arrow" ||
        activeTool === "line" ||
        activeTool === "freedraw")
    ) {
      const snapped = snapPointToGrid({ x, y });
      updateDrawing(
        snapped,
        { shiftKey: e.shiftKey || false, altKey: e.altKey, pressure: e.pressure },
        elements,
      );
      return;
    }
  };

  // ── Pointer up ────────────────────────────────────────────────────────────
  const handlePointerUp = (e?: React.PointerEvent) => {
    if (e?.pointerType === "touch") {
      interactionRef.current.touchPointers.delete(e.pointerId);
      if (interactionRef.current.touchPointers.size < 2) {
        interactionRef.current.pinchStartDistance = 0;
        interactionRef.current.pinchStartMid = null;
      }
    }
    setCursorPosition(null);

    // ── End pan ────────────────────────────────────────────────────────────
    if (interactionRef.current.panning) {
      interactionRef.current.panning = false;
      interactionRef.current.panStartClient = null;
      setIsPanning(false);
      if (
        !interactionRef.current.isSpacePressed &&
        activeTool === "hand" &&
        lastToolBeforeSpaceRef.current &&
        lastToolBeforeSpaceRef.current !== "hand"
      ) {
        setActiveTool(lastToolBeforeSpaceRef.current);
      }
      return;
    }

    // ── End marquee ────────────────────────────────────────────────────────
    if (marqueeSelection?.active) {
      const rect = {
        minX: Math.min(marqueeSelection.start.x, marqueeSelection.end.x),
        minY: Math.min(marqueeSelection.start.y, marqueeSelection.end.y),
        maxX: Math.max(marqueeSelection.start.x, marqueeSelection.end.x),
        maxY: Math.max(marqueeSelection.start.y, marqueeSelection.end.y),
      };
      const candidates = spatialIndex.tree.search(rect);
      const hitIds = new Set(candidates.map((candidate) => candidate.id));
      if (e?.shiftKey) {
        setSelectedIds(new Set([...selectedIds, ...hitIds]));
      } else {
        setSelectedIds(hitIds);
      }
      setMarqueeSelection(null);
      return;
    }

    // ── End resize ─────────────────────────────────────────────────────────
    if (interactionRef.current.resizing) {
      const editingId = useCanvasStore.getState().isEditingElementId;
      interactionRef.current.resizing = false;
      interactionRef.current.resizeHandle = null;
      interactionRef.current.resizeStartCanvasPos = null;
      interactionRef.current.resizeInitialEl = null;
      setIsResizing(false);
      setEditingElementId(null); // release edit lock
      if (editingId) unlockElement(editingId);
      unlockGestureElements();
      return;
    }

    // ── End rotate ─────────────────────────────────────────────────────────
    if (interactionRef.current.rotating) {
      const editingId = useCanvasStore.getState().isEditingElementId;
      interactionRef.current.rotating = false;
      interactionRef.current.rotateInitialEl = null;
      setIsRotating(false);
      setEditingElementId(null); // release edit lock
      if (editingId) unlockElement(editingId);
      unlockGestureElements();
      return;
    }

    // ── End drag ───────────────────────────────────────────────────────────
    if (interactionRef.current.dragging) {
      const editingId = useCanvasStore.getState().isEditingElementId;
      interactionRef.current.dragging = false;
      interactionRef.current.dragStartCanvasPos = null;
      interactionRef.current.dragInitialElements = null;
      setIsDragging(false);
      setEditingElementId(null); // release edit lock
      if (editingId) unlockElement(editingId);
      unlockGestureElements();
      return;
    }

    // ── End drawing ────────────────────────────────────────────────────────
    if (isDrawing) {
      if (activeTool === "eraser") {
        const elementsToErase = collectCascadeDeleteIds(eraserHitIdsRef.current);

        if (elementsToErase.length > 0) {
          deleteElements(elementsToErase);
        }

        setEraserPath([]);
        eraserHitIdsRef.current.clear();
        setIsDrawing(false);
        return;
      }

      if (isToolDrawing) {
        const finishedElement = finishDrawing();
        if (finishedElement) {
          const runtimeStore = getRuntimeStore();
          if (runtimeStore) {
            // Runtime store path: commitDraft already appended element, just
            // tell the runtime so it can sync its own snapshot.
            runtimeStore.commit(
              ActionCreator.addElement(finishedElement),
              "IMMEDIATELY",
            );
          }
          if (!toolLocked) {
            setActiveTool("hand");
          }
        }
        setIsDrawing(false);
        return;
      }
      // All drawing tools go through useDrawingTools — no legacy fallback.
      setIsDrawing(false);
    }
  };

  useEffect(() => {
    return () => {
      unlockGestureElements();
    };
  }, [unlockGestureElements]);

  const handleTextSubmit = (text: string) => {
    if (!textInput || !text.trim()) {
      setTextInput(null);
      return;
    }

    const lines = text.split("\n");
    const fontSize = 20;
    const lineHeight = fontSize * 1.25;
    const measuredWidth = Math.max(40, ...lines.map((line) => line.length * (fontSize * 0.55)));
    const measuredHeight = Math.max(lineHeight, lines.length * lineHeight);

    if (textInput.existingElementId) {
      updateElement(textInput.existingElementId, {
        text,
        width: measuredWidth,
        height: measuredHeight,
      } as Partial<DriplElement>);
      setTextInput(null);
      return;
    }

    const textElement: DriplElement = {
      id: textInput.id,
      type: "text",
      x: textInput.x,
      y: textInput.y,
      width: measuredWidth,
      height: measuredHeight,
      strokeColor: currentStrokeColor,
      backgroundColor: "transparent",
      strokeWidth: 1,
      opacity: 1,
      text,
      fontSize,
      fontFamily:
        '"Comic Sans MS", "Chalkboard SE", "Marker Felt", "Comic Neue", cursive',
    };

    addElement(textElement);
    setTextInput(null);
  };

  const fitAllToScreen = useCallback(() => {
    if (!containerRef.current || elements.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach((element) => {
      const bounds = getElementBounds(element);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    });

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = 64;
    const viewportWidth = containerRef.current.clientWidth - padding * 2;
    const viewportHeight = containerRef.current.clientHeight - padding * 2;
    const nextZoom = Math.max(
      0.1,
      Math.min(20, Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight)),
    );
    const nextPanX =
      containerRef.current.clientWidth / 2 - (minX + contentWidth / 2) * nextZoom;
    const nextPanY =
      containerRef.current.clientHeight / 2 - (minY + contentHeight / 2) * nextZoom;

    setZoom(nextZoom);
    setPan(nextPanX, nextPanY);
  }, [elements, setPan, setZoom]);

  const duplicateSelection = useCallback(() => {
    const selected = elements.filter((element) => selectedIds.has(element.id));
    if (selected.length === 0) return;
    const copies = selected.map((element) => ({
      ...element,
      id: uuidv4(),
      x: element.x + 10,
      y: element.y + 10,
    }));
    useCanvasStore.getState().addElements(copies);
    setSelectedIds(new Set(copies.map((element) => element.id)));
  }, [elements, selectedIds, setSelectedIds]);

  const copySelectedToClipboard = useCallback(async () => {
    const selected = elements.filter((element) => selectedIds.has(element.id));
    if (selected.length === 0) return;
    await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
  }, [elements, selectedIds]);

  const pasteFromClipboard = useCallback(async () => {
    if (typeof navigator.clipboard.read === "function") {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("image/png")) {
            const blob = await item.getType("image/png");
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            const img = new Image();
            img.src = dataUrl;
            await new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
            if (img.width > 0 && img.height > 0) {
              addElement({
                id: uuidv4(),
                type: "image",
                x: 40,
                y: 40,
                width: img.width,
                height: img.height,
                strokeColor: "transparent",
                backgroundColor: "transparent",
                strokeWidth: 0,
                opacity: 1,
                src: dataUrl,
              });
            }
            return;
          }
        }
      } catch {
        // fall back to text paste path below
      }
    }

    const text = await navigator.clipboard.readText();
    if (!text) return;

    try {
      const parsed = JSON.parse(text) as unknown;
      let incoming: DriplElement[] = [];
      if (Array.isArray(parsed)) {
        incoming = CanvasContentSchema.parse(parsed) as DriplElement[];
      } else if (
        parsed &&
        typeof parsed === "object" &&
        "elements" in parsed &&
        Array.isArray((parsed as { elements?: unknown }).elements)
      ) {
        incoming = CanvasContentSchema.parse(
          (parsed as { elements: unknown[] }).elements,
        ) as DriplElement[];
      } else {
        return;
      }

      const copies = incoming.map((element) => ({
        ...element,
        id: uuidv4(),
        x: element.x + 10,
        y: element.y + 10,
      }));
      useCanvasStore.getState().addElements(copies);
      setSelectedIds(new Set(copies.map((element) => element.id)));
    } catch {
      // ignore non-dripl clipboard content
    }
  }, [addElement, setSelectedIds]);

  const findOnCanvas = useCallback(
    (rawQuery: string): number => {
      const query = rawQuery.trim().toLowerCase();
      if (!query) return 0;

      const matches = elements.filter((element) => {
        const textContent =
          element.type === "text" && "text" in element ? element.text : "";
        const searchable = [
          element.type,
          element.id,
          textContent,
          element.strokeColor ?? "",
          element.backgroundColor ?? "",
          String(Math.round(element.x)),
          String(Math.round(element.y)),
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(query);
      });

      if (matches.length === 0) {
        return 0;
      }

      setSelectedIds(new Set(matches.map((element) => element.id)));
      const first = matches[0];
      if (first && containerRef.current) {
        const bounds = getElementBounds(first);
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const viewportWidth = containerRef.current.clientWidth;
        const viewportHeight = containerRef.current.clientHeight;
        setPan(
          viewportWidth / 2 - centerX * zoom,
          viewportHeight / 2 - centerY * zoom,
        );
      }

      return matches.length;
    },
    [elements, setPan, setSelectedIds, zoom],
  );

  useEffect(() => {
    const handleFindOnCanvasEvent = (event: Event) => {
      const custom = event as CustomEvent<{ query?: string }>;
      const query = custom.detail?.query;
      if (!query) return;
      const count = findOnCanvas(query);
      if (count === 0) {
        alert("No matching elements found on canvas.");
      } else if (count === 1) {
        alert("Found 1 matching element.");
      } else {
        alert(`Found ${count} matching elements.`);
      }
    };

    window.addEventListener("dripl:find-on-canvas", handleFindOnCanvasEvent);
    return () => {
      window.removeEventListener("dripl:find-on-canvas", handleFindOnCanvasEvent);
    };
  }, [findOnCanvas]);

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
      setContextMenuState({ x: e.clientX - rect.left, y: e.clientY - rect.top, elementId: element.id });
    },
    [getElementAtPosition, readOnly, selectedIds, setSelectedIds, viewport],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();

      if (e.code === "Space") {
        if (!interactionRef.current.isSpacePressed) {
          interactionRef.current.isSpacePressed = true;
          if (activeTool !== "hand") {
            lastToolBeforeSpaceRef.current = activeTool;
            setActiveTool("hand");
          }
        }
        e.preventDefault();
      }

      if (!cmdOrCtrl && !e.altKey && !e.shiftKey) {
        if (key === "v") setActiveTool("select");
        if (key === "r") setActiveTool("rectangle");
        if (key === "o") setActiveTool("ellipse");
        if (key === "p") setActiveTool("freedraw");
        if (key === "l") setActiveTool("line");
        if (key === "a") setActiveTool("arrow");
        if (key === "t") setActiveTool("text");
        if (key === "e") setActiveTool("eraser");
        if (key === "h") setActiveTool("hand");
      }

      if (cmdOrCtrl && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (cmdOrCtrl && key === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (cmdOrCtrl && key === "a") {
        e.preventDefault();
        setSelectedIds(new Set(elements.map((element) => element.id)));
        return;
      }

      if (cmdOrCtrl && key === "f") {
        e.preventDefault();
        const query = window.prompt("Find on canvas", "");
        if (query && query.trim()) {
          const count = findOnCanvas(query);
          if (count === 0) {
            alert("No matching elements found on canvas.");
          }
        }
        return;
      }

      if (cmdOrCtrl && key === "c") {
        e.preventDefault();
        void copySelectedToClipboard();
        return;
      }

      if (cmdOrCtrl && key === "v") {
        if (readOnly) return;
        e.preventDefault();
        void pasteFromClipboard();
        return;
      }

      if (cmdOrCtrl && key === "d") {
        if (readOnly) return;
        e.preventDefault();
        duplicateSelection();
        return;
      }

      if (cmdOrCtrl && key === "g") {
        e.preventDefault();
        setGridEnabled(!useCanvasStore.getState().gridEnabled);
        return;
      }

      if (cmdOrCtrl && e.shiftKey && key === "f") {
        e.preventDefault();
        fitAllToScreen();
        return;
      }

      if (cmdOrCtrl && key === "0") {
        e.preventDefault();
        fitAllToScreen();
        return;
      }

      if (cmdOrCtrl && e.shiftKey && key === "h") {
        e.preventDefault();
        setZoom(1);
        setPan(0, 0);
        return;
      }

      if (key === "[") {
        if (readOnly) return;
        e.preventDefault();
        const ids = Array.from(useCanvasStore.getState().selectedIds);
        if (cmdOrCtrl) sendToBack(ids);
        else sendBackward(ids);
        return;
      }

      if (key === "]") {
        if (readOnly) return;
        e.preventDefault();
        const ids = Array.from(useCanvasStore.getState().selectedIds);
        if (cmdOrCtrl) bringToFront(ids);
        else bringForward(ids);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (readOnly) return;
        const { selectedIds: ids } = useCanvasStore.getState();
        if (ids.size > 0) {
          e.preventDefault();
          const idsArr = collectCascadeDeleteIds(ids);
          deleteElements(idsArr);
          clearSelection();
        }
      }

      if (e.key === "Escape") {
        clearSelection();
        setTextInput(null);
        cancelDrawing();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        interactionRef.current.isSpacePressed = false;
        if (
          activeTool === "hand" &&
          lastToolBeforeSpaceRef.current &&
          lastToolBeforeSpaceRef.current !== "hand"
        ) {
          setActiveTool(lastToolBeforeSpaceRef.current as ActiveTool);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    activeTool,
    bringForward,
    bringToFront,
    deleteElements,
    clearSelection,
    copySelectedToClipboard,
    duplicateSelection,
    fitAllToScreen,
    collectCascadeDeleteIds,
    findOnCanvas,
    pasteFromClipboard,
    redo,
    readOnly,
    sendBackward,
    sendToBack,
    setActiveTool,
    setGridEnabled,
    setPan,
    setSelectedIds,
    setZoom,
    cancelDrawing,
    elements,
    undo,
  ]);

  // ── Mouse wheel zoom ──────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const state = useCanvasStore.getState();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldX = (screenX - state.panX) / state.zoom;
        const worldY = (screenY - state.panY) / state.zoom;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const nextZoom = Math.max(0.1, Math.min(20, state.zoom * factor));
        const nextPanX = screenX - worldX * nextZoom;
        const nextPanY = screenY - worldY * nextZoom;
        setZoom(nextZoom);
        setPan(nextPanX, nextPanY);
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [containerReady, setPan, setZoom]);

  const collaboratorCursors = collaborators;

  return (
    <div
      ref={setContainerRef}
      className="relative w-full h-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={openContextMenu}
      style={{ backgroundColor: "var(--color-canvas-bg)" }}
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

      <CollaboratorsList roomSlug={roomSlug} />

      {!userName && roomSlug !== null && (
        <NameInputModal onSubmit={handleNameSubmit} />
      )}

      <div className="absolute top-6 left-6 z-20">
        <PropertiesPanel
          selectedElement={
            selectedIds.size === 1
              ? elements.find((el) => el.id === Array.from(selectedIds)[0]) ||
                null
              : null
          }
          onUpdateElement={(updatedElement) => {
            if (updatedElement.id) {
              updateElement(updatedElement.id, updatedElement);
            }
          }}
        />
      </div>

      {textInput && (
        <textarea
          ref={(el) => el?.focus()}
          defaultValue={textInput.value ?? ""}
          className="canvas-text-input absolute outline-none resize-none"
          style={{
            left: `${textInput.x * zoom + panX}px`,
            top: `${textInput.y * zoom + panY}px`,
            fontSize: `${20 * zoom}px`,
            lineHeight: 1.4,
            color: "var(--color-default-stroke)",
            background: "transparent",
            border: "1.5px dashed #6965db",
            borderRadius: 2,
            minWidth: "160px",
            minHeight: "28px",
            padding: "2px 4px",
            zIndex: 1000,
          }}
          onBlur={(e) => {
            if (e.target.value.trim()) handleTextSubmit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleTextSubmit(e.currentTarget.value);
            }
            if (e.key === "Escape") setTextInput(null);
          }}
          placeholder="Type text…"
        />
      )}

      {activeTool === "eraser" && cursorPosition && (
        <div
          className="absolute pointer-events-none rounded-full border"
          style={{
            left: `${cursorPosition.x * zoom + panX - 20}px`,
            top: `${cursorPosition.y * zoom + panY - 20}px`,
            width: 40,
            height: 40,
            borderColor: "rgba(255,255,255,0.75)",
            backgroundColor: "rgba(255,255,255,0.08)",
            zIndex: 40,
          }}
        />
      )}

      <div className="absolute top-4 right-4 px-3 py-1 rounded-full text-sm bg-background/80 backdrop-blur-sm border">
        {isConnected ? (
          <span className="text-green-600">● Connected</span>
        ) : (
          <span className="text-red-600">● Disconnected</span>
        )}
      </div>

      {contextMenuState && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          element={elements.find((element) => element.id === contextMenuState.elementId) ?? null}
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
      )}
    </div>
  );
}
