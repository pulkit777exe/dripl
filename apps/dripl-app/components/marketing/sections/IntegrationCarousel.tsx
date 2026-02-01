"use client";

import Image from "next/image";

const INTEGRATIONS = [
  { name: "Reddit", file: "reddit.png" },
  { name: "YouTube", file: "youtube.png" },
  { name: "X / Twitter", file: "x.png" },
  { name: "Bluesky", file: "bluesky.png" },
  { name: "Threads", file: "threads.png" },
];

export function IntegrationCarousel() {
  return (
    <section className="relative w-full overflow-hidden border-y border-structure-grey/50 bg-off-white/50 py-12 backdrop-blur-sm">
      <div className="container mx-auto px-4 text-center">
        <p className="mb-8 text-xs font-semibold uppercase tracking-widest text-foreground/40">
          Native Integrations
        </p>

        <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-60 grayscale transition-all duration-500 hover:grayscale-0 hover:opacity-100">
          {INTEGRATIONS.map((app) => (
            <div
              key={app.name}
              className="group relative flex h-12 w-12 items-center justify-center transition-transform duration-300 hover:scale-110"
            >
              <Image
                src={`/logos/${app.file}`}
                alt={app.name}
                width={48}
                height={48}
                className="object-contain"
              />
              <div className="absolute -top-10 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-deep-charcoal px-2 py-1 text-[10px] font-medium text-white shadow-lg group-hover:block">
                {app.name} Supported
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
