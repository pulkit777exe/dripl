import * as React from "react";
import { cn } from "../lib/utils.js";

interface ToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export const Toolbar = ({ children, className }: ToolbarProps) => {
  return (
    <div
      className={cn(
        "flex items-center gap-1 p-1.5",
        "bg-white/90 dark:bg-neutral-900/80 backdrop-blur-md",
        "border border-neutral-200/50 dark:border-neutral-800/50",
        "rounded-2xl shadow-lg shadow-neutral-200/20 dark:shadow-black/20",
        "pointer-events-auto",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const ToolbarSeparator = () => (
  <div className="mx-1 h-6 w-px bg-neutral-200 dark:bg-neutral-800" />
);
