import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { LocalCanvas } from "@/components/canvas/LocalCanvas";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

export default function Page() {
  return (
    <main className="relative h-screen w-full overflow-hidden">
      <LocalCanvas />
      
      {/* Auth Overlay */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-4">
        <SignedOut>
          <SignInButton mode="modal">
            <button className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/20">
              Sign In / Sign Up
            </button>
          </SignInButton>
        </SignedOut>
        
        <SignedIn>
          <Link 
            href="/dashboard"
            className="flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Link>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </div>
    </main>
  );
}

