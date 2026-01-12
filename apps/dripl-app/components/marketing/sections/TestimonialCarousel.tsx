"use client";

import { motion } from "motion/react";

const TESTIMONIALS = [
  {
    quote:
      "Dripl changed how our agency works. We stopped using spreadsheets and started actually designing our strategy.",
    author: "Sarah Jenkins",
    role: "Director of Brand",
  },
  {
    quote:
      "The canvas view is the only way I can visualize a month of content. Everything else feels archaic.",
    author: "Mike Chen",
    role: "Content Creator",
  },
  {
    quote:
      "Finally, a scheduling tool that doesn't feel like a spreadsheet. It feels like a design tool.",
    author: "Alex Rivera",
    role: "Freelance Designer",
  },
  {
    quote:
      "Collaboration has never been smoother. My clients actually enjoy reviewing content now.",
    author: "Jordan Lee",
    role: "Social Media Manager",
  },
];

export function TestimonialCarousel() {
  return (
    <section className="relative w-full overflow-hidden border-y border-structure-grey bg-white py-24">
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-32 bg-linear-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-32 bg-linear-to-l from-white to-transparent" />

      <div className="flex w-full">
        {/* Infinite Marquee Track */}
        <motion.div
          animate={{ x: "-50%" }}
          transition={{
            duration: 40,
            repeat: Infinity,
            ease: "linear",
          }}
          className="flex w-max gap-8 px-8 hover:paused"
        >
          {/* Duplicate set for seamless loop */}
          {[...TESTIMONIALS, ...TESTIMONIALS, ...TESTIMONIALS].map((t, i) => (
            <div
              key={i}
              className="group flex h-[320px] w-[400px] flex-col justify-between rounded-xl border border-structure-grey bg-white p-10 shadow-attio-sm transition-all hover:bg-off-white hover:shadow-attio-md"
            >
              <div className="text-6xl font-serif text-structure-grey transition-colors group-hover:text-deep-charcoal/20">
                &ldquo;
              </div>
              <p className="text-xl font-light leading-relaxed text-deep-charcoal">
                {t.quote}
              </p>
              <div className="mt-8 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-structure-grey" />
                <div>
                  <div className="font-semibold text-deep-charcoal">
                    {t.author}
                  </div>
                  <div className="text-sm text-foreground/40">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
