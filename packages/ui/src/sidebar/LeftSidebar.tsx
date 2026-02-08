import * as React from "react";
import { cn } from "../lib/utils.js";

interface LeftSidebarProps {
  children: React.ReactNode;
  collapsed?: boolean;
  className?: string;
}

export const LeftSidebar = ({
  children,
  collapsed,
  className,
}: LeftSidebarProps) => {
  return (
    <aside
      className={cn(
        "flex flex-col gap-4 border-r border-neutral-200/50 dark:border-neutral-800/50 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-sm transition-all duration-300",
        collapsed ? "w-0 overflow-hidden opacity-0" : "w-64 p-4 opacity-100",
        "h-full",
        className,
      )}
    >
      {children}
    </aside>
  );
};
