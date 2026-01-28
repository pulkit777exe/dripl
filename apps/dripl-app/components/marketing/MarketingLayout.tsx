import { Navbar } from "./ui/Navbar";
import { Footer } from "./sections/Footer";

interface MarketingLayoutProps {
  children: React.ReactNode;
}

export function MarketingLayout({ children }: MarketingLayoutProps) {
  return (
    <div className="relative min-h-screen  font-sans text-foreground selection:bg-structure-grey/30">
      <div className="pointer-events-none fixed inset-0 z-0 bg-grid-pattern bg-size-[40px_40px] opacity-[0.4]" />

      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.02] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      <Navbar />

      <main className="relative z-10 flex flex-col items-center">
        {children}
      </main>

      <Footer />
    </div>
  );
}
