"use client";

import { useState, useRef, useEffect } from "react";
import {
  Layout,
  Code,
  Zap,
  Scissors,
  Sparkles,
  ChevronDown,
  Wand2,
} from "lucide-react";
import { useCanvasStore } from "@/lib/canvas-store";
import { AIGenerateModal } from "./AIGenerateModal";

interface ExtraTool {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
  perform: () => void;
  disabled?: boolean;
}

export function ExtraToolsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const setActiveTool = useCanvasStore((state) => state.setActiveTool);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const extraTools: ExtraTool[] = [
    {
      id: "frame",
      label: "Frame",
      icon: Layout,
      shortcut: "F",
      perform: () => {
        console.log("Frame tool selected");
        setIsOpen(false);
      },
    },
    {
      id: "embeddable",
      label: "Embeddable",
      icon: Code,
      perform: () => {
        console.log("Embeddable tool selected");
        setIsOpen(false);
      },
      disabled: true,
    },
    {
      id: "laser",
      label: "Laser",
      icon: Zap,
      shortcut: "K",
      perform: () => {
        console.log("Laser tool selected");
        setIsOpen(false);
      },
      disabled: true,
    },
    {
      id: "lasso",
      label: "Lasso",
      icon: Scissors,
      perform: () => {
        console.log("Lasso tool selected");
        setIsOpen(false);
      },
      disabled: true,
    },
  ];

  const generateTools: ExtraTool[] = [
    {
      id: "ai-diagram",
      label: "AI Diagram",
      icon: Wand2,
      perform: () => {
        setShowAIModal(true);
        setIsOpen(false);
      },
    },
    {
      id: "text-to-diagram",
      label: "Text to Diagram",
      icon: Sparkles,
      perform: () => {
        setShowAIModal(true);
        setIsOpen(false);
      },
    },
    {
      id: "mermaid",
      label: "Mermaid to Dripl",
      icon: Sparkles,
      perform: () => {
        setShowAIModal(true);
        setIsOpen(false);
      },
    },
  ];

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`
            relative p-2 rounded-lg transition-colors
            ${
              isOpen
                ? "bg-[#403c66] text-[#a8a5ff]"
                : "text-gray-300 hover:bg-[#31303b]"
            }
          `}
          aria-label="Extra tools"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <div className="w-5 h-5 grid grid-cols-2 gap-0.5">
            <div className="w-full h-full bg-current rounded-sm" />
            <div className="w-full h-full bg-current rounded-sm" />
            <div className="w-full h-full bg-current rounded-sm" />
            <div className="w-full h-full bg-current rounded-sm" />
          </div>
          <ChevronDown
            size={12}
            className={`absolute -bottom-1 -right-1 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-[#232329] rounded-lg border border-gray-700 shadow-2xl z-50 py-1">
            <div className="px-2 py-1.5 text-[11px] font-medium text-gray-500 uppercase">
              Tools
            </div>
            {extraTools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={tool.perform}
                  disabled={tool.disabled}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 text-sm transition-colors
                    ${
                      tool.disabled
                        ? "text-gray-600 cursor-not-allowed"
                        : "text-gray-300 hover:bg-[#31303b]"
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className="text-gray-500" />
                    <span>{tool.label}</span>
                  </div>
                  {tool.shortcut && (
                    <span className="text-xs text-gray-500 font-mono bg-[#1a1a20] px-1.5 py-0.5 rounded">
                      {tool.shortcut}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="w-full h-px bg-gray-700/50 my-2" />

            <div className="px-2 py-1.5 text-[11px] font-medium text-gray-500 uppercase flex items-center gap-1">
              <Sparkles size={12} className="text-[#6965db]" />
              AI Generate
            </div>
            {generateTools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={tool.perform}
                  disabled={tool.disabled}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 text-sm transition-colors
                    ${
                      tool.disabled
                        ? "text-gray-600 cursor-not-allowed"
                        : "text-gray-300 hover:bg-[#31303b]"
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className="text-[#6965db]" />
                    <span>{tool.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AIGenerateModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
      />
    </>
  );
}
