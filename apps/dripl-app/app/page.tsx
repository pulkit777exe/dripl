import Link from "next/link";
import { ArrowRight, Zap, Users, Shield } from "lucide-react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-indigo-500/30">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <span className="font-bold text-lg">D</span>
            </div>
            <span className="font-bold text-xl tracking-tight">Dripl</span>
          </div>
          
          <div className="flex items-center gap-6">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignInButton mode="modal">
                <button className="text-sm font-medium bg-white text-black px-4 py-2 rounded-full hover:bg-gray-100 transition-colors">
                  Get Started
                </button>
              </SignInButton>
            </SignedOut>
            
            <SignedIn>
              <Link 
                href="/canvas"
                className="text-sm font-medium bg-indigo-600 text-white px-4 py-2 rounded-full hover:bg-indigo-500 transition-colors"
              >
                Go to App
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(79,70,229,0.1),transparent_50%)]" />
        
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-8">
            <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-sm text-gray-400">v2.0 Now Available</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 bg-clip-text text-transparent bg-linear-to-b from-white to-white/60">
            Collaborate at the <br />
            speed of thought.
          </h1>
          
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            The premium whiteboard for teams that value aesthetics and performance. 
            Real-time collaboration, infinite canvas, and zero latency.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/canvas"
              className="group flex items-center gap-2 bg-white text-black px-8 py-4 rounded-full font-semibold hover:bg-gray-100 transition-all hover:scale-105"
            >
              Start Drawing Now
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <button className="px-8 py-4 rounded-full font-semibold text-gray-300 hover:text-white border border-white/10 hover:bg-white/5 transition-all">
              View Demo
            </button>
          </div>
        </div>

        {/* Abstract Visual */}
        <div className="mt-20 relative max-w-6xl mx-auto aspect-video rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden shadow-2xl shadow-indigo-500/10">
          <div className="absolute inset-0 bg-grid-white/[0.02]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/20 rounded-full blur-[100px]" />
          
          {/* Mock UI Elements */}
          <div className="absolute top-8 left-8 flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/20" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
            <div className="w-3 h-3 rounded-full bg-green-500/20" />
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6 bg-black/50">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: "Real-time Sync",
                desc: "See changes instantly as your team works together."
              },
              {
                icon: Users,
                title: "Multi-user",
                desc: "Collaborate with unlimited team members in one room."
              },
              {
                icon: Shield,
                title: "Secure by Default",
                desc: "Enterprise-grade security with Clerk authentication."
              }
            ].map((feature, i) => (
              <div key={i} className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <feature.icon className="w-10 h-10 text-indigo-500 mb-4" />
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-white/10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 text-gray-500 text-sm">
          <p>© 2024 Dripl Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
