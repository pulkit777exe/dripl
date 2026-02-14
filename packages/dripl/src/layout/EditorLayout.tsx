import * as React from "react";
import { cn } from "../lib/utils";

interface EditorLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export const EditorLayout = ({ children, className }: EditorLayoutProps) => {
  return (
    <div className={cn("flex flex-1 overflow-hidden", className)}>
      {children}
    </div>
  );
};
