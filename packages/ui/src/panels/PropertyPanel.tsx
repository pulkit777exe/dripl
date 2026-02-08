import * as React from "react";
import { cn } from "../lib/utils.js";

interface PropertyPanelProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export const PropertyPanel = ({
  title,
  children,
  className,
}: PropertyPanelProps) => {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl p-3",
        "bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm",
        "border border-neutral-200/50 dark:border-neutral-800/50",
        "shadow-sm",
        className,
      )}
    >
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {title}
        </h3>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
};
