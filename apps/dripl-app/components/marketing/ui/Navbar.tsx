"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { name: "Product", href: "#product" },
  { name: "Solutions", href: "#solutions" },
  { name: "Pricing", href: "#pricing" },
  { name: "Changelog", href: "#changelog" },
];

export function Navbar() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4">
      <nav className="glass-card flex h-14 w-full max-w-[1040px] items-center justify-between rounded-full px-6 transition-all duration-300">
        {/* Logo */}
        <Link
          href="/"
          className="font-medium tracking-tight text-deep-charcoal"
        >
          Dripl
        </Link>

        {/* Links */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link, index) => (
            <Link
              key={link.name}
              href={link.href}
              className="relative px-4 py-2 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {hoveredIndex === index && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 z-[-1] rounded-full bg-structure-grey/50"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              {link.name}
            </Link>
          ))}
        </div>

        {/* CTA */}
        <Link
          href="/signup"
          className={cn(
            "flex h-8 items-center rounded-full bg-deep-charcoal px-4 text-sm font-medium text-white transition-transform hover:scale-105 active:scale-95",
            "shadow-attio-sm hover:shadow-attio-md"
          )}
        >
          Start for free
        </Link>
      </nav>
    </div>
  );
}
