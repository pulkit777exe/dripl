"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { Button } from "../ui/Button";
import { Play } from "lucide-react";
import { useRef } from "react";

export function HeroSection({
  onStartDrawing,
}: {
  onStartDrawing?: () => void;
}) {
  const { scrollY } = useScroll();
  const rotateX = useTransform(scrollY, [0, 400], [5, 0]);
  const scale = useTransform(scrollY, [0, 400], [0.95, 1]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0.5]);

  return (
    <section className="relative flex min-h-[120vh] flex-col items-center pt-32 md:pt-48">
      <div className="z-10 flex max-w-[900px] flex-col items-center text-center">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-white text-5xl font-medium leading-[1.1] tracking-[-0.04em] md:text-7xl"
        >
          The social scheduling canvas.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className="mt-6 max-w-[640px] text-lg font-light text-center leading-relaxed md:text-xl text-gray-400"
        >
          Stop thinking in lists. Dripl gives you an infinite collaborative
          workspace to plan, visualize, and schedule posts across every network
          at once.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          className="mt-10 flex items-center gap-4"
        >
          <Button
            variant="secondary"
            className="h-14 px-8 text-lg"
            onClick={onStartDrawing}
          >
            Start Drawing
          </Button>
          <Button variant="secondary" className="h-14 px-8 text-lg">
            <Play className="mr-2 h-4 w-4 fill-current" />
            View the demo
          </Button>
        </motion.div>
      </div>

      <motion.div
        style={{ rotateX, scale, opacity }}
        className="pointer-events-none sticky top-32 mt-20 h-[800px] w-full max-w-[1200px] perspective-[1000px]"
      >
        <div className="glass-card relative h-full w-full overflow-hidden rounded-xl border shadow-2xl backdrop-blur-xl">
          <div className="flex h-12 w-full items-center border-b bg-white/50 px-4">
            <div className="flex gap-2">
              <div className="h-3 w-3 rounded-full" />
              <div className="h-3 w-3 rounded-full" />
              <div className="h-3 w-3 rounded-full" />
            </div>
          </div>

          <div className="flex h-full w-full items-center justify-center bg-grid-pattern bg-size-[20px_20px] opacity-60">
            <div className="text-sm font-medium text-foreground/20">
              Interactive Canvas Animation Loading...
            </div>
            <div className="absolute top-1/4 left-1/4 h-48 w-64 rounded-lg shadow-attio-md border p-4 -rotate-2">
              <div className="h-4 w-24 rounded mb-3" />
              <div className="space-y-2">
                <div className="h-2 w-full rounded" />
                <div className="h-2 w-4/5 rounded" />
                <div className="h-2 w-3/5 rounded" />
              </div>
            </div>
            <div className="absolute top-1/3 right-1/4 h-48 w-64 rounded-lg shadow-attio-md border p-4 rotate-1">
              <div className="h-32 w-full rounded mb-2" />
              <div className="h-2 w-1/2 rounded" />
            </div>
          </div>
        </div>
      </motion.div>

      <div className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-100/30 blur-[120px]" />
    </section>
  );
}
