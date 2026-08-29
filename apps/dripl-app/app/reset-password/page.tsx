'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '@/components/button/Spinner';

const fieldClassName =
  'w-full rounded-md border border-[#D4D0C9] bg-white px-3 py-2 text-sm text-[#1A1917] outline-none transition-all placeholder:text-[#9B9890] focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const { resetPassword } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  if (!token) {
    return (
      <div className="space-y-6 text-center">
        <p className="rounded-md border border-[#C0392B] bg-[#FAE8E5] px-4 py-3 text-sm text-[#C0392B]">
          Invalid or missing reset token.
        </p>
        <Link
          href="/forgot-password"
          className="inline-flex rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-sm font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE]"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    try {
      await resetPassword(token, password);
      setStatus('success');
      setTimeout(() => router.push('/login'), 2500);
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    }
  };

  if (status === 'success') {
    return (
      <div className="rounded-md border border-[#2f9e44] bg-[#b2f2bb] px-4 py-4 text-center text-sm text-[#1A1917]">
        Password reset successful. Redirecting you to login...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-[#C0392B] bg-[#FAE8E5] px-4 py-3 text-sm text-[#C0392B] t-error-msg">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-[#6B6860]">
          New password
        </label>
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          className={fieldClassName}
          required
        />
      </div>

      <button
        type="submit"
        disabled={status === 'loading' || !password}
        className="mt-2 w-full rounded-md bg-[#E8462A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#D93D22] disabled:opacity-50"
      >
        {status === 'loading' ? 'Resetting...' : 'Reset password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage(): React.ReactNode {
  return (
    <AuthShell title="Set new password" subtitle="Choose a strong password for your account.">
      <Suspense
        fallback={
          <div className="flex justify-center py-4">
            <Spinner className="size-5 text-[#6B6860]" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
