"use client";

import { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "./lib/utils.js";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  className?: string;
  appName: string;
}

export const Button = ({
  children,
  className,
  appName,
  ...props
}: ButtonProps) => {
  return (
    <button
      className={cn("px-4 py-2 rounded bg-blue-500 text-white", className)}
      {...props}
    >
      {children}
    </button>
  );
};
