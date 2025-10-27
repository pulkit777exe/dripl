import * as React from "react";
import { cn } from "./utils/cn";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "announcement" | "success" | "warning" | "error";
  size?: "sm" | "md" | "lg";
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", size = "md", children, ...props }, ref) => {
    const getVariantStyles = () => {
      switch (variant) {
        case "announcement":
          return {
            background: "rgba(107, 122, 137, 0.15)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(107, 122, 137, 0.3)",
            color: "var(--matty-blue)",
          };
        case "success":
          return {
            background: "rgba(34, 197, 94, 0.15)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
            color: "var(--content-success)",
          };
        case "warning":
          return {
            background: "rgba(234, 179, 8, 0.15)",
            border: "1px solid rgba(234, 179, 8, 0.3)",
            color: "#eab308",
          };
        case "error":
          return {
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "var(--content-error)",
          };
        default:
          return {
            background: "rgba(255, 255, 255, 0.1)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            color: "var(--content-emphasis)",
          };
      }
    };

    const getSizeStyles = () => {
      switch (size) {
        case "sm":
          return {
            padding: "0.25rem 0.75rem",
            fontSize: "0.75rem",
          };
        case "lg":
          return {
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
          };
        default:
          return {
            padding: "0.5rem 1.25rem",
            fontSize: "0.875rem",
          };
      }
    };

    return (
      <div
        ref={ref}
        className={cn("badge", className)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          borderRadius: "2rem",
          fontWeight: "600",
          transition: "all 0.3s ease",
          ...getVariantStyles(),
          ...getSizeStyles(),
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Badge.displayName = "Badge";

export { Badge };