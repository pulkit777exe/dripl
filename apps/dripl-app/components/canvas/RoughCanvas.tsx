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
import {
  captureDragBaseline,
  applyDeltaToBaseline,
  mergeDragPreview,
} from "@/utils/dragBaseline";
import { getOrCreateCollaboratorName } from "@/utils/username";
import { v4 as uuidv4 } from "uuid";
import { SelectionOverlay, ResizeHandle } from "./SelectionOverlay";
import { NameInputModal } from "./NameInputModal";
import { CollaboratorsList } from "./CollaboratorsList";
import { PropertiesPanel } from "./PropertiesPanel";
import { throttle } from "@dripl/utils";
import { useCanvasRenderer } from "./CanvasRenderer";
import { screenToCanvas, Viewport } from "@/utils/canvas-coordinates";
import { useDrawingTools } from "@/hooks/useDrawingTools";
import { DualCanvas } from "./DualCanvas";

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
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [initialElement, setInitialElement] = useState<DriplElement | null>(
    null,
  );
  const [currentElement, setCurrentElement] = useState<DriplElement | null>(
    null,
  );
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [eraserPath, setEraserPath] = useState<Point[]>([]);
  const [lastPointerPos, setLastPointerPos] = useState<Point | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<{
    start: Point;
    end: Point;
    active: boolean;
  } | null>(null);
  const [dragBaseline, setDragBaseline] = useState<PointerDownState | null>(
    null,
  );
  const [dragTotalDelta, setDragTotalDelta] = useState<Point | null>(null);

  const {
    currentPreview: drawingPreview,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: isToolDrawing,
  } = useDrawingTools();

  // ── Interaction refs — avoid stale closures and React re-render latency ──
  // These are mutated directly on every pointermove for zero-lag interaction.
  const interactionRef = useRef<{
    // Resize
    resizing: boolean;
    resizeHandle: ResizeHandle | null;
    resizeStartPos: Point | null; // canvas coords at pointerdown
    resizeInitialEl: DriplElement | null; // frozen snapshot at pointerdown
    // Drag
    dragging: boolean;
    dragStartPos: Point | null; // canvas coords at pointerdown
    // Rotate
    rotating: boolean;
    rotateInitialEl: DriplElement | null;
  }>({
    resizing: false,
    resizeHandle: null,
    resizeStartPos: null,
    resizeInitialEl: null,
    dragging: false,
    dragStartPos: null,
    rotating: false,
    rotateInitialEl: null,
  });

  const elements = useCanvasStore((state) => state.elements);
  const activeTool = useCanvasStore((state) => state.activeTool);
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
    if (roomSlug !== null) {
      return;
    }

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
      if (document.hidden) {
        flushToStorage();
      }
    };

    const handleBeforeUnload = () => {
      flushToStorage();
    };

    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        (event.key !== LOCAL_CANVAS_STORAGE_KEYS.CANVAS &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.STATE &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.STRUCTURED)
      ) {
        return;
      }

      const {
        elements: savedElements,
        appState,
        selectedIds: savedSelectedIds,
      } = loadLocalCanvasFromStorage();

      if (savedElements && savedElements.length) {
        setElements(savedElements);
        updateRuntimeStoreSnapshot(
          snapshotFromState(savedElements, savedSelectedIds ?? []),
        );
      }
      if (savedSelectedIds?.length) {
        setSelectedIds(new Set(savedSelectedIds));
      }

      if (appState) {
        if (appState.zoom) setZoom(appState.zoom);
        if (appState.panX !== undefined && appState.panY !== undefined) {
          setPan(appState.panX, appState.panY);
        }
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

  const { send, isConnected } = useCanvasWebSocket(roomSlug, userName);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledSend = useCallback(
    throttle((data: any) => {
      if (isConnected) send(data);
    }, 50),
    [isConnected, send],
  );

  useEffect(() => {
    const stored = getOrCreateCollaboratorName();
    setUserName(stored);
  }, []);

  const handleNameSubmit = (name: string) => {
    setUserName(name);
    localStorage.setItem("dripl_username", name);
  };

  const viewport: Viewport = {
    x: panX,
    y: panY,
    width: containerRef.current?.clientWidth || 0,
    height: containerRef.current?.clientHeight || 0,
    zoom,
  };

  // NOTE: DualCanvas now handles rendering internally
  // Removed useCanvasRenderer hook - now using DualCanvas component

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): Point => {
      // Use the event target (the canvas that received the event) for correct coordinates
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
    [viewport],
  );

  const getElementAtPosition = (x: number, y: number): DriplElement | null => {
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      if (element && isPointInElement({ x, y }, element)) {
        return element;
      }
    }
    return null;
  };

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
          return {
            ...baseProps,
            type: "arrow",
            width: 0,
            height: 0,
            points: [{ x, y }],
          };
        case "line":
          return {
            ...baseProps,
            type: "line",
            width: 0,
            height: 0,
            points: [{ x, y }],
          };
        case "freedraw":
          return {
            ...baseProps,
            type: "freedraw",
            width: 0,
            height: 0,
            points: [{ x, y }],
          };
        default:
          return null;
      }
    },
    [
      activeTool,
      currentStrokeColor,
      currentBackgroundColor,
      currentStrokeWidth,
      currentRoughness,
      currentStrokeStyle,
      currentFillStyle,
    ],
  );

  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      e.stopPropagation();
      const selectedIdsArray = Array.from(selectedIds);
      if (selectedIdsArray.length === 1) {
        const element = elements.find((el) => el.id === selectedIdsArray[0]);
        if (element) {
          const startPos = getCanvasCoordinates(e);
          // Write to ref immediately — no setState lag
          interactionRef.current.resizing = true;
          interactionRef.current.resizeHandle = handle;
          interactionRef.current.resizeStartPos = startPos;
          interactionRef.current.resizeInitialEl = JSON.parse(
            JSON.stringify(element),
          );
          setIsResizing(true);
          setResizeHandle(handle);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }
    },
    [selectedIds, elements, getCanvasCoordinates],
  );

  const handleRotateStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const selectedIdsArray = Array.from(selectedIds);
      if (selectedIdsArray.length === 1) {
        const element = elements.find((el) => el.id === selectedIdsArray[0]);
        if (element) {
          interactionRef.current.rotating = true;
          interactionRef.current.rotateInitialEl = JSON.parse(
            JSON.stringify(element),
          );
          setIsRotating(true);
          setInitialElement(JSON.parse(JSON.stringify(element)));
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }
    },
    [selectedIds, elements],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

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
              send({
                type: "add_element",
                element,
                timestamp: Date.now(),
              });
            };
            img.src = event.target.result as string;
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Check if event is from a UI element by checking if the target is not the canvas
    const target = e.target as HTMLElement;
    if (target.classList.contains("pointer-events-auto")) {
      return;
    }

    const coords = getCanvasCoordinates(e);
    const { x, y } = coords;

    throttledSend({
      type: "cursor_move",
      x,
      y,
      userName: userName ?? undefined,
      timestamp: Date.now(),
    });

    // Hand tool panning
    if (activeTool === "hand") {
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
          if (!selectedIds.has(element.id)) {
            setSelectedIds(new Set([element.id]));
          }
        }
        // Capture drag start in ref for zero-lag tracking
        interactionRef.current.dragging = true;
        interactionRef.current.dragStartPos = { x, y };
        setDragBaseline(
          captureDragBaseline(
            { x, y },
            selectedIds.has(element.id) ? selectedIds : new Set([element.id]),
            elements,
            e.pointerId ?? 0,
          ),
        );
        setDragTotalDelta({ x: 0, y: 0 });
        setIsDragging(true);
        setLastPointerPos({ x, y });
      } else {
        if (!e.shiftKey) {
          clearSelection();
        }
        setMarqueeSelection({
          start: { x, y },
          end: { x, y },
          active: true,
        });
      }
      return;
    }

    if (activeTool === "text") {
      const id = uuidv4();
      setTextInput({ x, y, id });
      return;
    }

    if (activeTool === "image") {
      // Trigger file input for image upload
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
                send({
                  type: "add_element",
                  element,
                  timestamp: Date.now(),
                });
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
        elements,
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

  const handlePointerMove = (
    e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent,
  ) => {
    const coords = getCanvasCoordinates(e);
    const { x, y } = coords;

    // Update cursor position for interactive layer
    setCursorPosition(coords);

    throttledSend({
      type: "cursor_move",
      x,
      y,
      userName: userName ?? undefined,
      timestamp: Date.now(),
    });

    // Hand tool panning
    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPan(panX + dx, panY + dy);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (marqueeSelection?.active) {
      setMarqueeSelection({
        ...marqueeSelection,
        end: { x, y },
      });
      return;
    }

    // ── Resize (ref-based total-delta from frozen start) ─────────────────
    if (
      interactionRef.current.resizing &&
      interactionRef.current.resizeInitialEl &&
      interactionRef.current.resizeStartPos
    ) {
      const el = interactionRef.current.resizeInitialEl;
      const handle = interactionRef.current.resizeHandle!;
      // Total delta from the frozen pointer-down position
      const dx = x - interactionRef.current.resizeStartPos.x;
      const dy = y - interactionRef.current.resizeStartPos.y;

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
        el.points.length > 0
      ) {
        const scaleX = el.width === 0 ? 1 : newWidth / el.width;
        const scaleY = el.height === 0 ? 1 : newHeight / el.height;
        (updatedElement as any).points = el.points.map((p: Point) => ({
          x: newX + (p.x - el.x) * scaleX,
          y: newY + (p.y - el.y) * scaleY,
        }));
      }

      if (el.id) {
        updateElement(el.id, updatedElement);
      }
      throttledSend({
        type: "update_element",
        element: updatedElement,
        timestamp: Date.now(),
      });
      return;
    }

    // ── Rotate ────────────────────────────────────────────────────────────
    if (
      interactionRef.current.rotating &&
      interactionRef.current.rotateInitialEl
    ) {
      const el = interactionRef.current.rotateInitialEl;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      // atan2 gives 0 at east; we want 0 at north so offset by -PI/2
      const angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;

      const updatedElement = { ...el, angle };
      if (el.id) {
        updateElement(el.id, updatedElement);
      }
      throttledSend({
        type: "update_element",
        element: updatedElement,
        timestamp: Date.now(),
      });
      return;
    }

    // ── Drag selected elements (immediate visual update) ─────────────────
    if (
      interactionRef.current.dragging &&
      activeTool === "select" &&
      interactionRef.current.dragStartPos &&
      dragBaseline
    ) {
      const totalDelta = {
        x: x - interactionRef.current.dragStartPos.x,
        y: y - interactionRef.current.dragStartPos.y,
      };
      setDragTotalDelta(totalDelta);
      setLastPointerPos({ x, y });
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
        const width = x - currentElement.x;
        const height = y - currentElement.y;
        setCurrentElement({ ...currentElement, width, height });
      } else if (
        activeTool === "arrow" ||
        activeTool === "line" ||
        activeTool === "freedraw"
      ) {
        if ("points" in currentElement) {
          const points = [...currentElement.points, { x, y }];
          const minX = Math.min(...points.map((p) => p.x));
          const minY = Math.min(...points.map((p) => p.y));
          const maxX = Math.max(...points.map((p) => p.x));
          const maxY = Math.max(...points.map((p) => p.y));

          setCurrentElement({
            ...currentElement,
            points,
            width: maxX - minX,
            height: maxY - minY,
          });
        }
      }
    }
  };

  const handlePointerUp = (e?: React.PointerEvent) => {
    // Clear cursor position when pointer is released
    setCursorPosition(null);

    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (marqueeSelection?.active) {
      handleMarqueeSelectionEnd(
        marqueeSelection,
        elements,
        (value) => {
          if (typeof value === "function") {
            const nextSet = (value as (prev: Set<string>) => Set<string>)(
              selectedIds,
            );
            setSelectedIds(nextSet);
          } else {
            setSelectedIds(value);
          }
        },
        e?.shiftKey || false,
      );
      setMarqueeSelection(null);
      return;
    }

    if (isResizing) {
      interactionRef.current.resizing = false;
      interactionRef.current.resizeHandle = null;
      interactionRef.current.resizeStartPos = null;
      interactionRef.current.resizeInitialEl = null;
      setIsResizing(false);
      setResizeHandle(null);
      setInitialElement(null);
      pushHistory();
      return;
    }

    if (isRotating) {
      interactionRef.current.rotating = false;
      interactionRef.current.rotateInitialEl = null;
      setIsRotating(false);
      setInitialElement(null);
      pushHistory();
      return;
    }

    if (isDragging) {
      interactionRef.current.dragging = false;
      interactionRef.current.dragStartPos = null;
      if (dragBaseline && dragTotalDelta) {
        const finalElements = applyDeltaToBaseline(
          dragBaseline,
          dragTotalDelta,
        );
        const runtimeStore = getRuntimeStore();
        if (runtimeStore) {
          const actions = finalElements.map((el) =>
            ActionCreator.updateElement(el.id, el),
          );
          runtimeStore.commitBatch(actions, "CAPTURE_ONCE");
        } else {
          finalElements.forEach((el) => updateElement(el.id, el));
          pushHistory();
        }
        finalElements.forEach((el) => {
          throttledSend({
            type: "update_element",
            element: el,
            timestamp: Date.now(),
          });
        });
      }
      setDragBaseline(null);
      setDragTotalDelta(null);
      setIsDragging(false);
      setLastPointerPos(null);
      return;
    }

    if (isDrawing) {
      if (activeTool === "eraser") {
        const elementsToErase: string[] = [];
        elements.forEach((element) => {
          for (const point of eraserPath) {
            if (isPointInElement(point, element)) {
              if (element.id) {
                elementsToErase.push(element.id);
              }
              break;
            }
          }
        });

        if (elementsToErase.length > 0) {
          deleteElements(elementsToErase);
          pushHistory();
          elementsToErase.forEach((elementId) => {
            send({
              type: "delete_element",
              elementId,
              timestamp: Date.now(),
            });
          });
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
            runtimeStore.commit(
              ActionCreator.addElement(finishedElement),
              "IMMEDIATELY",
            );
          } else {
            addElement(finishedElement);
            pushHistory();
          }
          send({
            type: "add_element",
            element: finishedElement,
            timestamp: Date.now(),
          });
        }
        setIsDrawing(false);
        return;
      }

      if (currentElement) {
        addElement(currentElement);
        pushHistory();
        send({
          type: "add_element",
          element: currentElement,
          timestamp: Date.now(),
        });
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
    send({
      type: "add_element",
      element: textElement,
      timestamp: Date.now(),
    });
    setTextInput(null);
  };

  useEffect(() => {
    const updateViewportSize = () => {
      if (containerRef.current) {
        // Viewport size is updated in the renderer
      }
    };
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedIds: ids, elements: els } = useCanvasStore.getState();
        if (ids.size > 0) {
          e.preventDefault();
          const idsArr = Array.from(ids);
          deleteElements(idsArr);
          clearSelection();
          pushHistory();
          idsArr.forEach((id) => {
            throttledSend({
              type: "delete_element",
              elementId: id,
              timestamp: Date.now(),
            });
          });
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
  }, [
    deleteElements,
    clearSelection,
    pushHistory,
    throttledSend,
    cancelDrawing,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        setZoom(
          Math.max(0.1, Math.min(5, useCanvasStore.getState().zoom + delta)),
        );
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [containerReady, setZoom]);

  const elementsForRender = useMemo(() => {
    if (dragBaseline && dragTotalDelta) {
      return mergeDragPreview(elements, dragBaseline, dragTotalDelta);
    }
    return elements;
  }, [elements, dragBaseline, dragTotalDelta]);

  return (
    <div
      ref={setContainerRef}
      className="relative w-full h-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        backgroundColor: "var(--color-canvas-bg)",
      }}
    >
      {/* Dual Canvas - Static + Interactive layers; only mount when container is ready so pointer events work */}
      {containerReady && (
        <DualCanvas
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
          elements={elementsForRender}
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
        elements={elementsForRender}
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
              ? elements.find((el) => el.id === Array.from(selectedIds)[0]) ||
                null
              : null
          }
          onUpdateElement={(updatedElement) => {
            if (updatedElement.id) {
              updateElement(updatedElement.id, updatedElement);
              send({
                type: "update_element",
                element: updatedElement,
                timestamp: Date.now(),
              });
            }
          }}
        />
      </div>

      {textInput && (
        <textarea
          ref={(el) => el?.focus()}
          // canvas-text-input class forces Caveat font (see globals.css)
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
            if (e.target.value.trim()) {
              handleTextSubmit(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleTextSubmit(e.currentTarget.value);
            }
            if (e.key === "Escape") {
              setTextInput(null);
            }
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
