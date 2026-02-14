import * as React from "react";
import { cn } from "../lib/utils";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: "ghost" | "outline" | "solid";
  size?: "sm" | "md" | "lg";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, active, variant = "ghost", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "flex items-center justify-center rounded-lg transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-primary/20",
          {
            "bg-primary/10 text-primary": active && variant === "ghost",
            "hover:bg-neutral-100 dark:hover:bg-neutral-800":
              !active && variant === "ghost",
            "border border-neutral-200 dark:border-neutral-800":
              variant === "outline",
            "bg-primary text-primary-foreground hover:bg-primary/90":
              variant === "solid",
            "size-8 p-1.5": size === "sm",
            "size-9 p-2": size === "md",
            "size-10 p-2.5": size === "lg",
          },
          className,
        )}
        {...props}
      />
    );
  },
);

IconButton.displayName = "IconButton";
