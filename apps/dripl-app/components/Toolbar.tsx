"use client";

import { useEffect, useState } from "react";
import { SHAPES } from "@dripl/common";
import { canvasStore } from "@dripl/state";
import { Square, Circle, Type, ArrowRight, MousePointer2 } from "lucide-react";

export default function Toolbar() {
  const [tool, setToolState] = useState(canvasStore.state.tool);
  
  // Subscribe to tool changes
  useEffect(() => {
    const unsubscribe = canvasStore.subscribe(() => {
      setToolState(canvasStore.state.tool);
    });
    return unsubscribe;
  }, []);

  const setTool = (newTool: string) => {
    canvasStore.setState((state) => ({ ...state, tool: newTool }));
  };

  const tools = [
    { id: "selection", icon: MousePointer2, label: "Selection" },
    { id: SHAPES.RECTANGLE, icon: Square, label: "Rectangle" },
    { id: SHAPES.ELLIPSE, icon: Circle, label: "Ellipse" },
    { id: SHAPES.ARROW, icon: ArrowRight, label: "Arrow" },
    { id: SHAPES.TEXT, icon: Type, label: "Text" },
  ];

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white shadow-lg rounded-lg p-2 flex gap-2 border border-gray-200">
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          className={`p-2 rounded hover:bg-gray-100 ${
            tool === t.id ? "bg-blue-100 text-blue-600" : "text-gray-700"
          }`}
          title={t.label}
        >
          <t.icon size={20} />
        </button>
      ))}
    </div>
  );
}
