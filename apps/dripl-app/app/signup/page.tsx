'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuth } from '../context/AuthContext';

const fieldClassName =
  'w-full rounded-md border border-[#D4D0C9] bg-white px-3 py-2 text-[14px] text-[#1A1917] outline-none transition-all placeholder:text-[#9B9890] focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ReactNode>('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { signup, googleLogin } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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

      // Check if it's a verification resend
      if (errorMessage.includes('already verified')) {
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
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) return;
    try {
      await googleLogin(credentialResponse.credential);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google signup failed');
    }
  };

  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''}>
      <AuthShell title="Create your account" subtitle="Set up your workspace in under a minute.">
        {error && (
          <div className="mb-4 rounded-md border border-[#E8462A]/20 bg-[#FAE8E5] px-3 py-2.5 text-[13px] text-[#C0392B]">
            {error}
          </div>
        )}

        {/* Google button first */}
        <div className="flex justify-center mb-4">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => setError('Google signup failed')}
            theme="outline"
            shape="rectangular"
            size="large"
            width="380"
            text="continue_with"
          />
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-[#E4E0D9]" />
          <span className="text-[12px] text-[#9B9890]">or</span>
          <div className="h-px flex-1 bg-[#E4E0D9]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Full name"
            className={fieldClassName}
          />
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="Enter your email"
            className={fieldClassName}
            required
          />
          <input
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
            className="w-full rounded-md border border-[#D4D0C9] bg-white px-4 py-2 text-[14px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE] disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Sign up with email'}
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
    </GoogleOAuthProvider>
  );
}
