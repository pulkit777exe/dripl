'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';

const fieldClassName =
  'w-full rounded-xl border border-border/70 bg-secondary/35 px-4 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary/45 focus:bg-card focus:ring-2 focus:ring-primary/20';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const { forgotPassword } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    try {
      await forgotPassword(email);
      setStatus('success');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to submit request.');
    }
  };

  return (
    <AuthShell title="Reset password" subtitle="We’ll email you a secure reset link.">
      {status === 'success' ? (
        <div className="space-y-6 text-center">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-700 dark:text-emerald-300">
            Reset link sent. Check your inbox and spam folder.
          </div>
          <Link
            href="/login"
            className="inline-flex rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50"
          >
            Back to login
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-5 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                className={fieldClassName}
                required
              />
            </div>

            <button
              type="submit"
              disabled={status === 'loading' || !email}
              className="mt-2 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
            >
              {status === 'loading' ? 'Sending link...' : 'Send reset link'}
            </button>
          </form>

          <div className="mt-8 border-t border-border/50 pt-5">
            <p className="text-center text-sm text-muted-foreground">
              Remember your password?{' '}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </>
      )}
    </AuthShell>
  );
}
