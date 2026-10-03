import { redirect } from 'next/navigation';
import { serverApiGet, serverApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import { SharedFiles, type SharedFilesInitialData } from '@/components/dashboard/SharedFiles';
import type { SharedFileSummary } from '@/lib/api';

const PAGE_SIZE = 20;

/**
 * Collections, rendered on the server.
 *
 * Same conversion and same reasons as `app/dashboard/page.tsx`: the list used to
 * be fetched from `useEffect` behind a full-page `PageSkeleton`, twice on mount.
 * The rows are one person's, so this route is dynamic and `no-store` — a
 * prerender of somebody else's shares would be a disclosure, not a cache.
 *
 * Authentication is gated in `layout.tsx`, which is the segment's layout and so
 * covers this route too; the checks here are the same belt-and-braces the
 * dashboard keeps, and the reason is written in `app/dashboard/layout.tsx`.
 */
export default async function CollectionsPage(): Promise<React.ReactNode> {
  const userId = await readSessionUserId();
  if (!userId) redirect('/login');

  const token = await readSessionBearer();
  if (!token) redirect('/login');

  let initial: SharedFilesInitialData;
  try {
    initial = await serverApiGet<SharedFilesResponse>(`/files/shared?page=1&limit=${PAGE_SIZE}`, {
      token,
      cache: 'no-store',
    });
  } catch (error) {
    if (serverApiError(error, [401, 403])) redirect('/login');
    throw error;
  }

  return <SharedFiles initial={initial} />;
}

type SharedFilesResponse = {
  files: SharedFileSummary[];
  total: number;
  page: number;
  limit: number;
};
