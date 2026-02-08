"use client";

import { useRef, useEffect, useState, useCallback } from "react";
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
import type { DriplElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import { SelectionOverlay, ResizeHandle } from "./SelectionOverlay";
import { NameInputModal } from "./NameInputModal";
import { CollaboratorsList } from "./CollaboratorsList";
import { PropertiesPanel } from "./PropertiesPanel";
import { throttle } from "@dripl/utils";
import { useCanvasRenderer } from "./CanvasRenderer";
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
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const containerRef = useRef<HTMLDivElement>(null!);

  const [userName, setUserName] = useState<string | null>(null);

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
  const [marqueeSelection, setMarqueeSelection] = useState<{
    start: Point;
    end: Point;
    active: boolean;
  } | null>(null);

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

      console.log("Local canvas mode: saving to storage");
      console.log("Elements to save:", elements);
      console.log("State to save:", appState);

      const timeoutId = setTimeout(() => {
        saveLocalCanvasToStorage(elements, appState);
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [
    roomSlug,
    elements,
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

      saveLocalCanvasToStorage(state.elements, appState);
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
        (event.key !== LOCAL_CANVAS_STORAGE_KEYS.LOCAL_CANVAS_ELEMENTS &&
          event.key !== LOCAL_CANVAS_STORAGE_KEYS.LOCAL_CANVAS_STATE)
      ) {
        return;
      }

      const { elements: savedElements, appState } =
        loadLocalCanvasFromStorage();

      if (savedElements && savedElements.length) {
        setElements(savedElements);
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
    const storedName = localStorage.getItem("dripl_username");
    if (storedName) {
      setUserName(storedName);
    }
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

  useCanvasRenderer({
    canvasRef,
    containerRef,
    elements,
    selectedIds,
    currentPreview: currentElement || drawingPreview,
    eraserPath,
    viewport,
    theme,
  });

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      return screenToCanvas(
        e.clientX - rect.left,
        e.clientY - rect.top,
        viewport,
      );
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
          setIsResizing(true);
          setResizeHandle(handle);
          setInitialElement(JSON.parse(JSON.stringify(element)));
          setLastPointerPos(getCanvasCoordinates(e));
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

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Check if event is from a UI element by checking if the target is not the canvas
    if (e.target !== canvasRef.current) {
      return;
    }

    // Check if click is on any UI element by checking event path
    if (
      e.nativeEvent.composedPath().some((el) => {
        const domElement = el as HTMLElement;
        return (
          domElement.classList &&
          domElement.classList.contains("pointer-events-auto")
        );
      })
    ) {
      return;
    }

    const coords = getCanvasCoordinates(e);
    const { x, y } = coords;

    throttledSend({ type: "cursor_move", x, y, timestamp: Date.now() });

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

    throttledSend({ type: "cursor_move", x, y, timestamp: Date.now() });

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

    if (isResizing && initialElement && resizeHandle) {
      const el = initialElement;
      let newX = el.x;
      let newY = el.y;
      let newWidth = el.width;
      let newHeight = el.height;

      switch (resizeHandle) {
        case "se":
          newWidth = Math.max(1, x - el.x);
          newHeight = Math.max(1, y - el.y);
          break;
        case "sw":
          newWidth = Math.max(1, el.x + el.width - x);
          newX = el.x + el.width - newWidth;
          newHeight = Math.max(1, y - el.y);
          break;
        case "ne":
          newWidth = Math.max(1, x - el.x);
          newHeight = Math.max(1, el.y + el.height - y);
          newY = el.y + el.height - newHeight;
          break;
        case "nw":
          newWidth = Math.max(1, el.x + el.width - x);
          newX = el.x + el.width - newWidth;
          newHeight = Math.max(1, el.y + el.height - y);
          newY = el.y + el.height - newHeight;
          break;
        case "e":
          newWidth = Math.max(1, x - el.x);
          break;
        case "w":
          newWidth = Math.max(1, el.x + el.width - x);
          newX = el.x + el.width - newWidth;
          break;
        case "s":
          newHeight = Math.max(1, y - el.y);
          break;
        case "n":
          newHeight = Math.max(1, el.y + el.height - y);
          newY = el.y + el.height - newHeight;
          break;
      }

      const updatedElement = {
        ...el,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      };

      if (
        "points" in updatedElement &&
        initialElement &&
        "points" in initialElement &&
        initialElement.points &&
        (initialElement.type === "arrow" ||
          initialElement.type === "line" ||
          initialElement.type === "freedraw")
      ) {
        const scaleX =
          initialElement.width === 0 ? 1 : newWidth / initialElement.width;
        const scaleY =
          initialElement.height === 0 ? 1 : newHeight / initialElement.height;

        updatedElement.points = initialElement.points.map(
          (p: { x: number; y: number }) => ({
            x: newX + (p.x - initialElement.x) * scaleX,
            y: newY + (p.y - initialElement.y) * scaleY,
          }),
        );
      }

      if (el.id) {
        updateElement(el.id, updatedElement);
      }
      send({
        type: "update_element",
        element: updatedElement,
        timestamp: Date.now(),
      });
      return;
    }

    if (isRotating && initialElement) {
      const cx = initialElement.x + initialElement.width / 2;
      const cy = initialElement.y + initialElement.height / 2;
      const angle = Math.atan2(y - cy, x - cx);
      const adjustedAngle = angle + Math.PI / 2;

      const updatedElement = {
        ...initialElement,
        angle: adjustedAngle,
      };

      if (initialElement.id) {
        updateElement(initialElement.id, updatedElement);
      }
      send({
        type: "update_element",
        element: updatedElement,
        timestamp: Date.now(),
      });
      return;
    }

    if (isDragging && activeTool === "select" && lastPointerPos) {
      const dx = x - lastPointerPos.x;
      const dy = y - lastPointerPos.y;

      elements.forEach((el) => {
        if (el.id && selectedIds.has(el.id)) {
          const updatedElement = {
            ...el,
            x: el.x + dx,
            y: el.y + dy,
          };

          if ("points" in updatedElement && updatedElement.points) {
            updatedElement.points = updatedElement.points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
          }

          if (el.id) {
            updateElement(el.id, updatedElement);
          }

          send({
            type: "update_element",
            element: updatedElement,
            timestamp: Date.now(),
          });
        }
      });

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
      setIsResizing(false);
      setResizeHandle(null);
      setInitialElement(null);
      pushHistory();
      return;
    }

    if (isRotating) {
      setIsRotating(false);
      setInitialElement(null);
      pushHistory();
      return;
    }

    if (isDragging) {
      setIsDragging(false);
      setLastPointerPos(null);
      pushHistory();
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
          addElement(finishedElement);
          pushHistory();
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
      fontSize: 16,
      fontFamily: "Inter",
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

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        backgroundColor: theme === "dark" ? "#121212" : "#f8f9fa",
      }}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${
          activeTool === "hand"
            ? isPanning
              ? "cursor-grabbing"
              : "cursor-grab"
            : activeTool === "select"
              ? "cursor-default"
              : activeTool === "text"
                ? "cursor-text"
                : "cursor-crosshair"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />

      <SelectionOverlay
        zoom={zoom}
        panX={panX}
        panY={panY}
        onResizeStart={handleResizeStart}
        onRotateStart={handleRotateStart}
        marqueeSelection={marqueeSelection}
      />

      <RemoteCursors />

      <CollaboratorsList />

      {!userName && roomSlug !== null && (
        <NameInputModal onSubmit={handleNameSubmit} />
      )}

      <div className="absolute top-6 right-6 z-20">
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
          autoFocus
          className="absolute border-2 border-blue-500 bg-transparent outline-none resize-none"
          style={{
            left: `${textInput.x * zoom + panX}px`,
            top: `${textInput.y * zoom + panY}px`,
            fontSize: "16px",
            fontFamily: "Inter",
            color: currentStrokeColor,
            minWidth: "200px",
            minHeight: "24px",
          }}
          onBlur={(e) => handleTextSubmit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleTextSubmit(e.currentTarget.value);
            }
            if (e.key === "Escape") {
              setTextInput(null);
            }
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
    </div>
  );
}
