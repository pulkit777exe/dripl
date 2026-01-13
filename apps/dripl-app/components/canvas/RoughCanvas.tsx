"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import { useCanvasWebSocket } from "@/hooks/useCanvasWebSocket";
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
import { throttle } from "@dripl/utils";
import { useCanvasRenderer } from "./CanvasRenderer";
import { screenToCanvas, Viewport } from "@/utils/canvas-coordinates";
import { useDrawingTools } from "@/hooks/useDrawingTools";

interface Point {
  x: number;
  y: number;
}

interface CanvasProps {
  roomSlug: string;
}

export default function RoughCanvas({ roomSlug }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const containerRef = useRef<HTMLDivElement>(null!);

  const [userName, setUserName] = useState<string | null>(null);

  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [initialElement, setInitialElement] = useState<DriplElement | null>(
    null
  );
  const [currentElement, setCurrentElement] = useState<DriplElement | null>(
    null
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

  // Drawing tools hook
  const {
    currentPreview: drawingPreview,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDrawing: isToolDrawing,
  } = useDrawingTools();

  // Store
  const elements = useCanvasStore((state) => state.elements);
  const activeTool = useCanvasStore((state) => state.activeTool);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const currentStrokeColor = useCanvasStore(
    (state) => state.currentStrokeColor
  );
  const currentStrokeWidth = useCanvasStore(
    (state) => state.currentStrokeWidth
  );
  const currentRoughness = useCanvasStore((state) => state.currentRoughness);
  const currentBackgroundColor = useCanvasStore(
    (state) => state.currentBackgroundColor
  );
  const currentStrokeStyle = useCanvasStore(
    (state) => state.currentStrokeStyle
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

  const { send, isConnected } = useCanvasWebSocket(roomSlug, userName);

  // Throttle cursor updates to avoid flooding websocket
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledSend = useCallback(
    throttle((data: any) => {
      if (isConnected) send(data);
    }, 50),
    [isConnected, send]
  );

  // Try to load name from localStorage or session?
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

  // Viewport for renderer
  const viewport: Viewport = {
    x: panX,
    y: panY,
    width: containerRef.current?.clientWidth || 0,
    height: containerRef.current?.clientHeight || 0,
    zoom,
  };

  // Use new canvas renderer with requestAnimationFrame
  useCanvasRenderer({
    canvasRef,
    containerRef,
    elements,
    selectedIds,
    currentPreview: currentElement || drawingPreview,
    eraserPath,
    viewport,
  });

  // Get canvas coordinates from mouse event using coordinate transformation
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent | React.PointerEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      return screenToCanvas(e.clientX - rect.left, e.clientY - rect.top, viewport);
    },
    [viewport]
  );

  // Find element at position (Hit Testing)
  const getElementAtPosition = (x: number, y: number): DriplElement | null => {
    // Iterate in reverse to find top-most element first
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      if (element && isPointInElement({ x, y }, element)) {
        return element;
      }
    }
    return null;
  };

  // Create element based on tool
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
    ]
  );

  // Resize Handler
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
    [selectedIds, elements, getCanvasCoordinates]
  );

  // Rotate Handler
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
    [selectedIds, elements]
  );

  // Handle Drag & Drop
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
              // Scale down if too large
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

  // Handle pointer down
  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    const { x, y } = coords;

    // Broadcast cursor
    throttledSend({ type: "cursor_move", x, y, timestamp: Date.now() });

    // Handle Space key for panning
    if (e.button === 1 || activeTool === "select") {
      // Just a placeholder for panning logic
    }

    if (activeTool === "select") {
      const element = getElementAtPosition(x, y);
      if (element) {
        // Click on element - start dragging or toggle selection
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
        // Click on empty space - start marquee selection
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

    if (activeTool === "eraser") {
      setIsDrawing(true);
      setEraserPath([{ x, y }]);
      return;
    }

    // Use new drawing tools for shape tools
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

    // Fallback for other tools
    const element = createElement(x, y);
    if (element) {
      setCurrentElement(element);
      setIsDrawing(true);
    }
  };

  // Handle pointer move
  const handlePointerMove = (
    e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent
  ) => {
    const coords = getCanvasCoordinates(e);
    const { x, y } = coords;

    throttledSend({ type: "cursor_move", x, y, timestamp: Date.now() });

    // Update marquee selection
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

      // Calculate new bounds based on handle
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

      // Scale points for linear elements
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

        updatedElement.points = initialElement.points.map((p) => ({
          x: newX + (p.x - initialElement.x) * scaleX,
          y: newY + (p.y - initialElement.y) * scaleY,
        }));
      }

      updateElement(el.id, updatedElement);
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

      updateElement(initialElement.id, updatedElement);
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

      // Move selected elements
      elements.forEach((el) => {
        if (selectedIds.has(el.id)) {
          const updatedElement = {
            ...el,
            x: el.x + dx,
            y: el.y + dy,
          };

          // Move points for path based elements
          if ("points" in updatedElement && updatedElement.points) {
            updatedElement.points = updatedElement.points.map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }));
          }

          updateElement(el.id, updatedElement);

          // Broadcast update (throttled in real app, here direct)
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

    // Update drawing tools
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

    // Fallback for old tool implementation
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

  // Handle pointer up
  const handlePointerUp = (e?: React.PointerEvent) => {
    // End marquee selection
    if (marqueeSelection?.active) {
      handleMarqueeSelectionEnd(
        marqueeSelection,
        elements,
        setSelectedIds,
        e?.shiftKey || false
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
        // Eraser logic (omitted intersection check for brevity, assumed separate function or same logic)
        // ... Re-implementing simplified logic here or using helper
        // Since I'm overwriting, I should include the logic.

        // Find elements intersecting eraser path
        // I need to implement findElementsInEraserPath logic again or reuse
        const elementsToErase: string[] = [];
        elements.forEach((element) => {
          // Check intersection (simplified for now to bounding box)
          // Real implementation would use segment intersection
          // For now let's just use point in element
          for (const point of eraserPath) {
            if (isPointInElement(point, element)) {
              elementsToErase.push(element.id);
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

      // Finish drawing with new tools
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

      // Fallback for old implementation
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

  // Text submit handler
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

  // Viewport size update handler
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
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair"
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

      {!userName && <NameInputModal onSubmit={handleNameSubmit} />}

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

      {/* Basic Connection Status */}
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
