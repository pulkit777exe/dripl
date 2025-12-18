import * as React from "react";
import { cn } from "../lib/utils.js";
import { Tooltip } from "../common/Tooltip.js";

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

export const ToolbarButton = React.forwardRef<
  HTMLButtonElement,
  ToolbarButtonProps
>(({ className, isActive, icon, label, shortcut, ...props }, ref) => {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
      <button
        ref={ref}
        className={cn(
          "flex size-10 items-center justify-center rounded-xl transition-all duration-200",
          "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
          "focus:outline-none focus:ring-2 focus:ring-primary/20",
          {
            "bg-primary/10 text-primary hover:text-primary dark:text-primary dark:hover:text-primary":
              isActive,
            "hover:bg-neutral-100 dark:hover:bg-neutral-800": !isActive,
          },
          className
        )}
        {...props}
      >
        {icon}
      </button>
    </Tooltip>
  );
});

ToolbarButton.displayName = "ToolbarButton";
