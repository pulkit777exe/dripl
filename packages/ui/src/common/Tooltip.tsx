import * as React from "react";
import { cn } from "../lib/utils.js";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export const Tooltip = ({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) => {
  return (
    <div className="group relative flex items-center justify-center">
      {children}
      <div
        className={cn(
          "absolute z-50 px-2 py-1 text-xs font-medium text-white bg-neutral-900 rounded shadow-sm opacity-0 transition-opacity duration-200 pointer-events-none group-hover:opacity-100 whitespace-nowrap",
          {
            "-top-8": side === "top",
            "-bottom-8": side === "bottom",
            "-left-full mr-2": side === "left",
            "-right-full ml-2": side === "right",
          },
          className
        )}
      >
        {content}
      </div>
    </div>
  );
};
