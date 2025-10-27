import * as React from "react";
import { cn } from "./utils/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "glass" | "gradient";
  hover?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "glass", hover = false, children, ...props }, ref) => {
    const getVariantStyles = () => {
      switch (variant) {
        case "glass":
          return {
            backgroundColor: "rgba(107, 122, 137, 0.1)",
            backdropFilter: "blur(24px)",
            border: "1px solid var(--border-default)",
          };
        case "gradient":
          return {
            background: "linear-gradient(135deg, rgba(107, 122, 137, 0.1) 0%, rgba(205, 188, 168, 0.1) 100%)",
            border: "1px solid rgba(107, 122, 137, 0.2)",
          };
        default:
          return {
            backgroundColor: "var(--bg-default)",
            border: "1px solid var(--border-default)",
          };
      }
    };

    const baseStyles = {
      borderRadius: "1.5rem",
      boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
      transition: hover ? "all 0.3s ease" : "none",
      ...getVariantStyles(),
    };

    const hoverStyles = hover ? {
      transform: "translateY(-4px)",
      boxShadow: "0 35px 60px -12px rgba(0, 0, 0, 0.35)",
    } : {};

    return (
      <div
        ref={ref}
        className={cn("card", className)}
        style={baseStyles}
        onMouseEnter={(e) => {
          if (hover) {
            Object.assign(e.currentTarget.style, hoverStyles);
          }
        }}
        onMouseLeave={(e) => {
          if (hover) {
            e.currentTarget.style.transform = "";
            e.currentTarget.style.boxShadow = baseStyles.boxShadow;
          }
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn("card-header", className)} 
      style={{ padding: "1.5rem 1.5rem 1rem 1.5rem" }}
      {...props} 
    />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 
      ref={ref} 
      className={cn("card-title", className)} 
      style={{ 
        fontSize: "1.5rem", 
        fontWeight: "700", 
        color: "var(--content-emphasis)",
        margin: 0
      }} 
      {...props} 
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p 
      ref={ref} 
      className={cn("card-description", className)} 
      style={{ 
        fontSize: "0.875rem", 
        color: "var(--content-muted)", 
        marginTop: "0.5rem",
        margin: 0
      }} 
      {...props} 
    />
  )
);
CardDescription.displayName = "CardDescription";

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
}

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, padding = "md", ...props }, ref) => {
    const getPaddingStyles = () => {
      switch (padding) {
        case "none":
          return { padding: "0" };
        case "sm":
          return { padding: "1rem" };
        case "lg":
          return { padding: "2rem" };
        default:
          return { padding: "1.5rem" };
      }
    };

    return (
      <div 
        ref={ref} 
        className={cn("card-content", className)} 
        style={getPaddingStyles()}
        {...props} 
      />
    );
  }
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div 
      ref={ref} 
      className={cn("card-footer", className)} 
      style={{ padding: "1.5rem 1.5rem 0 1.5rem" }}
      {...props} 
    />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };