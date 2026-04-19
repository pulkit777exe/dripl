'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';
  const { verifyEmail } = useAuth();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid verification token');
      return;
    }

    const verify = async () => {
      try {
        await verifyEmail(token);
        setStatus('success');
        setMessage('Email verified successfully! You can now log in.');
      } catch (err: unknown) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to verify email');
      }
    };

    verify();
  }, [token, verifyEmail]);

  return (
    <AuthShell
      title={
        status === 'success'
          ? 'Email verified!'
          : status === 'error'
            ? 'Verification failed'
            : 'Verifying...'
      }
      subtitle={status === 'loading' ? 'Please wait while we verify your email.' : ''}
    >
      {status === 'loading' && (
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#E4E0D9] border-t-[#E8462A]"></div>
        </div>
      )}

      {status === 'success' && (
        <>
          <div className="mb-4 rounded-md border border-[#2F9E44]/20 bg-[#E8F5E9] px-3 py-2.5 text-[13px] text-[#2F9E44]">
            {message}
          </div>
          <Link
            href="/login"
            className="block w-full rounded-md bg-[#E8462A] px-4 py-2 text-center text-[14px] font-medium text-white transition-colors hover:bg-[#D6302A]"
          >
            Go to login
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="mb-4 rounded-md border border-[#E8462A]/20 bg-[#FAE8E5] px-3 py-2.5 text-[13px] text-[#C0392B]">
            {message}
          </div>
          <Link
            href="/signup"
            className="block w-full rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-center text-[14px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE]"
          >
            Sign up again
          </Link>
        </>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-[#F0EDE6]">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#E4E0D9] border-t-[#E8462A]" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
