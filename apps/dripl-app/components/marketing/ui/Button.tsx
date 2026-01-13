"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline";
  children: React.ReactNode;
}

export function Button({
  className,
  variant = "primary",
  children,
  ...props
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { clientX, clientY } = e;
    const { left, top, width, height } = ref.current!.getBoundingClientRect();
    const x = (clientX - (left + width / 2)) * 0.35; // Magnetic pull strength
    const y = (clientY - (top + height / 2)) * 0.35;
    setPosition({ x, y });
  };

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
  };

  const variants = {
    primary: "bg-deep-charcoal text-white hover:bg-black shadow-attio-md",
    secondary:
      "bg-white text-foreground border border-structure-grey hover:bg-vapor-grey shadow-attio-sm",
    outline:
      "bg-transparent text-foreground border border-structure-grey hover:bg-white/50",
  };

  return (
    <motion.button
      ref={ref}
      className={cn(
        "relative flex h-12 items-center justify-center rounded-lg px-8 text-base font-medium transition-colors",
        variants[variant],
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      {...(props as any)}
    >
      {children}
    </motion.button>
  );
}
