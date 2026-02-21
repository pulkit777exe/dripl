"use client";

import { useCallback, useState } from "react";
import { Check, HelpCircle } from "lucide-react";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { CanvasControls } from "@/components/canvas/CanvasControls";
import { useTheme } from "@/hooks/useTheme";
import { TopBar } from "@/components/canvas/TopBar";
import { CanvasBootstrap } from "@/components/canvas/CanvasBootstrap";
import { CommandPalette } from "@/components/canvas/CommandPalette";
import HelpModal from "@/components/canvas/HelpModal";
import { useCanvasStore } from "@/lib/canvas-store";

export default function CanvasPage() {
  const { effectiveTheme } = useTheme();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const setPan = useCanvasStore((s) => s.setPan);
  const showScrollBack = panX !== 0 || panY !== 0;

  const scrollBackToContent = useCallback(() => {
    setPan(0, 0);
  }, [setPan]);

  return (
    <div className="w-screen h-dvh relative overflow-hidden bg-canvas-bg">
      <TopBar />
      <CanvasBootstrap mode="local" theme={effectiveTheme} />

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
        <CanvasToolbar />
        <p className="text-xs text-hint-text text-pretty text-center max-w-md px-2">
          To move canvas, hold{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-hint-bg border border-toolbar-border text-hint-text font-mono text-[10px]">
            Scroll wheel
          </kbd>{" "}
          or{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-hint-bg border border-toolbar-border text-hint-text font-mono text-[10px]">
            Space
          </kbd>{" "}
          while dragging, or use the hand tool.
        </p>
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      {showScrollBack && (
        <button
          type="button"
          onClick={scrollBackToContent}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-lg bg-toolbar-bg border border-toolbar-border text-foreground text-sm font-medium shadow-lg hover:bg-tool-hover-bg transition-colors duration-150 pointer-events-auto"
          aria-label="Scroll back to content"
        >
          Scroll back to content
        </button>
      )}

      <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          className="size-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md"
          aria-label="Status"
        >
          <Check className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="size-10 rounded-full bg-toolbar-bg border border-toolbar-border text-foreground flex items-center justify-center shadow-md hover:bg-tool-hover-bg transition-colors duration-150"
          aria-label="Help"
        >
          <HelpCircle className="size-5" />
        </button>
      </div>

      <CommandPalette />
      {isHelpOpen && (
        <HelpModal onClose={() => setIsHelpOpen(false)} />
      )}
    </div>
  );
}
