import { redirect } from 'next/navigation';
import { serverApiGet, serverApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import { DashboardFiles, type DashboardInitialFiles } from '@/components/dashboard/DashboardFiles';
import type { FileSummary } from '@/lib/api';

const PAGE_SIZE = 20;

/**
 * The dashboard, rendered on the server.
 *
 * This page used to be a Client Component that fetched page one of the user's
 * files from `useEffect` and rendered `<PageSkeleton/>` — at full page height —
 * for the whole of that. Measured against a production build, the canvas tiles
 * appeared ~850ms after navigation start, behind HTML (which contained only the
 * skeleton), the JS bundle, `/auth/me`, and `/files`. They now arrive in the
 * first HTML response.
 *
 * Two consequences of doing this that are worth stating rather than leaving to
 * be discovered:
 *
 * - **The route is no longer statically prerendered.** It cannot be: the body is
 *   one person's file list, and a prerender of it would be served to whoever
 *   hit the page next. Reading the cookie opts the route into dynamic rendering,
 *   which is what makes Next emit `Cache-Control: private, no-cache, no-store`.
 *   That header is the security property; the lost prerender is its cost.
 * - **The auth check moves from the client to the server.** `useAuth()` used to
 *   resolve first and then call `router.replace('/login')`, so an anonymous
 *   visitor got the skeleton and only then the redirect. The refusal is now the
 *   first thing that happens. The gate itself lives in `layout.tsx`, because a
 *   `redirect()` from inside this page's Suspense boundary arrives too late to
 *   set a status code; that note is where the reasoning lives too.
 *
 * Search, pagination and mutations stay on the client inside
 * `components/dashboard/DashboardFiles.tsx`, seeded with what is rendered here.
 */
export default async function DashboardPage(): Promise<React.ReactNode> {
  // The layout has already refused an anonymous request, so a null user here is
  // not reachable in normal operation. It is still handled rather than assumed,
  // because this page makes a personalized request and must never do that
  // unauthenticated — and because `layout.tsx` and this file are two files that
  // a future edit could reorder.
  const userId = await readSessionUserId();
  if (!userId) redirect('/login');

  const token = await readSessionBearer();
  // `readSessionUserId` accepted this session, so a null token here would mean
  // the two readers disagreed about the same cookie. Refusing is the safe
  // reading of that, and it cannot leak: nothing about the user is rendered.
  if (!token) redirect('/login');

  let initial: DashboardInitialFiles;
  try {
    initial = await serverApiGet<DashboardFilesResponse>(`/files?page=1&limit=${PAGE_SIZE}`, {
      token,
      cache: 'no-store',
    });
  } catch (error) {
    // A 401/403 here means the session verified but the API refused it, which
    // is the same outcome as no session at all. Anything else is a genuine
    // upstream failure and belongs in the error boundary rather than being
    // dressed up as "please sign in".
    if (serverApiError(error, [401, 403])) redirect('/login');
    throw error;
  }

  return <DashboardFiles initial={initial} />;
}

type DashboardFilesResponse = {
  files: FileSummary[];
  total: number;
  page: number;
  limit: number;
};
