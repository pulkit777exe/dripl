import * as React from "react";
import { cn } from "../lib/utils.js";

interface TopNavProps {
  children?: React.ReactNode;
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export const TopNav = ({
  children,
  left,
  center,
  right,
  className,
}: TopNavProps) => {
  return (
    <header
      className={cn(
        "flex h-14 items-center justify-between px-4",
        "bg-white/90 dark:bg-neutral-900/80 backdrop-blur-md",
        "border-b border-neutral-200/50 dark:border-neutral-800/50",
        "z-50",
        className,
      )}
    >
      <div className="flex items-center gap-4">{left}</div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {center}
      </div>
      <div className="flex items-center gap-4">{right}</div>
      {children}
    </header>
  );
};
