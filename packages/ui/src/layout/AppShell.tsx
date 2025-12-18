import * as React from "react";
import { cn } from "../lib/utils.js";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
}

export const AppShell = ({ children, className }: AppShellProps) => {
  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100",
        className
      )}
    >
      {children}
    </div>
  );
};
