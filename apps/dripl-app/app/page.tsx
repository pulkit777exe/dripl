// import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
// import Link from "next/link";
// import { LayoutDashboard } from "lucide-react";

import App from "@/components/canvas/Canvas";

export default function Page() {
  return (
    <div>
      <App />
      {/* <div className="pointer-events-none absolute inset-0 z-50">
        <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-3">
        <SignedOut>
        <SignInButton mode="modal">
        <button className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-all hover:bg-white/20 border border-white/10">
        Sign In / Sign Up
        </button>
        </SignInButton>
        </SignedOut>
        
        <SignedIn>
        <Link 
        href="/dashboard"
        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 shadow-lg"
        >
        <LayoutDashboard className="h-4 w-4" />
        Dashboard
        </Link>
        <div className="[&>button]:rounded-full [&>button]:border [&>button]:border-white/10">
        <UserButton 
        afterSignOutUrl="/"
        appearance={{
          elements: {
            avatarBox: "h-9 w-9"
            }
            }}
            />
            </div>
            </SignedIn>
            </div>
            </div> */}
    </div>
  );
}
