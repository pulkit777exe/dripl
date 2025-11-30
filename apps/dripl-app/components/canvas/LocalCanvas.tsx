"use client";

import React, { useEffect, useRef, useState } from "react";
import { CanvasElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";
import { Toolbar } from "./Toolbar";
import { Canvas } from "./Canvas";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

// Helper to save/load from localStorage
const STORAGE_KEY = "dripl_local_state";

export function LocalCanvas() {
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [activeTool, setActiveTool] = useState<string>("select");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setElements(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load local canvas state", e);
      }
    }
  }, []);

  // Save to storage on change
  useEffect(() => {
    if (elements.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(elements));
    }
  }, [elements]);

  const handleToolSelect = (tool: string) => {
    if (tool === "image") {
      fileInputRef.current?.click();
    } else {
      setActiveTool(tool);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
      <Toolbar activeTool={activeTool} onToolSelect={handleToolSelect} />
      
      {/* Theme Toggle */}
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      
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
      />
    </div>
  );
}
