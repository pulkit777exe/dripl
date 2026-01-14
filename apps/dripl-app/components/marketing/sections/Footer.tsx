import Link from "next/link";

const FOOTER_LINKS = {
  Product: ["Changelog", "Roadmap", "Download", "Status"],
  Company: ["About", "Careers", "Legal"],
  Social: ["Twitter", "LinkedIn", "GitHub"],
};

export function Footer() {
  return (
    <footer className="relative w-full overflow-hidden bg-white pt-24 pb-12">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-2 gap-12 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <h3 className="mb-4 font-medium tracking-tight text-deep-charcoal">
              Dripl
            </h3>
            <p className="text-sm leading-relaxed text-foreground/60">
              Made for creators,
              <br />
              by creators.
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category} className="col-span-1">
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-foreground/40">
                {category}
              </h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link}>
                    <Link
                      href="#"
                      className="text-sm text-foreground/60 transition-colors hover:text-foreground"
                    >
                      {link}
                      {link === "Careers" && (
                        <span className="ml-2 rounded-full bg-deep-charcoal/5 px-2 py-0.5 text-[10px] font-medium text-deep-charcoal">
                          Hiring
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-32 flex w-full justify-center opacity-10 select-none">
          <h1 className="text-[20vw] font-bold leading-none tracking-tighter text-deep-charcoal">
            DRIPL
          </h1>
        </div>
      </div>
    </footer>
  );
}
