import * as React from "react";
import { 
  Hand, 
  MousePointer2, 
  Pen, 
  Square, 
  Diamond, 
  Circle, 
  ArrowRight, 
  Minus, 
  Type, 
  Image, 
  Eraser, 
  Lock 
} from "lucide-react";
import { cn } from "./utils/cn";

export interface TopToolbarProps {
  selectedTool?: string;
  onToolSelect?: (tool: string) => void;
  className?: string;
}

const tools = [
  { id: 'lock', icon: Lock, label: 'Lock' },
  { id: 'hand', icon: Hand, label: 'Hand' },
  { id: 'cursor', icon: MousePointer2, label: 'Select' },
  { id: 'rectangle', icon: Square, label: 'Rectangle' },
  { id: 'diamond', icon: Diamond, label: 'Diamond' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'pen', icon: Pen, label: 'Draw' },
  { id: 'text', icon: Type, label: 'Text' },
  { id: 'image', icon: Image, label: 'Image' },
  { id: 'eraser', icon: Eraser, label: 'Eraser' },
];

export const TopToolbar = React.forwardRef<HTMLDivElement, TopToolbarProps>(
  ({ selectedTool = 'hand', onToolSelect, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-0.5 bg-gray-800/95 backdrop-blur-sm rounded-xl p-1.5 shadow-lg border border-gray-700",
          className
        )}
      >
        {tools.map((tool, index) => (
          <React.Fragment key={tool.id}>
            {(index === 1 || index === 3 || index === 7 || index === 9) && (
              <div className="w-px h-6 bg-gray-700 mx-1" />
            )}
            <button
              onClick={() => onToolSelect?.(tool.id)}
              className={cn(
                "p-2.5 rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                selectedTool === tool.id
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              )}
              title={tool.label}
              aria-label={tool.label}
            >
              <tool.icon className="w-4 h-4" />
            </button>
          </React.Fragment>
        ))}
      </div>
    );
  }
);

TopToolbar.displayName = "TopToolbar";