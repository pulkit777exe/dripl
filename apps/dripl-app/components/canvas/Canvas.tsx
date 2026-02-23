"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Lock,
  Hand,
  MousePointer2,
  Square,
  Circle,
  ArrowRight,
  Minus,
  Type,
  Image,
  Eraser,
  Menu,
  Share2,
  HelpCircle,
  Plus,
  Undo,
  Redo,
  Trash2,
  Copy,
  Link,
  Layers,
  AlignCenter,
  MoreHorizontal,
  FolderOpen,
  Save,
  Download,
  Users,
  Search,
  RotateCcw,
  Github,
  Twitter,
  MessageCircle,
  LogIn,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  X,
  BookOpen,
  ExternalLink,
  Youtube,
  Keyboard,
  Edit3,
  Library,
  Globe,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { IconButton } from "../button/IconButton";
import type { DriplElement, Point } from "@dripl/common";
import type { AppState } from "@/types/canvas";
import {
  drawShape,
  isPointInElement,
  getElementBounds,
  exportToPNG,
  exportToJSON,
  importFromJSON,
  generateId,
  saveToLocalStorage,
  loadFromLocalStorage,
} from "@/utils/canvasUtils";
import { CanvasHistory } from "@/utils/canvasHistory";
import { EraserTrail } from "../../eraser/EraserTrail";
import { ColorSwatch } from "./ColorSwatch";
import { SectionLabel } from "./SectionLabel";
import { MenuItem } from "./MenuItem";
import { MenuSeparator } from "./MenuSeparator";
import HelpModal from "./HelpModal";

export default function App() {
  const [activeTool, setActiveTool] = useState("text");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { theme, setTheme, effectiveTheme } = useTheme();

  const [elements, setElements] = useState<DriplElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [canvasBg, setCanvasBg] = useState<string>(() => {
    console.log("Canvas.tsx canvasBg initializer");
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const themeParam = params.get("theme");
      console.log("Canvas.tsx theme parameter:", themeParam);
      if (themeParam === "dark") {
        return "#121112"; // matches --color-canvas-bg in dark mode
      } else if (themeParam === "light") {
        return "#f7f5f6"; // matches --color-canvas-bg in light mode
      }
    }
    const canvasBgDefault = effectiveTheme === "dark" ? "#121112" : "#f7f5f6";
    console.log("Canvas.tsx fallback canvasBg:", canvasBgDefault);
    return canvasBgDefault;
  });

  useEffect(() => {
    console.log("Canvas.tsx useEffect effectiveTheme:", effectiveTheme);
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get("theme");
    if (themeParam === "dark") {
      setCanvasBg("#121112"); // matches --color-canvas-bg in dark mode
    } else if (themeParam === "light") {
      setCanvasBg("#f7f5f6"); // matches --color-canvas-bg in light mode
    } else {
      setCanvasBg(effectiveTheme === "dark" ? "#121112" : "#f7f5f6");
    }
  }, [effectiveTheme]);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentElement, setCurrentElement] = useState<DriplElement | null>(
    null,
  );
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  const [isMoving, setIsMoving] = useState(false);
  const [moveStart, setMoveStart] = useState<Point | null>(null);
  const [moveOffset, setMoveOffset] = useState<Point>({ x: 0, y: 0 });
  const [isRotating, setIsRotating] = useState(false);
  const [rotateStart, setRotateStart] = useState<{
    angle: number;
    elementId: string;
  } | null>(null);
  const [rotateOffset, setRotateOffset] = useState(0);

  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{
    point: Point;
    element: DriplElement;
  } | null>(null);

  const [strokeColor, setStrokeColor] = useState("#ffffff");
  const [backgroundColor, setBackgroundColor] = useState("transparent");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeStyle, setStrokeStyle] = useState<"solid" | "dashed" | "dotted">(
    "solid",
  );
  const [sloppiness, setSloppiness] = useState(1);
  const [edges, setEdges] = useState<"sharp" | "round">("round");
  const [opacity, setOpacity] = useState(100);
  const [tick, setTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef(new CanvasHistory());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eraserTrailRef = useRef<EraserTrail | null>(null);

  useEffect(() => {
    const { elements: savedElements, appState } = loadFromLocalStorage();

    if (savedElements) {
      setElements(savedElements);
      historyRef.current = new CanvasHistory();
      historyRef.current.pushState({
        elements: savedElements,
        selectedIds: [],
      });
    }

    if (appState) {
      if (appState.theme) setTheme(appState.theme as any);
      if (appState.viewBackgroundColor)
        setCanvasBg(appState.viewBackgroundColor);
      if (appState.scrollX !== undefined && appState.scrollY !== undefined) {
        setPan({ x: appState.scrollX, y: appState.scrollY });
      }
      if (appState.zoom) setZoom(appState.zoom.value);

      if (appState.currentItemStrokeColor)
        setStrokeColor(appState.currentItemStrokeColor);
      if (appState.currentItemBackgroundColor)
        setBackgroundColor(appState.currentItemBackgroundColor);
      if (appState.currentItemStrokeWidth)
        setStrokeWidth(appState.currentItemStrokeWidth);
      if (appState.currentItemStrokeStyle)
        setStrokeStyle(appState.currentItemStrokeStyle as any);
      if (appState.currentItemOpacity) setOpacity(appState.currentItemOpacity);
      if (appState.currentItemRoughness)
        setSloppiness(appState.currentItemRoughness);
      if (appState.currentItemRoundness)
        setEdges(appState.currentItemRoundness === "round" ? "round" : "sharp");
    }
  }, []);

  useEffect(() => {
    const appState: Partial<AppState> = {
      theme,
      viewBackgroundColor: canvasBg,
      scrollX: pan.x,
      scrollY: pan.y,
      zoom: { value: zoom },
      currentItemStrokeColor: strokeColor,
      currentItemBackgroundColor: backgroundColor,
      currentItemStrokeWidth: strokeWidth,
      currentItemStrokeStyle: strokeStyle,
      currentItemOpacity: opacity,
      currentItemRoughness: sloppiness,
      currentItemRoundness: edges,
      activeTool: {
        type: activeTool,
        customType: null,
        locked: false,
        lastActiveTool: null,
      },
    };

    const timeoutId = setTimeout(() => {
      saveToLocalStorage(elements, appState);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [
    elements,
    theme,
    canvasBg,
    pan,
    zoom,
    strokeColor,
    backgroundColor,
    strokeWidth,
    strokeStyle,
    opacity,
    sloppiness,
    edges,
    activeTool,
  ]);

  const strokeColors = [
    "#ffc9c9",
    "#b2f2bb",
    "#a5d8ff",
    "#ffec99",
    "#ffffff",
    "#ffa8a8",
    "#69db7c",
    "#4dabf7",
    "#ffd43b",
  ];
  const bgColors = [
    "transparent",
    "#ffc9c9",
    "#b2f2bb",
    "#a5d8ff",
    "#ffec99",
    "#ffa8a8",
    "#69db7c",
    "#4dabf7",
  ];
  const canvasBgColors = [
    "#121112", // Dark canvas bg (matches --color-canvas-bg dark)
    "#f7f5f6", // Light canvas bg (matches --color-canvas-bg light)
    "#ffffff", // Pure white
    "#2d3a2e", // Dark green tint
    "#3a2e2d", // Dark warm tint
    "#2e2e3a", // Dark cool tint
  ];

  const selectedElement =
    selectedIds.length === 1
      ? elements.find((el) => el.id === selectedIds[0])
      : null;

  const saveHistory = useCallback(() => {
    historyRef.current.pushState({ elements, selectedIds });
  }, [elements, selectedIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom / 100, zoom / 100);

    elements.forEach((element) => {
      const isSelected = selectedIds.includes(element.id);

      let renderElement = element;
      if (isMoving && isSelected) {
        renderElement = {
          ...element,
          x: element.x + moveOffset.x,
          y: element.y + moveOffset.y,
          points: element.points?.map((p: Point) => ({
            x: p.x + moveOffset.x,
            y: p.y + moveOffset.y,
          })),
        };
      } else if (
        isRotating &&
        rotateStart &&
        element.id === rotateStart.elementId
      ) {
        renderElement = {
          ...element,
          rotation: (element.rotation || 0) + rotateOffset,
        };
      }

      drawShape(ctx, renderElement, isSelected);
    });

    if (currentElement) {
      drawShape(ctx, currentElement, false);
    }

    if (!eraserTrailRef.current) {
      eraserTrailRef.current = new EraserTrail(ctx);
    }

    eraserTrailRef.current?.render(pan, zoom / 100);

    ctx.restore();
  }, [
    elements,
    selectedIds,
    currentElement,
    zoom,
    pan,
    isMoving,
    moveOffset,
    isRotating,
    rotateOffset,
    rotateStart,
    tick,
  ]);

  useEffect(() => {
    if (activeTool === "eraser" && isDrawing) {
      let animationFrameId: number;

      const loop = () => {
        setTick((t) => t + 1);
        animationFrameId = requestAnimationFrame(loop);
      };

      loop();

      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    }
  }, [activeTool, isDrawing]);

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left - pan.x) * 100) / zoom;
      const y = ((e.clientY - rect.top - pan.y) * 100) / zoom;

      return { x, y };
    },
    [zoom, pan],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      console.log("handleMouseDown triggered", e.button, "Active tool:", activeTool);
      const toolToUse = activeTool;
      
      const canvasPoint = getCanvasPoint(e);
      const point = getCanvasPoint(e);

      if (toolToUse === "hand") {
        setIsPanning(true);
        setPanStart(canvasPoint);
        return;
      }

      if (toolToUse === "eraser") {
        eraserTrailRef.current?.startPath(canvasPoint.x, canvasPoint.y);
        setIsDrawing(true);
        return;
      }

      if (toolToUse === "select") {
        const clickedElement = [...elements]
          .reverse()
          .find((el) => isPointInElement(canvasPoint, el));

        if (clickedElement) {
          if (e.shiftKey) {
            setSelectedIds((prev) => [...prev, clickedElement.id]);
          } else if (!selectedIds.includes(clickedElement.id)) {
            setSelectedIds([clickedElement.id]);
          }
        } else {
          setSelectedIds([]);
        }
        return;
      }

      setIsDrawing(true);
      setStartPoint(canvasPoint);

      const newElement: DriplElement = {
        id: generateId(),
        type: toolToUse as any,
        x: canvasPoint.x,
        y: canvasPoint.y,
        width: 0,
        height: 0,
        strokeColor,
        backgroundColor,
        strokeWidth,
        strokeStyle,
        opacity,
        roughness: sloppiness,
        roundness: edges === "round" ? 1 : 0,
        points: ["arrow", "line", "freedraw"].includes(toolToUse)
          ? [canvasPoint]
          : undefined,
        text: toolToUse === "text" ? "Text" : undefined,
        fontSize: 16,
        fontFamily: "Arial",
      };

      setCurrentElement(newElement);
    },
    [
      activeTool,
      elements,
      selectedIds,
      strokeColor,
      backgroundColor,
      strokeWidth,
      strokeStyle,
      opacity,
      sloppiness,
      edges,
      getCanvasPoint,
    ],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, handle: string, elementId: string) => {
      e.stopPropagation();
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      setIsResizing(true);
      setResizeHandle(handle);
      setResizeStart({ point, element: { ...element } });
    },
    [elements],
  );

  const handleResize = useCallback(
    (e: React.MouseEvent) => {
      if (!isResizing || !resizeStart || !resizeHandle) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const currentPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const dx = ((currentPoint.x - resizeStart.point.x) * 100) / zoom;
      const dy = ((currentPoint.y - resizeStart.point.y) * 100) / zoom;

      const original = resizeStart.element;
      let newX = original.x;
      let newY = original.y;
      let newWidth = original.width;
      let newHeight = original.height;

      if (resizeHandle.includes("left")) {
        newX = original.x + dx;
        newWidth = original.width - dx;
      }
      if (resizeHandle.includes("right")) {
        newWidth = original.width + dx;
      }
      if (resizeHandle.includes("top")) {
        newY = original.y + dy;
        newHeight = original.height - dy;
      }
      if (resizeHandle.includes("bottom")) {
        newHeight = original.height + dy;
      }

      if (newWidth < 0) {
        newX += newWidth;
        newWidth = Math.abs(newWidth);
      }
      if (newHeight < 0) {
        newY += newHeight;
        newHeight = Math.abs(newHeight);
      }

      setElements((prev) =>
        prev.map((el) => {
          if (el.id === original.id) {
            return {
              ...el,
              x: newX,
              y: newY,
              width: newWidth,
              height: newHeight,
            };
          }
          return el;
        }),
      );
    },
    [isResizing, resizeStart, resizeHandle, zoom],
  );

  const handleResizeEnd = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      setResizeHandle(null);
      setResizeStart(null);
      saveHistory();
    }
  }, [isResizing, saveHistory]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isResizing) {
        handleResize(e);
        return;
      }

      if (isMoving && moveStart && selectedIds.length > 0) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const currentPoint = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          };

          const dx = ((currentPoint.x - moveStart.x) * 100) / zoom;
          const dy = ((currentPoint.y - moveStart.y) * 100) / zoom;

          setMoveOffset({ x: dx, y: dy });
        }
        return;
      }

      if (isRotating && rotateStart) {
        const element = elements.find((el) => el.id === rotateStart.elementId);
        if (element) {
          const bounds = getElementBounds(element);
          const centerX = bounds.x + bounds.width / 2;
          const centerY = bounds.y + bounds.height / 2;

          const canvas = canvasRef.current;
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left - pan.x) * 100) / zoom;
            const mouseY = ((e.clientY - rect.top - pan.y) * 100) / zoom;

            const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
            const deltaAngle = currentAngle - rotateStart.angle;

            setRotateOffset(deltaAngle);
          }
        }
        return;
      }

      const point = getCanvasPoint(e);

      if (isPanning && panStart) {
        const dx = point.x - panStart.x;
        const dy = point.y - panStart.y;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        return;
      }

      if (activeTool === "eraser" && isDrawing) {
        eraserTrailRef.current?.addPoint(point.x, point.y);

        const elementsToRemove: string[] = [];
        elements.forEach((element) => {
          if (isPointInElement(point, element)) {
            elementsToRemove.push(element.id);
          }
        });

        if (elementsToRemove.length > 0) {
          setElements((prev) =>
            prev.filter((el) => !elementsToRemove.includes(el.id)),
          );
        }
        return;
      }

      if (isDrawing && startPoint && currentElement) {
        const updatedElement = { ...currentElement };

        if (["arrow", "line", "freedraw"].includes(activeTool)) {
          updatedElement.points = [...(updatedElement.points || []), point];
        } else {
          const width = point.x - startPoint.x;
          const height = point.y - startPoint.y;

          updatedElement.x = width < 0 ? point.x : startPoint.x;
          updatedElement.y = height < 0 ? point.y : startPoint.y;
          updatedElement.width = Math.abs(width);
          updatedElement.height = Math.abs(height);
        }

        setCurrentElement(updatedElement);
      }
    },
    [
      isDrawing,
      isPanning,
      isResizing,
      isMoving,
      isRotating,
      handleResize,
      moveStart,
      rotateStart,
      selectedIds,
      elements,
      startPoint,
      panStart,
      currentElement,
      activeTool,
      zoom,
      pan,
      getCanvasPoint,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (activeTool === "eraser" && isDrawing) {
      eraserTrailRef.current?.endPath();
      setIsDrawing(false);
      saveHistory();
      return;
    }

    if (isResizing) {
      handleResizeEnd();
      return;
    }

    if (isMoving) {
      setElements((prev) =>
        prev.map((el) => {
          if (selectedIds.includes(el.id)) {
            return {
              ...el,
              x: el.x + moveOffset.x,
              y: el.y + moveOffset.y,
              points: el.points?.map((p: Point) => ({
                x: p.x + moveOffset.x,
                y: p.y + moveOffset.y,
              })),
            };
          }
          return el;
        }),
      );

      setIsMoving(false);
      setMoveStart(null);
      setMoveOffset({ x: 0, y: 0 });
      saveHistory();
      return;
    }

    if (isRotating) {
      setElements((prev) =>
        prev.map((el) => {
          if (rotateStart && el.id === rotateStart.elementId) {
            return {
              ...el,
              rotation: (el.rotation || 0) + rotateOffset,
            };
          }
          return el;
        }),
      );

      setIsRotating(false);
      setRotateStart(null);
      setRotateOffset(0);
      saveHistory();
      return;
    }

     console.log("handleMouseUp called", isDrawing, currentElement);
     if (isDrawing && currentElement) {
      const hasSize =
        currentElement.type === "text" ||
        currentElement.width > 5 ||
        currentElement.height > 5 ||
        (currentElement.points && currentElement.points.length > 1);

      if (hasSize) {
        // For text elements, set default dimensions if not provided
        const elementToAdd = currentElement.type === "text" && (!currentElement.width || !currentElement.height) 
          ? {
              ...currentElement,
              width: 200,
              height: 24
            }
          : currentElement;
          
        setElements((prev) => [...prev, elementToAdd]);
        saveHistory();
      }

      setIsDrawing(false);
      setStartPoint(null);
      setCurrentElement(null);
    }
  }, [isDrawing, isPanning, isMoving, isRotating, currentElement, saveHistory]);

  const handleMoveStart = useCallback(
    (e: React.MouseEvent, elementId: string) => {
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      setIsMoving(true);
      setMoveStart(point);
    },
    [],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isMoving || !moveStart || selectedIds.length === 0) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const currentPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const dx = ((currentPoint.x - moveStart.x) * 100) / zoom;
      const dy = ((currentPoint.y - moveStart.y) * 100) / zoom;

      setElements((prev) =>
        prev.map((el) => {
          if (selectedIds.includes(el.id)) {
            return {
              ...el,
              x: el.x + dx,
              y: el.y + dy,
              points: el.points?.map((p: Point) => ({ x: p.x + dx, y: p.y + dy })),
            };
          }
          return el;
        }),
      );

      setMoveStart(currentPoint);
    },
    [isMoving, moveStart, selectedIds, zoom],
  );

  const handleMoveEnd = useCallback(() => {
    if (isMoving) {
      setIsMoving(false);
      setMoveStart(null);
      saveHistory();
    }
  }, [isMoving, saveHistory]);

  const handleRotateStart = useCallback(
    (e: React.MouseEvent, elementId: string) => {
      e.stopPropagation();
      const element = elements.find((el) => el.id === elementId);
      if (!element) return;

      const bounds = getElementBounds(element);
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left - pan.x) * 100) / zoom;
      const mouseY = ((e.clientY - rect.top - pan.y) * 100) / zoom;

      const angle = Math.atan2(mouseY - centerY, mouseX - centerX);

      setIsRotating(true);
      setRotateStart({ angle, elementId });
    },
    [elements, zoom, pan],
  );

  const handleRotate = useCallback(
    (e: React.MouseEvent) => {
      if (!isRotating || !rotateStart) return;

      const element = elements.find((el) => el.id === rotateStart.elementId);
      if (!element) return;

      const bounds = getElementBounds(element);
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left - pan.x) * 100) / zoom;
      const mouseY = ((e.clientY - rect.top - pan.y) * 100) / zoom;

      const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
      const deltaAngle = currentAngle - rotateStart.angle;

      setElements((prev) =>
        prev.map((el) => {
          if (el.id === rotateStart.elementId) {
            return {
              ...el,
              rotation: (el.rotation || 0) + deltaAngle,
            };
          }
          return el;
        }),
      );

      setRotateStart({ angle: currentAngle, elementId: rotateStart.elementId });
    },
    [isRotating, rotateStart, elements, zoom, pan],
  );

  const handleRotateEnd = useCallback(() => {
    if (isRotating) {
      setIsRotating(false);
      setRotateStart(null);
      saveHistory();
    }
  }, [isRotating, saveHistory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "v" || e.key === "1") setActiveTool("select");
      if (e.key === "h") setActiveTool("hand");
      if (e.key === "r" || e.key === "2") setActiveTool("rectangle");
      if (e.key === "d" || e.key === "3") setActiveTool("diamond");
      if (e.key === "o" || e.key === "4") setActiveTool("ellipse");
      if (e.key === "a" || e.key === "5") setActiveTool("arrow");
      if (e.key === "l" || e.key === "6") setActiveTool("line");
      if (e.key === "p" || e.key === "7") setActiveTool("draw");
      if (e.key === "t" || e.key === "8") setActiveTool("text");
      if (e.key === "e" || e.key === "0") setActiveTool("eraser");

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length > 0) {
          setElements((prev) =>
            prev.filter((el) => !selectedIds.includes(el.id)),
          );
          setSelectedIds([]);
          saveHistory();
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          const state = historyRef.current.undo();
          if (state) {
            setElements(state.elements);
            setSelectedIds(state.selectedIds);
          }
        }
        if ((e.key === "z" && e.shiftKey) || e.key === "y") {
          e.preventDefault();
          const state = historyRef.current.redo();
          if (state) {
            setElements(state.elements);
            setSelectedIds(state.selectedIds);
          }
        }

        if (e.key === "a") {
          e.preventDefault();
          setSelectedIds(elements.map((el) => el.id));
        }

        if (e.key === "c" && selectedIds.length > 0) {
          e.preventDefault();
          const selectedElements = elements.filter((el) =>
            selectedIds.includes(el.id),
          );
          localStorage.setItem("clipboard", JSON.stringify(selectedElements));
        }

        if (e.key === "v") {
          e.preventDefault();
          const clipboard = localStorage.getItem("clipboard");
          if (clipboard) {
            const copiedElements = JSON.parse(clipboard) as DriplElement[];
            const newElements = copiedElements.map((el) => ({
              ...el,
              id: generateId(),
              x: el.x + 20,
              y: el.y + 20,
            }));
            setElements((prev) => [...prev, ...newElements]);
            setSelectedIds(newElements.map((el) => el.id));
            saveHistory();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, elements, saveHistory]);

  useEffect(() => {
    if (selectedElement) {
      setStrokeColor(selectedElement.strokeColor ?? "");
      setBackgroundColor(selectedElement.backgroundColor ?? "");
      setStrokeWidth(selectedElement.strokeWidth ?? 1);
      setStrokeStyle(selectedElement.strokeStyle ?? "solid");
      setSloppiness(selectedElement.roughness ?? 1);
      const roundnessValue =
        typeof selectedElement.roundness === "object"
          ? selectedElement.roundness.type
          : selectedElement.roundness;
      setEdges(roundnessValue > 0 ? "round" : "sharp");
      setOpacity(selectedElement.opacity ?? 100);
    }
  }, [selectedElement]);

  const updateSelectedElement = useCallback(
    (updates: Partial<DriplElement>) => {
      if (selectedIds.length > 0) {
        setElements((prev) =>
          prev.map((el) =>
            selectedIds.includes(el.id) ? ({ ...el, ...updates } as DriplElement) : el,
          ),
        );
        saveHistory();
      }
    },
    [selectedIds, saveHistory],
  );

  const handleStrokeColorChange = (color: string) => {
    setStrokeColor(color);
    updateSelectedElement({ strokeColor: color });
  };

  const handleBackgroundColorChange = (color: string) => {
    setBackgroundColor(color);
    updateSelectedElement({ backgroundColor: color });
  };

  const handleStrokeWidthChange = (width: number) => {
    setStrokeWidth(width);
    updateSelectedElement({ strokeWidth: width });
  };

  const handleStrokeStyleChange = (style: "solid" | "dashed" | "dotted") => {
    setStrokeStyle(style);
    updateSelectedElement({ strokeStyle: style });
  };

  const handleSloppinessChange = (value: number) => {
    setSloppiness(value);
    updateSelectedElement({ roughness: value });
  };

  const handleEdgesChange = (value: "sharp" | "round") => {
    setEdges(value);
    updateSelectedElement({ roundness: value === "round" ? 1 : 0 });
  };

  const handleOpacityChange = (value: number) => {
    setOpacity(value);
    updateSelectedElement({ opacity: value });
  };

  // File operations
  const handleExportImage = () => {
    if (canvasRef.current) {
      exportToPNG(canvasRef.current);
    }
  };

  const handleExportJSON = () => {
    exportToJSON(elements);
  };

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const importedElements = await importFromJSON(file);
        setElements(importedElements);
        saveHistory();
      } catch (error) {
        console.error("Failed to import file:", error);
      }
    }
  };

  const handleResetCanvas = () => {
    if (
      confirm(
        "Are you sure you want to reset the canvas? This will delete all elements.",
      )
    ) {
      setElements([]);
      setSelectedIds([]);
      historyRef.current.clear();
    }
  };

  // Zoom handlers
  const handleZoomIn = () => setZoom(Math.min(zoom + 10, 200));
  const handleZoomOut = () => setZoom(Math.max(zoom - 10, 25));
  const handleResetZoom = () => setZoom(100);

  // Layer operations
  const handleBringForward = () => {
    if (selectedIds.length !== 1) return;
    const index = elements.findIndex((el) => el.id === selectedIds[0]);
    if (index < elements.length - 1) {
      const newElements = [...elements];
      const current = newElements[index];
      const next = newElements[index + 1];
      if (current && next) {
        newElements[index] = next;
        newElements[index + 1] = current;
        setElements(newElements);
        saveHistory();
      }
    }
  };

  const handleSendBackward = () => {
    if (selectedIds.length !== 1) return;
    const index = elements.findIndex((el) => el.id === selectedIds[0]);
    if (index > 0) {
      const newElements = [...elements];
      const current = newElements[index];
      const prev = newElements[index - 1];
      if (current && prev) {
        newElements[index] = prev;
        newElements[index - 1] = current;
        setElements(newElements);
        saveHistory();
      }
    }
  };

  const handleDelete = () => {
    if (selectedIds.length > 0) {
      setElements((prev) => prev.filter((el) => !selectedIds.includes(el.id)));
      setSelectedIds([]);
      saveHistory();
    }
  };

  const handleCopy = () => {
    if (selectedIds.length > 0) {
      const selectedElements = elements.filter((el) =>
        selectedIds.includes(el.id),
      );
      localStorage.setItem("clipboard", JSON.stringify(selectedElements));
    }
  };

  return (
    <div
      className={`w-screen h-dvh overflow-hidden relative font-sans selection:bg-purple-500/30 ${
        theme === "dark" ? "bg-[#121112] text-white" : "bg-[#f7f5f6] text-gray-900"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportJSON}
        className="hidden"
      />

      <div className="absolute top-4 left-4 z-50 flex gap-2">
        <button
          onClick={() => {
            setIsMenuOpen(!isMenuOpen);
            setIsLibraryOpen(false);
          }}
          className={`p-2 rounded-lg border border-gray-700 shadow-sm transition-colors ${
            isMenuOpen
              ? theme === "dark"
                ? "bg-[#403c66] text-[#a8a5ff]"
                : "bg-[#e0e7ff] text-[#4f46e5]"
              : theme === "dark"
                ? "bg-[#232329] hover:bg-[#31303b] text-gray-300"
                : "bg-white hover:bg-gray-100 text-gray-800"
          }`}
        >
          <Menu size={20} />
        </button>

        <button
          onClick={() => {
            setIsLibraryOpen(!isLibraryOpen);
            setIsMenuOpen(false);
          }}
          className={`p-2 rounded-lg border shadow-sm transition-colors ${
            isLibraryOpen
              ? theme === "dark"
                ? "bg-[#403c66] text-[#a8a5ff] border-gray-700"
                : "bg-[#e0e7ff] text-[#4f46e5] border-gray-200"
              : theme === "dark"
                ? "bg-[#232329] hover:bg-[#31303b] text-gray-300 border-gray-700"
                : "bg-white hover:bg-gray-100 text-gray-800 border-gray-200"
          }`}
        >
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button
          className={`px-3 py-1.5 text-xs font-medium hover:bg-opacity-80 rounded-lg border flex items-center gap-1.5 ${
            theme === "dark"
              ? "bg-[#232329] hover:bg-[#31303b] border-gray-700 text-gray-300"
              : "bg-white hover:bg-gray-100 border-gray-200 text-gray-800"
          }`}
        >
          <Globe size={14} />
          Dripl+
        </button>
        <button className="px-4 py-1.5 bg-[#a8a5ff] text-gray-900 text-xs font-bold hover:bg-[#8f8fff] rounded-lg flex items-center gap-1.5 shadow-sm">
          <Share2 size={14} />
          Share
        </button>
        <button
          className={`p-2 hover:bg-opacity-80 rounded-lg border text-gray-400 ${
            theme === "dark"
              ? "bg-[#232329] hover:bg-[#31303b] border-gray-700"
              : "bg-white hover:bg-gray-100 border-gray-200 text-gray-800"
          }`}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div
        className={`absolute top-4 left-1/2 -translate-x-1/2 p-1.5 rounded-xl border shadow-2xl flex items-center gap-0.5 z-50 ${
          theme === "dark"
            ? "bg-[#232329] border-gray-700"
            : "bg-white border-gray-200"
        }`}
      >
        <IconButton icon={<Lock size={17} />} />
        <div className="w-px h-6 bg-gray-700 mx-1.5" />
        <IconButton
          icon={<Hand size={19} />}
          isActive={activeTool === "hand"}
          onClick={() => setActiveTool("hand")}
        />
        <IconButton
          icon={<MousePointer2 size={19} />}
          isActive={activeTool === "select"}
          onClick={() => setActiveTool("select")}
        />
        <IconButton
          icon={<Square size={19} />}
          isActive={activeTool === "rectangle"}
          onClick={() => setActiveTool("rectangle")}
        />
        <IconButton
          icon={
            <div className="rotate-45">
              <Square size={19} />
            </div>
          }
          isActive={activeTool === "diamond"}
          onClick={() => setActiveTool("diamond")}
        />
        <IconButton
          icon={<Circle size={19} />}
          isActive={activeTool === "ellipse"}
          onClick={() => setActiveTool("ellipse")}
        />
        <IconButton
          icon={<ArrowRight size={19} />}
          isActive={activeTool === "arrow"}
          onClick={() => setActiveTool("arrow")}
        />
        <IconButton
          icon={<Minus size={19} />}
          isActive={activeTool === "line"}
          onClick={() => setActiveTool("line")}
        />
        <IconButton
          icon={<Edit3 size={19} />}
          isActive={activeTool === "draw"}
          onClick={() => setActiveTool("draw")}
        />
         <IconButton
          icon={<Type size={19} />}
          isActive={activeTool === "text"}
          onClick={() => {
            console.log("Text tool button clicked");
            setActiveTool("text");
          }}
        />
        <IconButton
          icon={<Image size={19} />}
          isActive={activeTool === "image"}
          onClick={() => setActiveTool("image")}
        />
        <IconButton
          icon={<Eraser size={19} />}
          isActive={activeTool === "eraser"}
          onClick={() => setActiveTool("eraser")}
        />
      </div>

      {isMenuOpen && (
        <div
          className={`absolute top-20 left-4 w-70 rounded-xl border border-gray-700 shadow-2xl p-3 z-50 flex flex-col max-h-[calc(100vh-100px)] ${
            theme === "dark" ? "bg-[#232329]" : "bg-white"
          }`}
        >
          <div className="flex-1 overflow-y-auto pr-1 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
            <MenuItem
              icon={<FolderOpen size={18} />}
              label="Open"
              shortcut="Ctrl+O"
              onClick={() => fileInputRef.current?.click()}
            />
            <MenuItem
              icon={<Save size={18} />}
              label="Save to..."
              onClick={handleExportJSON}
            />
            <MenuItem
              icon={<Download size={18} />}
              label="Export image..."
              shortcut="Ctrl+Shift+E"
              onClick={handleExportImage}
            />
            <MenuItem
              icon={<Users size={18} />}
              label="Live collaboration..."
            />
            <MenuItem
              icon={<Search size={18} />}
              label="Command palette"
              shortcut="Ctrl+/"
              highlight
            />
            <MenuItem
              icon={<Search size={18} />}
              label="Find on canvas"
              shortcut="Ctrl+F"
            />
            <MenuItem
              icon={<HelpCircle size={18} />}
              label="Help"
              shortcut="?"
              onClick={() => setIsHelpOpen(true)}
            />
            <MenuItem
              icon={<RotateCcw size={18} />}
              label="Reset the canvas"
              onClick={handleResetCanvas}
            />

            <MenuSeparator />

            <MenuItem icon={<Globe size={18} />} label="Dripl+" />
            <MenuItem icon={<Github size={18} />} label="GitHub" />
            <MenuItem icon={<Twitter size={18} />} label="Follow us" />
            <MenuItem icon={<MessageCircle size={18} />} label="Discord chat" />

            <MenuSeparator />

            <MenuItem icon={<LogIn size={18} />} label="Sign in" highlight />
          </div>

          <div className={`pt-3 border-t mt-3 space-y-3 ${effectiveTheme === "dark" ? "border-gray-700/50" : "border-gray-200"}`}>
            <div className="px-2">
              <div className={`text-xs mb-2 font-medium ${effectiveTheme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                Theme
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme("light")}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                    theme === "light"
                      ? effectiveTheme === "dark"
                        ? "bg-[#403c66] text-[#a8a5ff]"
                        : "bg-[#e0e7ff] text-[#4f46e5]"
                      : effectiveTheme === "dark"
                        ? "bg-[#1a1a20] text-gray-400 hover:bg-[#31303b]"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  <Sun size={14} />
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                    theme === "dark"
                      ? "bg-[#403c66] text-[#a8a5ff]"
                      : effectiveTheme === "dark"
                        ? "bg-[#1a1a20] text-gray-400 hover:bg-[#31303b]"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  <Moon size={14} />
                </button>
                <button
                  onClick={() => setTheme("system")}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                    theme === "system"
                      ? effectiveTheme === "dark"
                        ? "bg-[#403c66] text-[#a8a5ff]"
                        : "bg-[#e0e7ff] text-[#4f46e5]"
                      : effectiveTheme === "dark"
                        ? "bg-[#1a1a20] text-gray-400 hover:bg-[#31303b]"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  <Monitor size={14} />
                </button>
              </div>
            </div>

            <div className="px-2">
              <button className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                effectiveTheme === "dark"
                  ? "bg-[#1a1a20] hover:bg-[#31303b] text-gray-300"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }`}>
                <span className="text-xs">English</span>
                <ChevronDown size={14} />
              </button>
            </div>

            <div className="px-2">
              <div className="text-xs text-gray-400 mb-2 font-medium">
                Canvas background
              </div>
              <div className="flex gap-2 flex-wrap">
                {canvasBgColors.map((c) => (
                  <ColorSwatch
                    key={c}
                    color={c}
                    isSelected={canvasBg === c}
                    onClick={() => setCanvasBg(c)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {isLibraryOpen && (
        <div className="absolute top-20 left-4 w-[320px] bg-[#232329] rounded-xl border border-gray-700 shadow-2xl p-4 z-50 max-h-[calc(100vh-100px)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Library</h3>
            <button className="text-xs text-[#a8a5ff] hover:text-[#8f8fff]">
              Browse libraries
            </button>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-[#1a1a20] rounded-lg border border-gray-700/50">
              <div className="text-sm text-gray-300 mb-2">Arrows</div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="aspect-square bg-[#232329] rounded border border-gray-700/50 flex items-center justify-center hover:border-[#a8a5ff] transition-colors cursor-pointer"
                  >
                    <ArrowRight size={20} className="text-gray-500" />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-[#1a1a20] rounded-lg border border-gray-700/50">
              <div className="text-sm text-gray-300 mb-2">Shapes</div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="aspect-square bg-[#232329] rounded border border-gray-700/50 flex items-center justify-center hover:border-[#a8a5ff] transition-colors cursor-pointer"
                  >
                    <Square size={20} className="text-gray-500" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isMenuOpen && !isLibraryOpen && selectedIds.length > 0 && (
        <div
          className={`absolute top-20 left-4 w-60 rounded-xl border border-gray-700 shadow-2xl p-4 z-40 max-h-[calc(100vh-100px)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent ${
            theme === "dark" ? "bg-[#232329]" : "bg-white"
          }`}
        >
          <SectionLabel>Stroke</SectionLabel>
          <div className="flex flex-wrap mb-2 gap-1">
            {strokeColors.map((c) => (
              <ColorSwatch
                key={c}
                color={c}
                isSelected={strokeColor === c}
                onClick={() => handleStrokeColorChange(c)}
              />
            ))}
          </div>

          <SectionLabel>Background</SectionLabel>
          <div className="flex flex-wrap mb-2 gap-1">
            {bgColors.map((c) => (
              <ColorSwatch
                key={c}
                color={c}
                isSelected={backgroundColor === c}
                onClick={() => handleBackgroundColorChange(c)}
              />
            ))}
          </div>

          <SectionLabel>Stroke width</SectionLabel>
          <div className="flex bg-[#1a1a20] p-1 rounded-lg mb-2 border border-gray-700/50">
            <button
              onClick={() => handleStrokeWidthChange(1)}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${strokeWidth === 1 ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="h-0.5 w-5 bg-current rounded-full"></div>
            </button>
            <button
              onClick={() => handleStrokeWidthChange(2)}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${strokeWidth === 2 ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="h-1 w-5 bg-current rounded-full"></div>
            </button>
            <button
              onClick={() => handleStrokeWidthChange(3)}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${strokeWidth === 3 ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="h-1.5 w-5 bg-current rounded-full"></div>
            </button>
          </div>

          <SectionLabel>Stroke style</SectionLabel>
          <div className="flex bg-[#1a1a20] p-1 rounded-lg mb-2 border border-gray-700/50">
            <button
              onClick={() => handleStrokeStyleChange("solid")}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${strokeStyle === "solid" ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="h-0.5 w-5 bg-current"></div>
            </button>
            <button
              onClick={() => handleStrokeStyleChange("dashed")}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${strokeStyle === "dashed" ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="h-0.5 w-5 bg-current border-b-2 border-dashed"></div>
            </button>
            <button
              onClick={() => handleStrokeStyleChange("dotted")}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${strokeStyle === "dotted" ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="h-0.5 w-5 bg-current border-b-2 border-dotted"></div>
            </button>
          </div>

          <SectionLabel>Sloppiness</SectionLabel>
          <div className="flex bg-[#1a1a20] p-1 rounded-lg mb-2 gap-1 border border-gray-700/50">
            <button
              onClick={() => handleSloppinessChange(0)}
              className={`flex-1 h-8 rounded flex items-center justify-center transition-colors ${sloppiness === 0 ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <Minus size={16} />
            </button>
            <button
              onClick={() => handleSloppinessChange(1)}
              className={`flex-1 h-8 rounded flex items-center justify-center transition-colors ${sloppiness === 1 ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M2 12c2-2 4-4 8 0s4 4 8 0 8-4 10 0" />
              </svg>
            </button>
            <button
              onClick={() => handleSloppinessChange(2)}
              className={`flex-1 h-8 rounded flex items-center justify-center transition-colors ${sloppiness === 2 ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M2 12c2-4 4-6 8 0s4 6 8 0 8-6 10 0" />
              </svg>
            </button>
          </div>

          <SectionLabel>Edges</SectionLabel>
          <div className="flex bg-[#1a1a20] p-1 rounded-lg mb-2 border border-gray-700/50">
            <button
              onClick={() => handleEdgesChange("sharp")}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${edges === "sharp" ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <Square size={15} />
            </button>
            <button
              onClick={() => handleEdgesChange("round")}
              className={`flex-1 h-8 flex items-center justify-center rounded transition-colors ${edges === "round" ? "bg-[#403c66] text-[#a8a5ff]" : "hover:bg-[#31303b] text-gray-400"}`}
            >
              <div className="w-3.5 h-3.5 border-2 border-current rounded-md"></div>
            </button>
          </div>

          <SectionLabel>Opacity</SectionLabel>
          <div className="flex items-center gap-3 px-1 mb-4">
            <input
              type="range"
              min="0"
              max="100"
              value={opacity}
              onChange={(e) => handleOpacityChange(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#a8a5ff]"
            />
            <span className="text-xs text-gray-400 w-8 text-right font-mono">
              {opacity}
            </span>
          </div>

          <SectionLabel>Layers</SectionLabel>
          <div className="flex gap-1.5 mb-4">
            <button
              onClick={handleBringForward}
              className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors"
            >
              <Layers size={15} />
            </button>
            <button
              onClick={handleBringForward}
              className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors"
            >
              <ArrowRight size={15} className="-rotate-90" />
            </button>
            <button
              onClick={handleSendBackward}
              className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors"
            >
              <ArrowRight size={15} className="rotate-90" />
            </button>
            <button className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors">
              <Layers size={15} />
            </button>
          </div>

          <SectionLabel>Actions</SectionLabel>
          <div className="flex gap-1.5">
            <button
              onClick={handleCopy}
              className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors"
            >
              <Copy size={15} />
            </button>
            <button
              onClick={handleDelete}
              className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors"
            >
              <Trash2 size={15} />
            </button>
            <button className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors">
              <Link size={15} />
            </button>
            <button className="p-2 bg-[#1a1a20] hover:bg-[#31303b] rounded border border-gray-700/50 text-gray-400 transition-colors">
              <AlignCenter size={15} />
            </button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center relative"
        style={{ backgroundColor: canvasBg }}
      >
        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {selectedIds.length > 0 &&
          elements
            .filter((el) => selectedIds.includes(el.id))
            .map((selectedShape) => {
              let displayElement = selectedShape;

              if (isMoving && selectedIds.includes(selectedShape.id)) {
                displayElement = {
                  ...selectedShape,
                  x: selectedShape.x + moveOffset.x,
                  y: selectedShape.y + moveOffset.y,
                  points: selectedShape.points?.map((p: Point) => ({
                    x: p.x + moveOffset.x,
                    y: p.y + moveOffset.y,
                  })),
                };
              } else if (
                isRotating &&
                rotateStart &&
                rotateStart.elementId === selectedShape.id
              ) {
                displayElement = {
                  ...selectedShape,
                  rotation: (selectedShape.rotation || 0) + rotateOffset,
                };
              }

              const bounds = getElementBounds(displayElement);

              const screenX = pan.x + (bounds.x * zoom) / 100;
              const screenY = pan.y + (bounds.y * zoom) / 100;
              const screenWidth = (bounds.width * zoom) / 100;
              const screenHeight = (bounds.height * zoom) / 100;

              return (
                <div
                  key={`selection-${selectedShape.id}`}
                  className="absolute pointer-events-auto cursor-move"
                  style={{
                    left: `${screenX}px`,
                    top: `${screenY}px`,
                    width: `${screenWidth}px`,
                    height: `${screenHeight}px`,
                    transform: displayElement.rotation
                      ? `rotate(${displayElement.rotation}rad)`
                      : undefined,
                    transformOrigin: "center center",
                  }}
                  onMouseDown={(e) => handleMoveStart(e, selectedShape.id)}
                >
                  <div className="absolute -inset-2 border-2 border-[#a8a5ff] rounded-lg pointer-events-none">
                    {[
                      {
                        pos: "top-0 left-0",
                        handle: "top-left",
                        cursor: "nwse-resize",
                      },
                      {
                        pos: "top-0 left-1/2",
                        handle: "top",
                        cursor: "ns-resize",
                      },
                      {
                        pos: "top-0 right-0",
                        handle: "top-right",
                        cursor: "nesw-resize",
                      },
                      {
                        pos: "top-1/2 right-0",
                        handle: "right",
                        cursor: "ew-resize",
                      },
                      {
                        pos: "bottom-0 right-0",
                        handle: "bottom-right",
                        cursor: "nwse-resize",
                      },
                      {
                        pos: "bottom-0 left-1/2",
                        handle: "bottom",
                        cursor: "ns-resize",
                      },
                      {
                        pos: "bottom-0 left-0",
                        handle: "bottom-left",
                        cursor: "nesw-resize",
                      },
                      {
                        pos: "top-1/2 left-0",
                        handle: "left",
                        cursor: "ew-resize",
                      },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className={`absolute w-2 h-2 bg-white border border-[#a8a5ff] -translate-x-1/2 -translate-y-1/2 pointer-events-auto ${item.pos}`}
                        style={{ cursor: item.cursor }}
                        onMouseDown={(e) =>
                          handleResizeStart(e, item.handle, selectedShape.id)
                        }
                      />
                    ))}
                    <div
                      className="absolute top-6 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border border-[#a8a5ff] rounded-full cursor-grab pointer-events-auto"
                      onMouseDown={(e) =>
                        handleRotateStart(e, selectedShape.id)
                      }
                    />
                    <div className="absolute -top-5.5 left-1/2 -translate-x-1/2 w-px h-4 bg-[#a8a5ff]" />
                  </div>
                </div>
              );
            })}
      </div>

      <div className="absolute bottom-4 left-4 flex gap-2 z-50">
        <div
          className={`flex items-center rounded-lg border p-1 ${
            theme === "dark"
              ? "bg-[#232329] border-gray-700"
              : "bg-white border-gray-200"
          }`}
        >
          <button
            onClick={handleZoomOut}
            className="p-2 hover:bg-[#31303b] rounded text-gray-400 transition-colors"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={handleResetZoom}
            className="text-xs font-mono px-3 text-gray-300 hover:text-white transition-colors min-w-12"
          >
            {zoom}%
          </button>
          <button
            onClick={handleZoomIn}
            className="p-2 hover:bg-[#31303b] rounded text-gray-400 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          onClick={() => {
            const state = historyRef.current.undo();
            if (state) {
              setElements(state.elements);
              setSelectedIds(state.selectedIds);
            }
          }}
          disabled={!historyRef.current.canUndo()}
          className={`p-2 hover:bg-opacity-80 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            theme === "dark"
              ? "bg-[#232329] hover:bg-[#31303b] border-gray-700 text-gray-400"
              : "bg-white hover:bg-gray-100 border-gray-200 text-gray-800"
          }`}
        >
          <Undo size={16} />
        </button>
        <button
          onClick={() => {
            const state = historyRef.current.redo();
            if (state) {
              setElements(state.elements);
              setSelectedIds(state.selectedIds);
            }
          }}
          disabled={!historyRef.current.canRedo()}
          className={`p-2 hover:bg-opacity-80 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            theme === "dark"
              ? "bg-[#232329] hover:bg-[#31303b] border-gray-700 text-gray-400"
              : "bg-white hover:bg-gray-100 border-gray-200 text-gray-800"
          }`}
        >
          <Redo size={16} />
        </button>
      </div>

      <div className="absolute bottom-4 right-4 z-50">
        <button
          onClick={() => setIsHelpOpen(true)}
          className={`p-2 hover:bg-opacity-80 rounded-full border shadow-sm transition-colors ${
            theme === "dark"
              ? "bg-[#232329] hover:bg-[#31303b] border-gray-700 text-gray-400"
              : "bg-white hover:bg-gray-100 border-gray-200 text-gray-800"
          }`}
        >
          <HelpCircle size={20} />
        </button>
      </div>

      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </div>
  );
}
