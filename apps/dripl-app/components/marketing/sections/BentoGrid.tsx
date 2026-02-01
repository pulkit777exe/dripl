"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const cards = [
  {
    title: "The Infinite Canvas",
    description: "Break free from the calendar grid.",
    className: "col-span-1 md:col-span-2 row-span-2",
  },
  {
    title: "Multi-Channel Nodes",
    description: "Write once, publish everywhere.",
    className: "col-span-1 md:col-span-1 row-span-2",
  },
  {
    title: "Real-time Multiplayer",
    description: "Built for teams.",
    className: "col-span-1 md:col-span-1 row-span-1",
  },
  {
    title: "Visual Context",
    description: "See exactly how it looks.",
    className: "col-span-1 md:col-span-2 row-span-1",
  },
];

export function BentoGrid() {
  return (
    <section className="container mx-auto px-4 py-24">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:auto-rows-[300px]">
        {cards.map((card, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className={cn(
              "group relative overflow-hidden rounded-3xl border border-structure-grey bg-white p-8 transition-all duration-300 hover:-translate-y-[2px] hover:border-zinc-300 hover:shadow-attio-md",
              card.className
            )}
          >
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <h3 className="text-lg font-medium tracking-tight text-deep-charcoal">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm text-foreground/60">
                  {card.description}
                </p>
              </div>

              <div className="mt-4 flex-1 rounded-xl bg-vapor-grey/50 border border-black/5" />
            </div>

            <div className="pointer-events-none absolute inset-0 z-0 bg-grid-pattern bg-size-[20px_20px] opacity-30" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
