"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/context/AuthContext";

export default function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [loading, router, user]);

  return (
    <main className="min-h-dvh bg-[#f5f0e8] text-[#1a1a1a]">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-sm uppercase tracking-[0.2em] text-[#7a7267]">
          Dripl
        </p>
        <h1 className="mt-4 text-5xl font-[var(--font-dm-serif)] leading-tight">
          Whiteboard ideas with real-time collaboration.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-[#5f584f]">
          Draw, share, and collaborate on an infinite canvas. Create a file, invite
          teammates, and keep everything synced live.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/auth/login"
            className="rounded-sm bg-[#1a1a1a] px-5 py-3 text-sm font-semibold text-[#f5f0e8]"
          >
            Sign in
          </Link>
          <Link
            href="/auth/register"
            className="rounded-sm border border-[#1a1a1a] px-5 py-3 text-sm font-semibold"
          >
            Get started
          </Link>
        </div>
      </div>
    </main>
  );
}
