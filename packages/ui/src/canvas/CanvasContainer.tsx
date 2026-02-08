import * as React from "react";
import { cn } from "../lib/utils.js";

interface CanvasContainerProps {
  children: React.ReactNode;
  className?: string;
}

export const CanvasContainer = ({
  children,
  className,
}: CanvasContainerProps) => {
  return (
    <main
      className={cn(
        "relative flex-1 overflow-hidden bg-neutral-50/50 dark:bg-neutral-950/50",
        className,
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </main>
  );
};
