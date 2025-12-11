import React from "react";
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
  Edit3,
} from "lucide-react";
import { ToolButton } from "./ToolButton";
import { ToolType } from "@/types/canvas";

interface ToolbarProps {
  activeTool: string;
  onToolChange: (tool: ToolType) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onToolChange,
}) => {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#232329] p-1.5 rounded-xl border border-gray-700 shadow-2xl flex items-center gap-0.5 z-50">
      <ToolButton icon={<Lock size={17} />} title="Lock" />
      <div className="w-px h-6 bg-gray-700 mx-1.5" />
      <ToolButton
        icon={<Hand size={19} />}
        isActive={activeTool === "hand"}
        onClick={() => onToolChange("hand")}
        title="Hand (H)"
      />
      <ToolButton
        icon={<MousePointer2 size={19} />}
        isActive={activeTool === "select"}
        onClick={() => onToolChange("select")}
        title="Selection (V)"
      />
      <ToolButton
        icon={<Square size={19} />}
        isActive={activeTool === "rectangle"}
        onClick={() => onToolChange("rectangle")}
        title="Rectangle (R)"
      />
      <ToolButton
        icon={
          <div className="rotate-45">
            <Square size={19} />
          </div>
        }
        isActive={activeTool === "diamond"}
        onClick={() => onToolChange("diamond")}
        title="Diamond (D)"
      />
      <ToolButton
        icon={<Circle size={19} />}
        isActive={activeTool === "circle"}
        onClick={() => onToolChange("circle")}
        title="Circle (O)"
      />
      <ToolButton
        icon={<ArrowRight size={19} />}
        isActive={activeTool === "arrow"}
        onClick={() => onToolChange("arrow")}
        title="Arrow (A)"
      />
      <ToolButton
        icon={<Minus size={19} />}
        isActive={activeTool === "line"}
        onClick={() => onToolChange("line")}
        title="Line (L)"
      />
      <ToolButton
        icon={<Edit3 size={19} />}
        isActive={activeTool === "draw"}
        onClick={() => onToolChange("draw")}
        title="Draw (P)"
      />
      <ToolButton
        icon={<Type size={19} />}
        isActive={activeTool === "text"}
        onClick={() => onToolChange("text")}
        title="Text (T)"
      />
      <ToolButton
        icon={<Image size={19} />}
        isActive={activeTool === "image"}
        onClick={() => onToolChange("image")}
        title="Image"
      />
      <ToolButton
        icon={<Eraser size={19} />}
        isActive={activeTool === "eraser"}
        onClick={() => onToolChange("eraser")}
        title="Eraser (E)"
      />
    </div>
  );
};
