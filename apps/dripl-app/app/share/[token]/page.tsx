import { serverApiGet, ServerApiError } from '@/lib/server/api';
import { SharedCanvasRoute } from '@/components/canvas/SharedCanvasRoute';
import { notFound } from 'next/navigation';
import type { SharedFileResponse } from '@/lib/api';

interface SharePageProps {
  params: Promise<{
    token: string;
  }>;
}

/**
 * A share link, resolved on the server.
 *
 * The recipient of a share link sees this page once, cold, usually from
 * somewhere they did not expect to be. It used to ship a centred spinner and
 * only then fetch `/share/:token` from the browser, so the first thing the page
 * ever contained was `<Spinner className="size-6" />`.
 *
 * Resolving the token here means the file name, the permission and the
 * view-only badge are in the first HTML response. Decryption stays in the
 * browser — the key lives in the URL fragment, which never reaches a server —
 * so `components/canvas/SharedCanvasRoute.tsx` finishes the job after hydration.
 *
 * Two properties this route must keep, and does:
 *
 * - **No session is sent.** The share token is the capability; forwarding a
 *   session cookie would widen what the upstream sees for no benefit. The call is
 *   made with `token: null`.
 * - **No response is cacheable.** The upstream sets `Cache-Control: no-store` on
 *   this body, and the page reads the cookie jar for dynamic rendering, so
 *   Next emits `private, no-cache, no-store` for the HTML too. A shared canvas
 *   is somebody's content; it must not sit in a CDN.
 */
export default async function SharedCanvasPage({
  params,
}: SharePageProps): Promise<React.ReactNode> {
  const { token } = await params;

  let share: SharedFileResponse;
  try {
    share = await serverApiGet<SharedFileResponse>(`/share/${encodeURIComponent(token)}`, {
      token: null,
      cache: 'no-store',
    });
  } catch (error) {
    // 404 and 410 are the two the upstream defines for "this link does not work":
    // absent, or expired. Both are a missing resource from here, and both render
    // the same 404, so a revoked link and an expired one are indistinguishable
    // from the outside — which is what a capability link needs.
    if (error instanceof ServerApiError && (error.status === 404 || error.status === 410)) {
      notFound();
    }
    // Anything else is an upstream failure. Re-throwing hands it to
    // `app/error.tsx`, which is more honest than rendering "link not found" for
    // a 500 the user did not cause.
    throw error;
  }

  return <SharedCanvasRoute token={token} share={share} />;
}
