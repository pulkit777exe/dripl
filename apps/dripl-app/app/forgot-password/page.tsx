"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const { forgotPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    try {
      await forgotPassword(email);
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to submit request.");
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none"
           style={{
             backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")"
           }} />

      <div className="absolute top-8 left-8 flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-linear-to-br from-primary to-primary/80 flex items-center justify-center shadow-md">
          <span className="text-primary-foreground font-bold text-sm">D</span>
        </div>
        <Link href="/" className="font-semibold text-foreground text-xl tracking-tight">
          Dripl
        </Link>
      </div>

      <div className="w-full max-w-md p-8 relative">
        <div className="bg-card border border-border/70 rounded-2xl shadow-md p-8">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-semibold text-foreground mb-2">Reset Password</h1>
            <p className="text-sm text-muted-foreground">We&apos;ll send you a link to reset your password.</p>
          </div>

          {status === "success" ? (
            <div className="text-center">
              <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <p className="text-sm text-green-600 font-medium">Reset link sent! Please check your inbox.</p>
              </div>
              <Link href="/login" className="text-primary text-sm font-medium hover:underline border border-border px-4 py-2 rounded-lg inline-block">
                Back to login
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm text-center">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-secondary/40 border border-border/60 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/50 shadow-inner"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={status === "loading" || !email}
                  className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-all shadow-button hover:shadow-button-hover disabled:opacity-50 mt-2"
                >
                  {status === "loading" ? "Sending link..." : "Send reset link"}
                </button>
              </form>

              <div className="mt-8 pt-6 border-t border-border/50">
                <p className="text-center text-sm text-muted-foreground">
                  Remember your password?{" "}
                  <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
