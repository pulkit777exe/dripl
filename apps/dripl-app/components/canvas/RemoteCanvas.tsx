"use client";

import React, { useEffect, useRef, useState } from "react";
import { Sidebar } from "../Sidebar";
import { CanvasElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import { distance, isPointInRect } from "@dripl/math";
import { updateFile } from "@/actions/files";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";

interface RemoteCanvasProps {
  fileId: string;
  initialData: CanvasElement[];
}

export function RemoteCanvas({ fileId, initialData }: RemoteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [elements, setElements] = useState<CanvasElement[]>(initialData);
  const [activeTool, setActiveTool] = useState<string>("select");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState<CanvasElement | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-save logic
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (elements !== initialData) { // Simple check, could be better
        setSaving(true);
        try {
          await updateFile(fileId, JSON.stringify(elements));
        } catch (e) {
          console.error("Failed to save", e);
        } finally {
          setSaving(false);
        }
      }
    }, 1000); // Debounce 1s

    return () => clearTimeout(timeout);
  }, [elements, fileId]);

  // Draw loop (Identical to LocalCanvas)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(panOffset.x, panOffset.y);

      elements.forEach((el) => {
        ctx.save();
        ctx.globalAlpha = el.opacity;
        ctx.strokeStyle = el.stroke || "#000";
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
          ctx.arc(el.x, el.y, r, 0, 2 * Math.PI);
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
          ctx.fillStyle = el.stroke || "#000";
          // @ts-ignore
          ctx.fillText(el.text, el.x, el.y);
        } else if (el.type === "image") {
          const img = new Image();
           // @ts-ignore
          img.src = el.src;
          // @ts-ignore
          ctx.drawImage(img, el.x, el.y, el.width || 100, el.height || 100);
        }
        
        if (el.id === selectedElementId) {
          ctx.strokeStyle = "#00f";
          ctx.lineWidth = 1;
          const padding = 4;
          const w = el.width || 0;
          const h = el.height || 0;
           // @ts-ignore
          if(el.type === 'circle') {
             // @ts-ignore
             const r = el.radius || w/2;
             ctx.strokeRect(el.x - r - padding, el.y - r - padding, r*2 + padding*2, r*2 + padding*2);
          } else {
             ctx.strokeRect(el.x - padding, el.y - padding, w + padding*2, h + padding*2);
          }
        }
        ctx.restore();
      });

      if (currentElement) {
         ctx.save();
        ctx.strokeStyle = currentElement.stroke || "#000";
        ctx.lineWidth = currentElement.strokeWidth || 2;
        ctx.fillStyle = currentElement.fill || "transparent";

        if (currentElement.type === "rectangle") {
          ctx.beginPath();
           // @ts-ignore
          ctx.rect(currentElement.x, currentElement.y, currentElement.width || 0, currentElement.height || 0);
          ctx.fill();
          ctx.stroke();
        } else if (currentElement.type === "circle") {
            ctx.beginPath();
             // @ts-ignore
            const r = currentElement.radius || (currentElement.width ? currentElement.width / 2 : 0);
            ctx.arc(currentElement.x, currentElement.y, Math.abs(r), 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        } else if (currentElement.type === "path") {
           // @ts-ignore
          if (currentElement.points && currentElement.points.length > 0) {
            ctx.beginPath();
             // @ts-ignore
            ctx.moveTo(currentElement.points[0][0], currentElement.points[0][1]);
             // @ts-ignore
            currentElement.points.forEach((p) => ctx.lineTo(p[0], p[1]));
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      ctx.restore();
    };

    render();
  }, [elements, currentElement, panOffset, selectedElementId]);

  const getMousePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) - panOffset.x,
      y: (e.clientY - rect.top) - panOffset.y,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    if (activeTool === "hand") {
      setIsDrawing(true);
      setStartPan({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    if (activeTool === "select") {
      const clicked = elements.slice().reverse().find(el => {
        const w = el.width || 20;
        const h = el.height || 20;
        // @ts-ignore
        if(el.type === 'circle') {
            // @ts-ignore
             const r = el.radius || w/2;
             return distance(pos, {x: el.x, y: el.y}) <= r;
        }
        return isPointInRect(pos, { x: el.x, y: el.y, width: w, height: h });
      });
      setSelectedElementId(clicked ? clicked.id : null);
      return;
    }

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
        const text = prompt("Enter text:");
        if(text) {
             const newEl: CanvasElement = {
                id,
                type: "text",
                x: pos.x,
                y: pos.y,
                // @ts-ignore
                text,
                fontSize: 24,
                fontFamily: "Inter",
                stroke: "#fff",
                opacity: 1,
                rotation: 0,
                textAlign: "left",
             };
             setElements(prev => [...prev, newEl]);
        }
        setIsDrawing(false);
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
    if (isDrawing && currentElement) {
      setElements((prev) => [...prev, currentElement]);
    }
    setIsDrawing(false);
    setCurrentElement(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
        alert("Only images (PNG, JPEG, GIF, WEBP) are allowed.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const src = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
            const newEl: CanvasElement = {
                id: uuidv4(),
                type: "image",
                x: 100 - panOffset.x,
                y: 100 - panOffset.y,
                width: img.width,
                height: img.height,
                // @ts-ignore
                src,
                opacity: 1,
                rotation: 0,
            };
            setElements(prev => [...prev, newEl]);
        };
        img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleToolSelect = (tool: string) => {
      if (tool === 'image') {
          fileInputRef.current?.click();
      } else {
          setActiveTool(tool);
      }
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-zinc-950 text-white">
      <Sidebar activeTool={activeTool} onToolSelect={handleToolSelect} />
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*"
        onChange={handleImageUpload}
      />
      
      <canvas
        ref={canvasRef}
        width={windowSize.width}
        height={windowSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="cursor-crosshair touch-none"
      />
      
      <div className="absolute top-4 left-20 z-50 flex items-center gap-4">
        <Link href="/dashboard" className="p-2 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-white" />
        </Link>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded-md">
            <span className="text-xs text-zinc-400">
                {saving ? "Saving..." : "Saved"}
            </span>
            {!saving && <Save className="h-3 w-3 text-green-500" />}
        </div>
      </div>
    </div>
  );
}
