'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../context/AuthContext';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const { resetPassword } = useAuth();
  const router = useRouter();

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-destructive mb-4">Invalid or missing reset token.</p>
        <Link
          href="/forgot-password"
          className="text-primary text-sm font-medium hover:underline border border-border px-4 py-2 rounded-lg inline-block"
        >
          Request new link
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      await resetPassword(token, password);
      setStatus('success');
      setTimeout(() => router.push('/login'), 3000);
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    }
  };

  if (status === 'success') {
    return (
      <div className="text-center">
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
          <p className="text-sm text-green-600 font-medium">
            Password has been reset successfully!
          </p>
          <p className="text-xs text-green-700 mt-2">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm text-center">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">
          New Password
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-4 py-2.5 bg-secondary/40 border border-border/60 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all shadow-inner"
          required
        />
      </div>

      <button
        type="submit"
        disabled={status === 'loading' || !password}
        className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-all shadow-button hover:shadow-button-hover disabled:opacity-50 mt-2"
      >
        {status === 'loading' ? 'Resetting...' : 'Reset password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

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
            <h1 className="text-3xl font-semibold text-foreground mb-2">Set New Password</h1>
            <p className="text-sm text-muted-foreground">Enter your new password below.</p>
          </div>
          <Suspense fallback={<p>Loading...</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
