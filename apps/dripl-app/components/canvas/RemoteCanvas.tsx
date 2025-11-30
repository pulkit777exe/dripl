"use client";

import React, { useEffect, useRef, useState } from "react";
import { CanvasElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import { updateFile } from "@/actions/files";
import { ArrowLeft, Save, Share2, Lock } from "lucide-react";
import Link from "next/link";
import { Toolbar } from "./Toolbar";
import { Canvas } from "./Canvas";
import { ThemeToggle } from "@/components/ThemeToggle";

interface RemoteCanvasProps {
  fileId: string;
  initialData: CanvasElement[];
  readOnly?: boolean;
  isAuthenticated?: boolean;
}

export function RemoteCanvas({ fileId, initialData, readOnly = false, isAuthenticated = false }: RemoteCanvasProps) {
  const [elements, setElements] = useState<CanvasElement[]>(initialData);
  const [activeTool, setActiveTool] = useState<string>("select");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save logic (Only if not read-only)
  useEffect(() => {
    if (readOnly) return;

    const timeout = setTimeout(async () => {
      if (JSON.stringify(elements) !== JSON.stringify(initialData)) {
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
  }, [elements, fileId, initialData, readOnly]);

  const handleToolSelect = (tool: string) => {
    if (readOnly) return;
    if (tool === "image") {
      fileInputRef.current?.click();
    } else {
      setActiveTool(tool);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
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
          x: 100,
          y: 100,
          width: img.width,
          height: img.height,
          // @ts-ignore
          src,
          opacity: 1,
          rotation: 0,
        };
        setElements((prev) => [...prev, newEl]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleShare = () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url);
      alert("Link copied to clipboard! Anyone with this link can view this canvas.");
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
      {!readOnly && <Toolbar activeTool={activeTool} onToolSelect={handleToolSelect} />}
      
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleImageUpload}
      />

      <Canvas
        elements={elements}
        setElements={setElements}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        readOnly={readOnly}
      />

      {/* Top Bar */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="p-2 bg-card rounded-full hover:bg-accent transition-colors border border-border"
        >
          <ArrowLeft className="h-4 w-4 text-foreground" />
        </Link>
        
        {!readOnly ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-card rounded-md border border-border">
            <span className="text-xs text-muted-foreground">
                {saving ? "Saving..." : "Saved"}
            </span>
            {!saving && <Save className="h-3 w-3 text-green-500" />}
            </div>
        ) : (
             <div className="flex items-center gap-2">
                 <div className="flex items-center gap-2 px-3 py-1.5 bg-card rounded-md border border-border">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">View Only</span>
                </div>
                {!isAuthenticated && (
                    <Link 
                        href="/sign-in"
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-md transition-colors font-medium"
                    >
                        Sign in to Edit
                    </Link>
                )}
            </div>
        )}
      </div>

      {/* Top Right Controls */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
          <ThemeToggle />
          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors shadow-lg"
          >
              <Share2 className="w-4 h-4" />
              <span className="text-sm font-medium">Share</span>
          </button>
      </div>
    </div>
  );
}
