'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';
import { InlineError } from '@/components/ui/ErrorState';

const fieldClassName =
  'w-full rounded-md border border-[#D4D0C9] bg-white px-3 py-2 text-[14px] text-[#1A1917] outline-none t-theme placeholder:text-[#9B9890] focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20';

export default function SignupPage(): React.ReactNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ReactNode>('');
  const [loading, setLoading] = useState(false);
  // A ref, not the `loading` state, closes the double-submit window. `disabled` is
  // not in the DOM until React re-renders, and inside one batch the second
  // `handleSubmit` still closes over `loading === false` -- so a state guard is
  // inert by construction and two submits in the same tick fire two requests.
  // `DashboardFiles` already uses this shape. Released in the `finally` so one
  // failure does not wedge the form.
  const inFlightRef = useRef(false);
  const router = useRouter();
  const { signup } = useAuth();

  const handleSubmit = async (event?: React.FormEvent) => {
    // Latched before the first await, so a second submit in the same tick
    // returns instead of racing a duplicate registration or sign-in.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (event) event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signup(email, password, name);
      if (result.pendingVerification) {
        router.push('/verify-pending?email=' + encodeURIComponent(email));
      } else {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign up';

      // Branched on the message `/auth/register` actually sends.
      //
      // This tested for 'already verified', which is the error on
      // `/auth/resend-verification` (`routes/auth.ts:360`) — a route sign-up
      // never calls. The duplicate-address error is 'Email is already
      // registered' (`routes/auth.ts:102`), so the branch was unreachable and
      // the one failure that most needs the 'Sign in' link got plain text.
      if (errorMessage.includes('already registered')) {
        setError(
          <span>
            {errorMessage}{' '}
            <Link href="/login" className="underline hover:text-[#E8462A]">
              Sign in
            </Link>
          </span>
        );
      } else {
        setError(errorMessage);
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up your workspace in under a minute."
      isError={!!error}
    >
      {error && (
        <InlineError
          // Passed through as-is. This collapsed to
          // `typeof error === 'string' ? error : 'An error occurred'`, throwing away
          // the span built above — so a duplicate address was reported with no way
          // to sign in. `InlineError`'s prop is `ReactNode` and renders it, and
          // `/login` had the identical defect with the identical fix.
          message={error}
          onRetry={async () => {
            setError('');
            await handleSubmit();
          }}
          className="mb-4"
        />
      )}

      {/* Google OAuth — server-side redirect */}
      <div className="flex justify-center mb-4">
        <a
          href="/api/auth/google"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-[14px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE] w-[380px]"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </a>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-[#E4E0D9]" />
        <span className="text-[12px] text-[#9B9890]">or</span>
        <div className="h-px flex-1 bg-[#E4E0D9]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="signup-name" className="sr-only">
          Full name
        </label>
        <input
          id="signup-name"
          name="name"
          autoComplete="name"
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Full name"
          className={fieldClassName}
        />
        <label htmlFor="signup-email" className="sr-only">
          Email address
        </label>
        <input
          id="signup-email"
          name="email"
          autoComplete="email"
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="Enter your email"
          className={fieldClassName}
          required
        />
        <label htmlFor="signup-password" className="sr-only">
          Password
        </label>
        <input
          id="signup-password"
          name="password"
          autoComplete="new-password"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Password"
          className={fieldClassName}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-[14px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-[#6B6860] border-t-transparent rounded-full animate-spin" />
              Creating account...
            </>
          ) : (
            'Sign up with email'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-[#6B6860]">
        Already have an account?{' '}
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
