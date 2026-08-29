'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';

const fieldClassName =
  'w-full rounded-md border border-[#D4D0C9] bg-white px-3 py-2 text-sm text-[#1A1917] outline-none transition-all placeholder:text-[#9B9890] focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20';

export default function ForgotPasswordPage(): React.ReactNode {
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
    <AuthShell title="Reset password" subtitle="We’ll email you a secure reset link." isError={status === 'error'} onErrorShake={() => setStatus('idle')}>
      {status === 'success' ? (
        <div className="space-y-6 text-center">
          <div className="rounded-md border border-[#2f9e44] bg-[#b2f2bb] px-4 py-4 text-sm text-[#1A1917]">
            Reset link sent. Check your inbox and spam folder.
          </div>
          <Link
            href="/login"
            className="inline-flex rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-sm font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE]"
          >
            Back to login
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-5 rounded-md border border-[#C0392B] bg-[#FAE8E5] px-4 py-3 text-sm text-[#C0392B] t-error-msg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wider text-[#6B6860]">
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
              className="mt-2 w-full rounded-md bg-[#E8462A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#D93D22] disabled:opacity-50"
            >
              {status === 'loading' ? 'Sending link...' : 'Send reset link'}
            </button>
          </form>

          <div className="mt-8 border-t border-[#E4E0D9] pt-5">
            <p className="text-center text-sm text-[#6B6860]">
              Remember your password?{' '}
              <Link href="/login" className="font-medium text-[#E8462A] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </>
      )}
    </AuthShell>
  );
}
