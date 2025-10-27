import * as React from "react";
import { cn } from "./utils/cn";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    const variants = {
      default: "bg-gray-800/95 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700",
      primary: "bg-indigo-600 hover:bg-indigo-700 text-white",
      ghost: "hover:bg-gray-700 text-gray-300 hover:text-white",
    };

    const sizes = {
      sm: "p-1.5",
      md: "p-2",
      lg: "p-2.5",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "rounded-lg transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

IconButton.displayName = "IconButton";
