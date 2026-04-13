'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../context/AuthContext';
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from '@react-oauth/google';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, googleLogin } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    if (credentialResponse.credential) {
      try {
        await googleLogin(credentialResponse.credential);
        router.push('/dashboard');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Google login failed');
      }
    }
  };

  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''}>
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
          <div className="bg-card border border-border/50 rounded-2xl shadow-xl p-8 backdrop-blur-sm">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-semibold text-foreground mb-2">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to continue to your canvas</p>
            </div>

            {error && (
              <div className="mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-secondary/40 border border-border/60 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/50 shadow-inner"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block">
                    Password
                  </label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
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
                disabled={loading}
                className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-all shadow-button hover:shadow-button-hover disabled:opacity-50 mt-2"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <div className="mt-6">
              <div className="relative flex py-4 items-center">
                <div className="grow border-t border-border"></div>
                <span className="shrink-0 mx-4 text-muted-foreground text-xs uppercase tracking-wider">
                  or sign in with
                </span>
                <div className="grow border-t border-border"></div>
              </div>
              <div className="flex justify-center mt-2">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError('Google login failed')}
                  theme="outline"
                  shape="rectangular"
                  size="large"
                />
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-border/50">
              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="text-primary font-medium hover:underline">
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </GoogleOAuthProvider>
  );
}
