"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import { useCanvasWebSocket } from "@/hooks/useCanvasWebSocket";
import {
  saveLocalCanvasToStorage,
  LocalCanvasState,
  LOCAL_CANVAS_STORAGE_KEYS,
  loadLocalCanvasFromStorage,
} from "@/utils/localCanvasStorage";
import { isPointInElement } from "@dripl/math";
import {
  handleClickSelectionWithElements,
  handleMarqueeSelectionEnd,
} from "@/hooks/useEnhancedSelection";
import { RemoteCursors } from "./RemoteCursors";
import {
  ActionCreator,
  type DriplElement,
  type PointerDownState,
} from "@dripl/common";
import {
  getRuntimeStore,
  updateRuntimeStoreSnapshot,
  snapshotFromState,
} from "@/lib/runtime-store-bridge";
import { getOrCreateCollaboratorName } from "@/utils/username";
import { v4 as uuidv4 } from "uuid";
import { SelectionOverlay, ResizeHandle } from "./SelectionOverlay";
import { NameInputModal } from "./NameInputModal";
import { CollaboratorsList } from "./CollaboratorsList";
import { PropertiesPanel } from "./PropertiesPanel";
import { throttle } from "@dripl/utils";
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

export default function RoughCanvas({ roomSlug, theme }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerReady, setContainerReady] = useState(false);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setContainerReady(!!el);
  }, []);

  const [userName, setUserName] = useState<string | null>(() =>
    getOrCreateCollaboratorName()
  );

  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [currentElement, setCurrentElement] = useState<DriplElement | null>(null);
  const [textInput, setTextInput] = useState<{ x: number; y: number; id: string } | null>(null);
  const [eraserPath, setEraserPath] = useState<Point[]>([]);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<{
    start: Point;
    end: Point;
    active: boolean;
  } | null>(null);

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
  });

  const {
    currentPreview: drawingPreview,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: isToolDrawing,
  } = useDrawingTools();

  const elements = useCanvasStore((state) => state.elements);
  const activeTool = useCanvasStore((state) => state.activeTool);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const currentStrokeColor = useCanvasStore((state) => state.currentStrokeColor);
  const currentStrokeWidth = useCanvasStore((state) => state.currentStrokeWidth);
  const currentRoughness = useCanvasStore((state) => state.currentRoughness);
  const currentBackgroundColor = useCanvasStore((state) => state.currentBackgroundColor);
  const currentStrokeStyle = useCanvasStore((state) => state.currentStrokeStyle);
  const currentFillStyle = useCanvasStore((state) => state.currentFillStyle);

  const setElements = useCanvasStore((state) => state.setElements);
  const addElement = useCanvasStore((state) => state.addElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const deleteElements = useCanvasStore((state) => state.deleteElements);
  const setSelectedIds = useCanvasStore((state) => state.setSelectedIds);
  const selectElement = useCanvasStore((state) => state.selectElement);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const pushHistory = useCanvasStore((state) => state.pushHistory);

  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);
  const setPan = useCanvasStore((state) => state.setPan);
  const setZoom = useCanvasStore((state) => state.setZoom);

  const { send, isConnected } = useCanvasWebSocket(roomSlug, userName);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledSend = useCallback(
    throttle((data: any) => {
      if (isConnected) send(data);
    }, 50),
    [isConnected, send]
  );

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
    roomSlug, elements, selectedIds, theme, zoom, panX, panY,
    currentStrokeColor, currentBackgroundColor, currentStrokeWidth,
    currentRoughness, currentStrokeStyle, currentFillStyle, activeTool,
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

    const handleVisibilityOrBlur = () => { if (document.hidden) flushToStorage(); };
    const handleBeforeUnload = () => flushToStorage();

    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        (event.key !== LOCAL_CANVAS_STORAGE_KEYS.CANVAS &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.STATE &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.STRUCTURED)
      ) return;

      const { elements: savedElements, appState, selectedIds: savedSelectedIds } =
        loadLocalCanvasFromStorage();

      if (savedElements && savedElements.length) {
        setElements(savedElements);
        updateRuntimeStoreSnapshot(snapshotFromState(savedElements, savedSelectedIds ?? []));
      }
      if (savedSelectedIds?.length) setSelectedIds(new Set(savedSelectedIds));
      if (appState) {
        if (appState.zoom) setZoom(appState.zoom);
        if (appState.panX !== undefined && appState.panY !== undefined) setPan(appState.panX, appState.panY);
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
    [panX, panY, zoom]
  );

  const getElementAtPosition = useCallback(
    (x: number, y: number): DriplElement | null => {
      const state = useCanvasStore.getState();
      for (let i = state.elements.length - 1; i >= 0; i--) {
        const element = state.elements[i];
        if (element && isPointInElement({ x, y }, element)) return element;
      }
      return null;
    },
    []
  );

  // ── Element creation ──────────────────────────────────────────────────────
  const createElement = useCallback(
    (x: number, y: number): DriplElement | null => {
      const baseProps = {
        id: uuidv4(),
        x,
        y,
        strokeColor: currentStrokeColor,
        backgroundColor: currentBackgroundColor,
        strokeWidth: currentStrokeWidth,
        opacity: 1,
        roughness: currentRoughness,
        strokeStyle: currentStrokeStyle,
        fillStyle: currentFillStyle,
        seed: Math.floor(Math.random() * 1000000),
      };

      switch (activeTool) {
        case "rectangle":
          return { ...baseProps, type: "rectangle", width: 0, height: 0 };
        case "ellipse":
          return { ...baseProps, type: "ellipse", width: 0, height: 0 };
        case "arrow":
          return { ...baseProps, type: "arrow", width: 0, height: 0, points: [{ x, y }] };
        case "line":
          return { ...baseProps, type: "line", width: 0, height: 0, points: [{ x, y }] };
        case "freedraw":
          return { ...baseProps, type: "freedraw", width: 0, height: 0, points: [{ x, y }] };
        default:
          return null;
      }
    },
    [activeTool, currentStrokeColor, currentBackgroundColor, currentStrokeWidth, currentRoughness, currentStrokeStyle, currentFillStyle]
  );

  // ── Resize start ──────────────────────────────────────────────────────────
  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation();
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find((el) => el.id === selectedIdsArray[0]);
      if (!element) return;

      const startPos = getCanvasCoordinates(e);

      // Deep clone element to freeze it as the baseline
      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

      interactionRef.current.resizing = true;
      interactionRef.current.resizeHandle = handle;
      interactionRef.current.resizeStartCanvasPos = startPos;
      interactionRef.current.resizeInitialEl = frozenEl;

      setIsResizing(true);
      setResizeHandle(handle);

      // Capture pointer on the canvas so we still get events outside
      const canvas = containerRef.current?.querySelector("canvas:last-child") as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    [getCanvasCoordinates]
  );

  // ── Rotate start ──────────────────────────────────────────────────────────
  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const state = useCanvasStore.getState();
      const selectedIdsArray = Array.from(state.selectedIds);
      if (selectedIdsArray.length !== 1) return;

      const element = state.elements.find((el) => el.id === selectedIdsArray[0]);
      if (!element) return;

      const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;

      interactionRef.current.rotating = true;
      interactionRef.current.rotateInitialEl = frozenEl;
      interactionRef.current.rotateCenterX = cx;
      interactionRef.current.rotateCenterY = cy;

      setIsRotating(true);

      const canvas = containerRef.current?.querySelector("canvas:last-child") as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
    },
    []
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
              pushHistory();
              send({ type: "add_element", element, timestamp: Date.now() });
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

    const { x, y } = getCanvasCoordinates(e);

    throttledSend({ type: "cursor_move", x, y, userName: userName ?? undefined, timestamp: Date.now() });

    if (activeTool === "hand") {
      interactionRef.current.panning = true;
      interactionRef.current.panStartClient = { x: e.clientX, y: e.clientY };
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (activeTool === "select") {
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
          if (idsToTrack.has(el.id)) snapshot.set(el.id, JSON.parse(JSON.stringify(el)));
        });

        interactionRef.current.dragging = true;
        interactionRef.current.dragStartCanvasPos = { x, y };
        interactionRef.current.dragInitialElements = snapshot;

        setIsDragging(true);
      } else {
        if (!e.shiftKey) clearSelection();
        setMarqueeSelection({ start: { x, y }, end: { x, y }, active: true });
      }
      return;
    }

    if (activeTool === "text") {
      setTextInput({ x, y, id: uuidv4() });
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
                pushHistory();
                send({ type: "add_element", element, timestamp: Date.now() });
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
        e.shiftKey,
        {
          strokeColor: currentStrokeColor,
          backgroundColor: currentBackgroundColor,
          strokeWidth: currentStrokeWidth,
          opacity: 1,
          roughness: currentRoughness,
          strokeStyle: currentStrokeStyle,
          fillStyle: currentFillStyle,
        },
        elements
      );
      setIsDrawing(true);
      return;
    }

    const element = createElement(x, y);
    if (element) {
      setCurrentElement(element);
      setIsDrawing(true);
    }
  };

  // ── Pointer move ──────────────────────────────────────────────────────────
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(e);
    setCursorPosition({ x, y });
    throttledSend({ type: "cursor_move", x, y, userName: userName ?? undefined, timestamp: Date.now() });

    // ── Panning ────────────────────────────────────────────────────────────
    if (interactionRef.current.panning && interactionRef.current.panStartClient) {
      const dx = e.clientX - interactionRef.current.panStartClient.x;
      const dy = e.clientY - interactionRef.current.panStartClient.y;
      setPan(panX + dx, panY + dy);
      interactionRef.current.panStartClient = { x: e.clientX, y: e.clientY };
      return;
    }

    // ── Marquee selection ──────────────────────────────────────────────────
    if (marqueeSelection?.active) {
      setMarqueeSelection({ ...marqueeSelection, end: { x, y } });
      return;
    }

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

      const updatedElement: DriplElement = { ...el, x: newX, y: newY, width: newWidth, height: newHeight };

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
        (updatedElement as any).points = el.points.map((p: Point) => ({
          x: newX + (p.x - el.x) * scaleX,
          y: newY + (p.y - el.y) * scaleY,
        }));
      }

      if (el.id) {
        updateElement(el.id, updatedElement);
        throttledSend({ type: "update_element", element: updatedElement, timestamp: Date.now() });
      }
      return;
    }

    // ── Rotate ─────────────────────────────────────────────────────────────
    if (interactionRef.current.rotating && interactionRef.current.rotateInitialEl) {
      const cx = interactionRef.current.rotateCenterX;
      const cy = interactionRef.current.rotateCenterY;
      // angle from center to cursor; offset by -PI/2 so 0 = pointing up
      const angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;

      const el = interactionRef.current.rotateInitialEl;
      const updatedElement = { ...el, angle };
      if (el.id) {
        updateElement(el.id, updatedElement);
        throttledSend({ type: "update_element", element: updatedElement, timestamp: Date.now() });
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
      const totalDeltaX = x - interactionRef.current.dragStartCanvasPos.x;
      const totalDeltaY = y - interactionRef.current.dragStartCanvasPos.y;

      interactionRef.current.dragInitialElements.forEach((initialEl, id) => {
        const updatedEl: DriplElement = {
          ...initialEl,
          x: initialEl.x + totalDeltaX,
          y: initialEl.y + totalDeltaY,
        };

        // Also move points for line/arrow/freedraw
        if (
          (initialEl.type === "arrow" || initialEl.type === "line" || initialEl.type === "freedraw") &&
          initialEl.points
        ) {
          (updatedEl as any).points = initialEl.points.map((p: Point) => ({
            x: p.x + totalDeltaX,
            y: p.y + totalDeltaY,
          }));
        }

        updateElement(id, updatedEl);
        throttledSend({ type: "update_element", element: updatedEl, timestamp: Date.now() });
      });

      return;
    }

    if (!isDrawing) return;

    if (activeTool === "eraser") {
      setEraserPath((prev) => [...prev, { x, y }]);
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
      updateDrawing({ x, y }, e.shiftKey || false, elements);
      return;
    }

    if (currentElement) {
      if (activeTool === "rectangle" || activeTool === "ellipse") {
        setCurrentElement({ ...currentElement, width: x - currentElement.x, height: y - currentElement.y });
      } else if (activeTool === "arrow" || activeTool === "line" || activeTool === "freedraw") {
        if ("points" in currentElement) {
          const points = [...currentElement.points, { x, y }];
          const minX = Math.min(...points.map((p) => p.x));
          const minY = Math.min(...points.map((p) => p.y));
          const maxX = Math.max(...points.map((p) => p.x));
          const maxY = Math.max(...points.map((p) => p.y));
          setCurrentElement({ ...currentElement, points, width: maxX - minX, height: maxY - minY });
        }
      }
    }
  };

  // ── Pointer up ────────────────────────────────────────────────────────────
  const handlePointerUp = (e?: React.PointerEvent) => {
    setCursorPosition(null);

    // ── End pan ────────────────────────────────────────────────────────────
    if (interactionRef.current.panning) {
      interactionRef.current.panning = false;
      interactionRef.current.panStartClient = null;
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    // ── End marquee ────────────────────────────────────────────────────────
    if (marqueeSelection?.active) {
      handleMarqueeSelectionEnd(
        marqueeSelection,
        elements,
        (value) => {
          if (typeof value === "function") {
            const nextSet = (value as (prev: Set<string>) => Set<string>)(selectedIds);
            setSelectedIds(nextSet);
          } else {
            setSelectedIds(value);
          }
        },
        e?.shiftKey || false
      );
      setMarqueeSelection(null);
      return;
    }

    // ── End resize ─────────────────────────────────────────────────────────
    if (interactionRef.current.resizing) {
      interactionRef.current.resizing = false;
      interactionRef.current.resizeHandle = null;
      interactionRef.current.resizeStartCanvasPos = null;
      interactionRef.current.resizeInitialEl = null;
      setIsResizing(false);
      setResizeHandle(null);
      pushHistory();
      return;
    }

    // ── End rotate ─────────────────────────────────────────────────────────
    if (interactionRef.current.rotating) {
      interactionRef.current.rotating = false;
      interactionRef.current.rotateInitialEl = null;
      setIsRotating(false);
      pushHistory();
      return;
    }

    // ── End drag ───────────────────────────────────────────────────────────
    if (interactionRef.current.dragging) {
      interactionRef.current.dragging = false;
      interactionRef.current.dragStartCanvasPos = null;
      interactionRef.current.dragInitialElements = null;
      setIsDragging(false);
      pushHistory();
      return;
    }

    // ── End drawing ────────────────────────────────────────────────────────
    if (isDrawing) {
      if (activeTool === "eraser") {
        const elementsToErase: string[] = [];
        elements.forEach((element) => {
          for (const point of eraserPath) {
            if (isPointInElement(point, element)) {
              if (element.id) elementsToErase.push(element.id);
              break;
            }
          }
        });

        if (elementsToErase.length > 0) {
          deleteElements(elementsToErase);
          pushHistory();
          elementsToErase.forEach((elementId) =>
            send({ type: "delete_element", elementId, timestamp: Date.now() })
          );
        }

        setEraserPath([]);
        setIsDrawing(false);
        return;
      }

      if (isToolDrawing) {
        const finishedElement = finishDrawing();
        if (finishedElement) {
          const runtimeStore = getRuntimeStore();
          if (runtimeStore) {
            runtimeStore.commit(ActionCreator.addElement(finishedElement), "IMMEDIATELY");
          } else {
            addElement(finishedElement);
            pushHistory();
          }
          send({ type: "add_element", element: finishedElement, timestamp: Date.now() });
        }
        setIsDrawing(false);
        return;
      }

      if (currentElement) {
        addElement(currentElement);
        pushHistory();
        send({ type: "add_element", element: currentElement, timestamp: Date.now() });
        setCurrentElement(null);
      }
      setIsDrawing(false);
    }
  };

  const handleTextSubmit = (text: string) => {
    if (!textInput || !text.trim()) {
      setTextInput(null);
      return;
    }

    const textElement: DriplElement = {
      id: textInput.id,
      type: "text",
      x: textInput.x,
      y: textInput.y,
      width: 200,
      height: 24,
      strokeColor: currentStrokeColor,
      backgroundColor: "transparent",
      strokeWidth: 1,
      opacity: 1,
      text,
      fontSize: 20,
      fontFamily: "Caveat",
    };

    addElement(textElement);
    pushHistory();
    send({ type: "add_element", element: textElement, timestamp: Date.now() });
    setTextInput(null);
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedIds: ids } = useCanvasStore.getState();
        if (ids.size > 0) {
          e.preventDefault();
          const idsArr = Array.from(ids);
          deleteElements(idsArr);
          clearSelection();
          pushHistory();
          idsArr.forEach((id) =>
            throttledSend({ type: "delete_element", elementId: id, timestamp: Date.now() })
          );
        }
      }

      if (e.key === "Escape") {
        clearSelection();
        setTextInput(null);
        cancelDrawing();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteElements, clearSelection, pushHistory, throttledSend, cancelDrawing]);

  // ── Mouse wheel zoom ──────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        setZoom(Math.max(0.1, Math.min(5, useCanvasStore.getState().zoom + delta)));
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [containerReady, setZoom]);

  return (
    <div
      ref={setContainerRef}
      className="relative w-full h-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ backgroundColor: "var(--color-canvas-bg)" }}
    >
      {containerReady && (
        <DualCanvas
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
          elements={elements}
          selectedIds={selectedIds}
          currentPreview={currentElement || drawingPreview}
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
        />
      )}

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

      <RemoteCursors />
      <CollaboratorsList roomSlug={roomSlug} />

      {!userName && roomSlug !== null && (
        <NameInputModal onSubmit={handleNameSubmit} />
      )}

      <div className="absolute top-6 left-6 z-20">
        <PropertiesPanel
          selectedElement={
            selectedIds.size === 1
              ? elements.find((el) => el.id === Array.from(selectedIds)[0]) || null
              : null
          }
          onUpdateElement={(updatedElement) => {
            if (updatedElement.id) {
              updateElement(updatedElement.id, updatedElement);
              send({ type: "update_element", element: updatedElement, timestamp: Date.now() });
            }
          }}
        />
      </div>

      {textInput && (
        <textarea
          ref={(el) => el?.focus()}
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

      <div className="absolute top-4 right-4 px-3 py-1 rounded-full text-sm bg-background/80 backdrop-blur-sm border">
        {isConnected ? (
          <span className="text-green-600">● Connected</span>
        ) : (
          <span className="text-red-600">● Disconnected</span>
        )}
      </div>
    </div>
  );
}