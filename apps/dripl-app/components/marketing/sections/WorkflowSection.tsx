"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    kicker: "Step 1: Ideation",
    title: "Start with a mess. It's okay.",
    description:
      "Dump every idea onto the canvas. Images, text, links. Don't worry about order yet.",
    color: "bg-blue-100",
  },
  {
    kicker: "Step 2: Refining",
    title: "Group, edit, and tag.",
    description:
      "Drag related items together. The canvas automatically snaps them into clean stacks.",
    color: "bg-purple-100",
  },
  {
    kicker: "Step 3: Scheduling",
    title: "Drag to the timeline.",
    description:
      "When you're ready, just drag your stack to the sidebar. Done.",
    color: "bg-emerald-100",
  },
];

export function WorkflowSection() {
  const targetRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start start", "end end"],
  });

  return (
    <section ref={targetRef} className="container mx-auto px-4 py-24">
      <div className="relative flex min-h-[300vh] flex-col md:flex-row">
        {/* Sticky Sidebar (Left) */}
        <div className="top-32 flex h-fit w-full flex-col gap-20 py-32 md:sticky md:w-1/2 md:gap-0 md:py-0">
          {STEPS.map((step, i) => (
            <StepText
              key={i}
              step={step}
              index={i}
              progress={scrollYProgress}
            />
          ))}
        </div>

        <div className="flex w-full flex-col gap-40 md:w-1/2 md:gap-[50vh] md:pb-[50vh] md:pt-[20vh]">
          {STEPS.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-20%" }}
              transition={{ duration: 0.5 }}
              className={cn(
                "flex aspect-square w-full items-center justify-center rounded-3xl border border-structure-grey shadow-attio-lg",
                step.color
              )}
            >
              <div className="text-center font-medium text-deep-charcoal/20">
                Visual for {step.kicker}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepText({
  step,
  index,
  progress,
}: {
  step: (typeof STEPS)[0];
  index: number;
  progress: any;
}) {
  const opacity = useTransform(
    progress,
    [
      (index - 0.5) / STEPS.length,
      index / STEPS.length,
      (index + 0.5) / STEPS.length,
    ],
    [0.2, 1, 0.2]
  );

  return (
    <motion.div
      style={{ opacity }}
      className="flex h-[30vh] flex-col justify-center transition-opacity duration-300 md:h-[50vh]"
    >
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-deep-charcoal/60">
        {step.kicker}
      </div>
      <h2 className="mb-6 text-4xl font-medium tracking-tight text-deep-charcoal md:text-5xl">
        {step.title}
      </h2>
      <p className="max-w-md text-lg leading-relaxed text-foreground/60">
        {step.description}
      </p>
    </motion.div>
  );
}
