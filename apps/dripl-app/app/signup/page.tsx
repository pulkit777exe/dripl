"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signup(email, password, name);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Failed to sign up");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#F5F0E8] dark:bg-[#141210] relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="absolute top-8 left-8">
        <Link
          href="/"
          className="text-2xl font-[var(--font-dm-serif)] text-[#1A1A1A] dark:text-[#E8E0D4] tracking-tight"
        >
          Dripl
        </Link>
      </div>

      <div className="w-full max-w-md p-8 relative">
        <div className="bg-white dark:bg-[#1E1B18] border border-[#D4C9B8] dark:border-[#3A342E] rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-[var(--font-dm-serif)] text-[#1A1A1A] dark:text-[#E8E0D4] mb-2">
              Create account
            </h1>
            <p className="text-sm text-[#7A7267] dark:text-[#8A7F72] font-[var(--font-source-sans)]">
              Start drawing and collaborating today
            </p>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-[#FDE8E4] dark:bg-[#3D2A25] border border-[#D94F3D]/20 rounded-sm text-[#D94F3D] dark:text-[#E86B5A] text-sm font-[var(--font-source-sans)]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A7267] dark:text-[#8A7F72] mb-2 font-[var(--font-source-sans)]">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F5F0E8] dark:bg-[#141210] border border-[#D4C9B8] dark:border-[#3A342E] rounded-sm text-[#1A1A1A] dark:text-[#E8E0D4] font-[var(--font-source-sans)] focus:outline-none focus:border-[#D94F3D] dark:focus:border-[#E86B5A] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A7267] dark:text-[#8A7F72] mb-2 font-[var(--font-source-sans)]">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F5F0E8] dark:bg-[#141210] border border-[#D4C9B8] dark:border-[#3A342E] rounded-sm text-[#1A1A1A] dark:text-[#E8E0D4] font-[var(--font-source-sans)] focus:outline-none focus:border-[#D94F3D] dark:focus:border-[#E86B5A] transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A7267] dark:text-[#8A7F72] mb-2 font-[var(--font-source-sans)]">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F5F0E8] dark:bg-[#141210] border border-[#D4C9B8] dark:border-[#3A342E] rounded-sm text-[#1A1A1A] dark:text-[#E8E0D4] font-[var(--font-source-sans)] focus:outline-none focus:border-[#D94F3D] dark:focus:border-[#E86B5A] transition-colors"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#D94F3D] hover:bg-[#C44535] dark:bg-[#E86B5A] dark:hover:bg-[#D45E4D] text-white dark:text-[#141210] rounded-sm font-semibold font-[var(--font-source-sans)] transition-colors disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#E8E0D4] dark:border-[#3A342E]">
            <p className="text-center text-sm text-[#7A7267] dark:text-[#8A7F72] font-[var(--font-source-sans)]">
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="text-[#D94F3D] dark:text-[#E86B5A] hover:underline font-semibold"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
