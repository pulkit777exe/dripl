"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { CanvasElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import { distance, isPointInRect, LineSegment } from "@dripl/math";
import { elementIntersectsSegment } from "@dripl/element";
import { EraserTrail } from "@/eraser";
import { PropertiesPanel } from "./PropertiesPanel";
import { ZoomControls } from "./ZoomControls";
import { HelpModal } from "./HelpModal";

interface CanvasProps {
  elements: CanvasElement[];
  setElements: React.Dispatch<React.SetStateAction<CanvasElement[]>>;
  activeTool: string;
  setActiveTool: (tool: string) => void;
  onImageUpload?: (file: File) => void;
  readOnly?: boolean;
}

export function Canvas({
  elements,
  setElements,
  activeTool,
  setActiveTool,
  onImageUpload,
  readOnly = false,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState<CanvasElement | null>(
    null
  );
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null
  );
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  // Advanced State
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<CanvasElement[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Eraser State
  const eraserTrailRef = useRef<EraserTrail | null>(null);
  const [elementsToErase, setElementsToErase] = useState<Set<string>>(
    new Set()
  );

  // Initialize Window Size
  useEffect(() => {
    setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    const handleResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Initialize Eraser Trail
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    eraserTrailRef.current = new EraserTrail(ctx, {
      size: 5,
      color: "rgba(255, 100, 100, 0.3)",
      fadeTime: 200,
      streamline: 0.2,
      keepHead: true,
    });
  }, []);

  // History Management
  const addToHistory = useCallback(
    (newElements: CanvasElement[]) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newElements);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex]
  );

  const undo = () => {
    if (historyIndex > 0) {
      const prevElements = history[historyIndex - 1];
      if (prevElements) {
        setHistoryIndex(historyIndex - 1);
        setElements(prevElements);
      }
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextElements = history[historyIndex + 1];
      if (nextElements) {
        setHistoryIndex(historyIndex + 1);
        setElements(nextElements);
      }
    }
  };

  // Initial History Push
  useEffect(() => {
    if (history.length === 0 && elements.length > 0) {
      setHistory([elements]);
      setHistoryIndex(0);
    }
  }, []); // Run once

  // Coordinate Conversion
  const getMousePos = (e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - panOffset.x) / zoom,
      y: (e.clientY - rect.top - panOffset.y) / zoom,
    };
  };

  // Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Apply Pan and Zoom
      ctx.translate(panOffset.x, panOffset.y);
      ctx.scale(zoom, zoom);

      // Render existing elements
      elements.forEach((el) => {
        if (el.id === editingTextId) return; // Don't render text being edited

        ctx.save();
        ctx.globalAlpha = el.opacity;
        ctx.strokeStyle = el.stroke || "#fff";
        ctx.lineWidth = el.strokeWidth || 2;
        ctx.fillStyle = el.fill || "transparent";

        if (el.type === "rectangle") {
          ctx.beginPath();
          // @ts-ignore
          ctx.rect(el.x, el.y, el.width || 0, el.height || 0);
          ctx.fill();
          ctx.stroke();
        } else if (el.type === "circle") {
          ctx.beginPath();
          // @ts-ignore
          const r = el.radius || (el.width ? el.width / 2 : 10);
          ctx.arc(el.x, el.y, Math.abs(r), 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        } else if (el.type === "path") {
          // @ts-ignore
          if (el.points && el.points.length > 0) {
            ctx.beginPath();
            // @ts-ignore
            ctx.moveTo(el.points[0][0], el.points[0][1]);
            // @ts-ignore
            el.points.forEach((p) => ctx.lineTo(p[0], p[1]));
            ctx.stroke();
          }
        } else if (el.type === "text") {
          // @ts-ignore
          ctx.font = `${el.fontSize}px ${el.fontFamily}`;
          ctx.fillStyle = el.stroke || "#fff";
          ctx.textBaseline = "top";
          // @ts-ignore
          const lines = el.text.split("\n");
          lines.forEach((line: string, i: number) => {
            // @ts-ignore
            ctx.fillText(line, el.x, el.y + i * el.fontSize * 1.2);
          });
        } else if (el.type === "image") {
          const img = new Image();
          // @ts-ignore
          img.src = el.src;
          // @ts-ignore
          ctx.drawImage(img, el.x, el.y, el.width || 100, el.height || 100);
        }

        // Selection Highlight
        if (el.id === selectedElementId && !readOnly) {
          ctx.strokeStyle = "#818cf8"; // Indigo-400
          ctx.lineWidth = 1 / zoom; // Keep line width constant visually
          const padding = 8 / zoom;
          const w = el.width || 0;
          const h = el.height || 0;

          // @ts-ignore
          if (el.type === "circle") {
            // @ts-ignore
            const r = el.radius || w / 2;
            ctx.strokeRect(
              el.x - r - padding,
              el.y - r - padding,
              r * 2 + padding * 2,
              r * 2 + padding * 2
            );
          } else if (el.type === "text") {
            // Approximate text bounds
            // @ts-ignore
            const lines = el.text.split("\n");
            // @ts-ignore
            const height = lines.length * el.fontSize * 1.2;
            // @ts-ignore
            ctx.font = `${el.fontSize}px ${el.fontFamily}`;
            // @ts-ignore
            const width = Math.max(
              ...lines.map((l) => ctx.measureText(l).width)
            );
            ctx.strokeRect(
              el.x - padding,
              el.y - padding,
              width + padding * 2,
              height + padding * 2
            );
          } else if (el.type === "path") {
            // @ts-ignore
            const points = el.points || [];
            if (points.length > 0) {
              let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
              // @ts-ignore
              points.forEach((p) => {
                minX = Math.min(minX, p[0] ?? Infinity);
                minY = Math.min(minY, p[1] ?? Infinity);
                maxX = Math.max(maxX, p[0] ?? -Infinity);
                maxY = Math.max(maxY, p[1] ?? -Infinity);
              });
              ctx.strokeRect(
                minX - padding,
                minY - padding,
                maxX - minX + padding * 2,
                maxY - minY + padding * 2
              );
            }
          } else {
            ctx.strokeRect(
              el.x - padding,
              el.y - padding,
              w + padding * 2,
              h + padding * 2
            );
          }
        }
        ctx.restore();
      });

      // Render current element being drawn
      if (currentElement) {
        ctx.save();
        ctx.strokeStyle = currentElement.stroke || "#fff";
        ctx.lineWidth = currentElement.strokeWidth || 2;
        ctx.fillStyle = currentElement.fill || "transparent";

        if (currentElement.type === "rectangle") {
          ctx.beginPath();
          // @ts-ignore
          ctx.rect(
            currentElement.x,
            currentElement.y,
            currentElement.width || 0,
            currentElement.height || 0
          );
          ctx.fill();
          ctx.stroke();
        } else if (currentElement.type === "circle") {
          ctx.beginPath();
          // @ts-ignore
          const r = currentElement.radius || 0;
          ctx.arc(
            currentElement.x,
            currentElement.y,
            Math.abs(r),
            0,
            2 * Math.PI
          );
          ctx.fill();
          ctx.stroke();
        } else if (currentElement.type === "path") {
          // @ts-ignore
          if (currentElement.points && currentElement.points.length > 0) {
            ctx.beginPath();
            // @ts-ignore
            ctx.moveTo(
              currentElement.points[0][0],
              currentElement.points[0][1]
            );
            // @ts-ignore
            currentElement.points.forEach((p) => ctx.lineTo(p[0], p[1]));
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Render eraser trail
      if (eraserTrailRef.current && eraserTrailRef.current.isActive()) {
        ctx.restore(); // Restore to remove zoom/pan for trail rendering
        eraserTrailRef.current.render(panOffset, zoom);
        ctx.save();
        ctx.translate(panOffset.x, panOffset.y);
        ctx.scale(zoom, zoom);
      }

      // Highlight elements to be erased
      if (elementsToErase.size > 0) {
        elements.forEach((el) => {
          if (elementsToErase.has(el.id)) {
            ctx.save();
            ctx.strokeStyle = "rgba(255, 100, 100, 0.6)";
            ctx.lineWidth = 2 / zoom;
            ctx.setLineDash([5 / zoom, 5 / zoom]);

            const padding = 4 / zoom;
            const w = el.width || 0;
            const h = el.height || 0;

            if (el.type === "circle") {
              // @ts-ignore
              const r = el.radius || w / 2;
              ctx.strokeRect(
                el.x - r - padding,
                el.y - r - padding,
                r * 2 + padding * 2,
                r * 2 + padding * 2
              );
            } else if (el.type === "path") {
              // @ts-ignore
              const points = el.points || [];
              if (points.length > 0) {
                let minX = Infinity,
                  minY = Infinity,
                  maxX = -Infinity,
                  maxY = -Infinity;
                // @ts-ignore
                points.forEach((p) => {
                  minX = Math.min(minX, p[0] ?? Infinity);
                  minY = Math.min(minY, p[1] ?? Infinity);
                  maxX = Math.max(maxX, p[0] ?? -Infinity);
                  maxY = Math.max(maxY, p[1] ?? -Infinity);
                });
                ctx.strokeRect(
                  minX - padding,
                  minY - padding,
                  maxX - minX + padding * 2,
                  maxY - minY + padding * 2
                );
              }
            } else {
              ctx.strokeRect(
                el.x - padding,
                el.y - padding,
                w + padding * 2,
                h + padding * 2
              );
            }
            ctx.restore();
          }
        });
      }

      ctx.restore();
    };

    render();
  }, [
    elements,
    currentElement,
    panOffset,
    selectedElementId,
    zoom,
    editingTextId,
    readOnly,
    elementsToErase,
  ]);

  // Helper for path hit testing
  const isPointNearPath = (
    point: { x: number; y: number },
    pathPoints: number[][],
    threshold: number = 10
  ): boolean => {
    if (!pathPoints || pathPoints.length < 2) return false;

    // 1. Fast Bounding Box Check
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of pathPoints) {
      minX = Math.min(minX, p[0] ?? Infinity);
      minY = Math.min(minY, p[1] ?? Infinity);
      maxX = Math.max(maxX, p[0] ?? -Infinity);
      maxY = Math.max(maxY, p[1] ?? -Infinity);
    }

    if (
      point.x < minX - threshold ||
      point.x > maxX + threshold ||
      point.y < minY - threshold ||
      point.y > maxY + threshold
    ) {
      return false;
    }

    // 2. Precise Segment Check
    const distToSegment = (
      p: { x: number; y: number },
      v: { x: number; y: number },
      w: { x: number; y: number }
    ) => {
      const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
      if (l2 === 0) return distance(p, v);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return distance(p, {
        x: v.x + t * (w.x - v.x),
        y: v.y + t * (w.y - v.y),
      });
    };

    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = { x: pathPoints[i]?.[0] ?? 0, y: pathPoints[i]?.[1] ?? 0 };
      const p2 = {
        x: pathPoints[i + 1]?.[0] ?? 0,
        y: pathPoints[i + 1]?.[1] ?? 0,
      };
      if (distToSegment(point, p1, p2) <= threshold) return true;
    }
    return false;
  };

  // Event Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (readOnly && activeTool !== "hand") return;

    const pos = getMousePos(e);

    // 1. Pan Tool
    if (activeTool === "hand") {
      setIsDrawing(true);
      setStartPan({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    // Hit Test Logic (Shared for Eraser and Select)
    const hitTestElement = (el: CanvasElement) => {
      // @ts-ignore
      if (el.type === "path") {
        // @ts-ignore
        return isPointNearPath(pos, el.points);
      }
      // @ts-ignore
      if (el.type === "circle") {
        const w = el.width || 20;
        // @ts-ignore
        const r = el.radius || w / 2;
        return distance(pos, { x: el.x, y: el.y }) <= r;
      }
      // Text hit test approximation
      if (el.type === "text") {
        // @ts-ignore
        const lines = el.text.split("\n");
        // @ts-ignore
        const h = lines.length * el.fontSize * 1.2;
        // @ts-ignore
        const ctx = canvasRef.current?.getContext("2d");
        // @ts-ignore
        ctx.font = `${el.fontSize}px ${el.fontFamily}`;
        // @ts-ignore
        const w = Math.max(...lines.map((l) => ctx?.measureText(l).width || 0));
        return isPointInRect(pos, { x: el.x, y: el.y, width: w, height: h });
      }

      const w = el.width || 20;
      const h = el.height || 20;
      return isPointInRect(pos, { x: el.x, y: el.y, width: w, height: h });
    };

    // 2. Eraser Tool - Start eraser trail
    if (activeTool === "eraser") {
      setIsDrawing(true);
      if (eraserTrailRef.current) {
        eraserTrailRef.current.startPath(pos.x, pos.y);
        setElementsToErase(new Set());
      }
      return;
    }

    // 3. Selection Tool
    if (activeTool === "select") {
      const clicked = elements.slice().reverse().find(hitTestElement);

      if (clicked) {
        setSelectedElementId(clicked.id);
        setDragStart(pos);
        setIsDrawing(true);

        // Double click to edit text?
        if (clicked.type === "text" && e.detail === 2) {
          setEditingTextId(clicked.id);
          setIsDrawing(false);
          setTimeout(() => textAreaRef.current?.focus(), 0);
        }
      } else {
        setSelectedElementId(null);
        setEditingTextId(null);
      }
      return;
    }

    // 4. Drawing Tools
    setIsDrawing(true);
    const id = uuidv4();

    if (activeTool === "rectangle") {
      setCurrentElement({
        id,
        type: "rectangle",
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        stroke: "#fff",
        opacity: 1,
        rotation: 0,
        cornerRadius: 0,
      });
    } else if (activeTool === "circle") {
      setCurrentElement({
        id,
        type: "circle",
        x: pos.x,
        y: pos.y,
        radius: 0,
        stroke: "#fff",
        opacity: 1,
        rotation: 0,
      });
    } else if (activeTool === "draw") {
      setCurrentElement({
        id,
        type: "path",
        x: pos.x,
        y: pos.y,
        // @ts-ignore
        points: [[pos.x, pos.y]],
        stroke: "#fff",
        opacity: 1,
        rotation: 0,
      });
    } else if (activeTool === "text") {
      // Create text element immediately and start editing
      const newEl: CanvasElement = {
        id,
        type: "text",
        x: pos.x,
        y: pos.y,
        // @ts-ignore
        text: "",
        fontSize: 24,
        fontFamily: "Inter",
        textAlign: "left",
        stroke: "#fff",
        opacity: 1,
        rotation: 0,
      };
      setElements((prev) => [...prev, newEl]);
      setEditingTextId(id);
      setSelectedElementId(id);
      setIsDrawing(false);
      setActiveTool("select");
      setTimeout(() => textAreaRef.current?.focus(), 0);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return;

    if (activeTool === "hand") {
      setPanOffset({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
      return;
    }

    const pos = getMousePos(e);

    // Eraser Tool - Add point and detect intersections
    if (activeTool === "eraser" && eraserTrailRef.current) {
      eraserTrailRef.current.addPoint(pos.x, pos.y);

      const lastSegment = eraserTrailRef.current.getLastSegment();
      if (lastSegment) {
        const segment: LineSegment = {
          start: lastSegment.start,
          end: lastSegment.end,
        };

        // Check which elements intersect with this segment
        const newElementsToErase = new Set(elementsToErase);
        elements.forEach((element) => {
          if (!newElementsToErase.has(element.id)) {
            // Convert CanvasElement to DriplElement format for intersection test
            const driplElement = {
              ...element,
              strokeColor: element.stroke || "#fff",
              backgroundColor: element.fill || "transparent",
              strokeWidth: element.strokeWidth || 2,
              opacity: element.opacity || 1,
            } as any;

            if (elementIntersectsSegment(driplElement, segment, 10)) {
              newElementsToErase.add(element.id);
              eraserTrailRef.current?.markElementForErase(element.id);
            }
          }
        });
        setElementsToErase(newElementsToErase);
      }
      return;
    }

    if (activeTool === "select" && selectedElementId && dragStart) {
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;

      setElements((prev) =>
        prev.map((el) => {
          if (el.id === selectedElementId) {
            if (el.type === "path") {
              // @ts-ignore
              const newPoints = el.points.map((p) => [p[0] + dx, p[1] + dy]);
              return { ...el, points: newPoints };
            }
            return { ...el, x: el.x + dx, y: el.y + dy };
          }
          return el;
        })
      );
      setDragStart(pos);
      return;
    }

    if (currentElement) {
      if (currentElement.type === "rectangle") {
        setCurrentElement({
          ...currentElement,
          width: pos.x - currentElement.x,
          height: pos.y - currentElement.y,
        });
      } else if (currentElement.type === "circle") {
        const r = distance({ x: currentElement.x, y: currentElement.y }, pos);
        setCurrentElement({
          ...currentElement,
          // @ts-ignore
          radius: r,
        });
      } else if (currentElement.type === "path") {
        setCurrentElement({
          ...currentElement,
          // @ts-ignore
          points: [...currentElement.points, [pos.x, pos.y]],
        });
      }
    }
  };

  const handleMouseUp = () => {
    if (isDrawing) {
      // Eraser Tool - Finalize erasing
      if (activeTool === "eraser" && elementsToErase.size > 0) {
        const newElements = elements.filter(
          (el) => !elementsToErase.has(el.id)
        );
        setElements(newElements);
        addToHistory(newElements);
        setElementsToErase(new Set());
        if (eraserTrailRef.current) {
          eraserTrailRef.current.endPath();
        }
      } else if (currentElement) {
        const newElements = [...elements, currentElement];
        setElements(newElements);
        addToHistory(newElements);
      } else if (selectedElementId && dragStart) {
        // Finished dragging, save history
        addToHistory(elements);
      }
    }
    setIsDrawing(false);
    setCurrentElement(null);
    setDragStart(null);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingTextId) return; // Disable shortcuts while editing text

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementId && !readOnly) {
          const newElements = elements.filter(
            (el) => el.id !== selectedElementId
          );
          setElements(newElements);
          addToHistory(newElements);
          setSelectedElementId(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "1" || e.key.toLowerCase() === "v")
        setActiveTool("select");
      else if (e.key === "2" || e.key.toLowerCase() === "h")
        setActiveTool("hand");
      else if (e.key === "3" || e.key.toLowerCase() === "r")
        setActiveTool("rectangle");
      else if (e.key === "4" || e.key.toLowerCase() === "c")
        setActiveTool("circle");
      else if (e.key === "5" || e.key.toLowerCase() === "p")
        setActiveTool("draw");
      else if (e.key === "6" || e.key.toLowerCase() === "t")
        setActiveTool("text");
      else if (e.key === "0" || e.key.toLowerCase() === "e")
        setActiveTool("eraser");
      else if (e.key === "=" || e.key === "+")
        setZoom((z) => Math.min(z + 0.1, 5));
      else if (e.key === "-") setZoom((z) => Math.max(z - 0.1, 0.1));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedElementId,
    elements,
    history,
    historyIndex,
    editingTextId,
    readOnly,
  ]);

  // Text Editing Overlay
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!editingTextId) return;
    setElements((prev) =>
      prev.map((el) => {
        if (el.id === editingTextId) {
          return { ...el, text: e.target.value };
        }
        return el;
      })
    );
  };

  const handleTextBlur = () => {
    setEditingTextId(null);
    addToHistory(elements);
  };

  const selectedElement =
    elements.find((el) => el.id === selectedElementId) || null;

  return (
    <>
      <canvas
        ref={canvasRef}
        width={windowSize.width}
        height={windowSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="cursor-crosshair touch-none absolute inset-0"
      />

      {/* Text Editing Overlay */}
      {editingTextId &&
        (() => {
          const el = elements.find((e) => e.id === editingTextId);
          if (!el) return null;
          return (
            <textarea
              ref={textAreaRef}
              value={(el as any).text}
              onChange={handleTextChange}
              onBlur={handleTextBlur}
              style={{
                position: "absolute",
                left: el.x * zoom + panOffset.x,
                top: el.y * zoom + panOffset.y,
                fontSize: `${(el as any).fontSize * zoom}px`,
                fontFamily: (el as any).fontFamily,
                color: el.stroke,
                background: "transparent",
                border: "1px dashed #818cf8",
                outline: "none",
                resize: "none",
                overflow: "hidden",
                whiteSpace: "pre",
                minWidth: "100px",
                minHeight: "1.2em",
              }}
            />
          );
        })()}

      {/* UI Overlays */}
      {!readOnly && (
        <>
          <PropertiesPanel
            element={selectedElement}
            onChange={(updates) => {
              const newElements = elements.map((el) =>
                el.id === selectedElementId ? { ...el, ...updates } : el
              ) as CanvasElement[];
              setElements(newElements);
              // Debounce history update for slider changes? For now, simple.
            }}
            onDelete={() => {
              const newElements = elements.filter(
                (el) => el.id !== selectedElementId
              );
              setElements(newElements);
              addToHistory(newElements);
              setSelectedElementId(null);
            }}
            onDuplicate={() => {
              if (selectedElement) {
                const newEl = {
                  ...selectedElement,
                  id: uuidv4(),
                  x: selectedElement.x + 20,
                  y: selectedElement.y + 20,
                };
                const newElements = [...elements, newEl];
                setElements(newElements);
                addToHistory(newElements);
                setSelectedElementId(newEl.id);
              }
            }}
            onBringToFront={() => {
              if (selectedElement) {
                const newElements = elements.filter(
                  (el) => el.id !== selectedElementId
                );
                newElements.push(selectedElement);
                setElements(newElements);
                addToHistory(newElements);
              }
            }}
            onSendToBack={() => {
              if (selectedElement) {
                const newElements = elements.filter(
                  (el) => el.id !== selectedElementId
                );
                newElements.unshift(selectedElement);
                setElements(newElements);
                addToHistory(newElements);
              }
            }}
          />
        </>
      )}

      <ZoomControls
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(z + 0.1, 5))}
        onZoomOut={() => setZoom((z) => Math.max(z - 0.1, 0.1))}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onHelp={() => setShowHelp(true)}
      />

      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
