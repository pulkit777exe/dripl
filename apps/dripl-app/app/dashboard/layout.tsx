import { redirect } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { readSessionUserId } from '@/lib/server/session';

/**
 * The dashboard shell, and the route's authentication gate.
 *
 * The gate lives here rather than in `page.tsx` for a reason that only shows up
 * in the response status. `loading.tsx` puts a Suspense boundary around
 * `page.tsx`, so Next flushes the streaming skeleton — and commits a `200` —
 * before the page's body runs. A `redirect()` from inside that boundary therefore
 * cannot change the status code: an anonymous request used to be answered with
 * `307 /login` and would start being answered with `200` plus the skeleton plus a
 * client-side navigation. The layout renders outside the boundary, so a refusal
 * from here is still a hard redirect before any dashboard markup exists.
 *
 * Nothing is rendered on the way out, and no file list is ever requested for an
 * anonymous caller, so this is the same refusal the client produced — reached
 * sooner, and without first painting a dashboard-shaped skeleton.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactNode> {
  const userId = await readSessionUserId();
  if (!userId) redirect('/login');

  return (
    <div className="flex h-dvh bg-background">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
