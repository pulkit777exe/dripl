"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useCanvasStore } from "@/lib/canvas-store";
import { useCanvasWebSocket } from "@/hooks/useCanvasWebSocket";
import {
  createRoughCanvas,
  renderRoughElements,
  isPointInElement,
} from "@dripl/element";
import { RemoteCursors } from "./RemoteCursors";
import type { DriplElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import { SelectionOverlay, ResizeHandle } from "./SelectionOverlay";
import { NameInputModal } from "./NameInputModal";
import { CollaboratorsList } from "./CollaboratorsList";
import { throttle } from "@dripl/utils";

interface Point {
  x: number;
  y: number;
}

interface CanvasProps {
  roomSlug: string;
}

export default function RoughCanvas({ roomSlug }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roughCanvasRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Initialize Rough.js canvas
  useEffect(() => {
    if (canvasRef.current && !roughCanvasRef.current) {
      roughCanvasRef.current = createRoughCanvas(canvasRef.current);
    }
  }, []);

  // Render elements
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const rc = roughCanvasRef.current;

    if (!canvas || !ctx || !rc) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply transformations
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Render all elements
    renderRoughElements(rc, ctx, elements);

    // Render current drawing element
    if (currentElement) {
      renderRoughElements(rc, ctx, [currentElement]);
    }

    // Render selection highlights
    if (selectedIds.size > 0) {
      ctx.save();
      ctx.strokeStyle = "#6965db";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      elements.forEach((el) => {
        if (selectedIds.has(el.id)) {
          // Draw bounding box
          // Using simple bounds for now (can enhance with getElementBounds)
          const padding = 4 / zoom;
          ctx.strokeRect(
            el.x - padding,
            el.y - padding,
            el.width + padding * 2,
            el.height + padding * 2
          );
        }
      });
      ctx.restore();
    }

    // Render eraser trail
    if (eraserPath.length > 0) {
      ctx.strokeStyle = "#ff0000";
      ctx.lineWidth = 10 / zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.3;

      ctx.beginPath();
      ctx.moveTo(eraserPath[0]!.x, eraserPath[0]!.y);
      for (let i = 1; i < eraserPath.length; i++) {
        ctx.lineTo(eraserPath[i]!.x, eraserPath[i]!.y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }, [elements, currentElement, eraserPath, selectedIds, zoom, panX, panY]);

  // Get canvas coordinates from mouse event
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.DragEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - panX) / zoom;
      const y = (e.clientY - rect.top - panY) / zoom;
      return { x, y };
    },
    [zoom, panX, panY]
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
  const handlePointerUp = () => {
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

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
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
