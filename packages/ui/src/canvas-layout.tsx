import * as React from "react";
import { Menu, BookOpen } from "lucide-react";
import { cn } from "./utils/cn";
import { TopToolbar } from "./top-toolbar";
import { BottomToolbar } from "./bottom-toolbar";
import { IconButton } from "./icon-button";
import { Button } from "./button";

export interface CanvasLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  selectedTool?: string;
  onToolSelect?: (tool: string) => void;
  onMenuClick?: () => void;
  onShareClick?: () => void;
  onLibraryClick?: () => void;
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onScrollToContent?: () => void;
  showScrollButton?: boolean;
}

export const CanvasLayout = React.forwardRef<HTMLDivElement, CanvasLayoutProps>(
  ({ 
    className, 
    children,
    selectedTool = "hand",
    onToolSelect,
    onMenuClick,
    onShareClick,
    onLibraryClick,
    zoom = 100,
    onZoomIn,
    onZoomOut,
    onUndo,
    onRedo,
    onScrollToContent,
    showScrollButton = true,
    ...props 
  }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("w-full h-screen bg-gray-950 relative overflow-hidden", className)}
        {...props}
      >
        {/* Top Left Menu */}
        <div className="absolute top-4 left-4 z-10">
          <IconButton onClick={onMenuClick} title="Menu">
            <Menu className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Top Center Toolbar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <TopToolbar
            selectedTool={selectedTool}
            onToolSelect={onToolSelect}
          />
        </div>

        {/* Top Right Actions */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <Button variant="primary" onClick={onShareClick}>
            Share
          </Button>
          <IconButton onClick={onLibraryClick} title="Library">
            <BookOpen className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Main Canvas Area */}
        <div className="w-full h-full">
          {children}
        </div>

        {/* Bottom Center Toolbar */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <BottomToolbar
            zoom={zoom}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        </div>

        {/* Scroll to Content Button */}
        {showScrollButton && (
          <div className="absolute bottom-6 right-6 z-10">
            <Button variant="default" onClick={onScrollToContent}>
              Scroll back to content
            </Button>
          </div>
        )}
      </div>
    );
  }
);

CanvasLayout.displayName = "CanvasLayout";
