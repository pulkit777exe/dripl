'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';

/**
 * Sends a signed-in visitor to their dashboard, without holding the page back.
 *
 * This replaces an `if (loading) return <LoadingState/>` guard that sat in front
 * of the entire landing page: every visitor saw a full-viewport spinner until
 * `/auth/me` resolved, including the overwhelming majority who are not signed
 * in and would never need to be redirected at all.
 *
 * Doing it here rather than with `redirect()` on the server is a deliberate
 * trade. A server-side redirect would have to read the session cookie, which
 * makes `/` dynamic — and this is the one page whose whole job is to be
 * cacheable and indexable. Redirecting after hydration keeps the route a static
 * prerender (`Cache-Control: s-maxage=31536000`, `x-nextjs-prerender: 1`), keeps
 * the marketing copy in the first HTML response, and costs a signed-in visitor
 * one client-side navigation instead of one extra round trip on a spinner.
 *
 * `user` can be null either because nobody is signed in or because `loading` is
 * still true; the effect waits for `loading` to settle, so the second case
 * never produces a spurious redirect.
 */
export function SignedInRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  return null;
}
