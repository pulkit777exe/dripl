'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';

function VerifyPendingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get('email') || '';
  const { resendVerification } = useAuth();

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleResend = async () => {
    if (!email) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      await resendVerification(email);
      setMessage('Verification email sent! Please check your inbox.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resend email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Verify your email" subtitle="We've sent a verification email to your inbox.">
      {error && (
        <div className="mb-4 rounded-md border border-[#E8462A]/20 bg-[#FAE8E5] px-3 py-2.5 text-[13px] text-[#C0392B]">
          {error}
        </div>
      )}

      {message && (
        <div className="mb-4 rounded-md border border-[#2F9E44]/20 bg-[#E8F5E9] px-3 py-2.5 text-[13px] text-[#2F9E44]">
          {message}
        </div>
      )}

      {email && (
        <div className="mb-6 text-center">
          <p className="text-[14px] text-[#6B6860]">
            Sent to: <span className="font-medium text-[#1A1917]">{email}</span>
          </p>
        </div>
      )}

      <button
        onClick={handleResend}
        disabled={loading || !email}
        className="w-full rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-[14px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE] disabled:opacity-50"
      >
        {loading ? 'Sending...' : 'Resend verification email'}
      </button>

      <p className="mt-6 text-center text-[13px] text-[#6B6860]">
        Already verified?{' '}
        <Link
          href="/login"
          className="font-medium text-[#1A1917] underline underline-offset-2 hover:text-[#E8462A]"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function VerifyPendingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-[#F0EDE6]">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#E4E0D9] border-t-[#E8462A]" />
        </div>
      }
    >
      <VerifyPendingContent />
    </Suspense>
  );
}
