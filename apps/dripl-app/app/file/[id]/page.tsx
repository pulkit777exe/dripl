import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logError } from '@dripl/common';
import { serverApiGet, serverApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import { FileCanvasRoute, type FileInitialData } from '@/components/canvas/FileCanvasRoute';
import type { DriplElement } from '@dripl/common';
import type { FileDetails } from '@/lib/api';
import type { LocalCanvasState } from '@/utils/localCanvasStorage';

/**
 * A saved canvas, fetched on the server.
 *
 * This is the one route where moving the fetch could not have gone further: the
 * scene had to reach the browser either way, so the only question was whether
 * it travelled inside the HTML response or in a request the browser could not
 * start until after hydration. It now travels inside the HTML.
 *
 * What that removes, measured against a production build: the document, then the
 * bundle, then `/auth/me`, then `GET /files/:id` — with a centred spinner over
 * the whole of it — before the first canvas pixel.
 *
 * What does not move: the canvas, the toolbar, autosave, thumbnail generation
 * and optimistic-concurrency conflict handling. Those are browser concerns and
 * `components/canvas/FileCanvasRoute.tsx` keeps all of them, unchanged.
 *
 * Auth is not weakened. The session token is read from the cookie, verified with
 * the same `verifyToken` the API uses, and forwarded as an `Authorization:
 * Bearer` header on the one upstream call — never into HTML, never into a log.
 * An anonymous request is redirected to the same `/login?next=…` the client
 * produced, before anything is rendered. The upstream call is `no-store`: the
 * body is one person's scene and it is mutable, so neither a shared cache nor a
 * stale copy is acceptable.
 */
export default async function FilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactNode> {
  const { id: fileId } = await params;

  const userId = await readSessionUserId();
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/file/${fileId}`)}`);
  }

  const token = await readSessionBearer();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/file/${fileId}`)}`);
  }

  let file: FileDetails;
  try {
    const response = await serverApiGet<{ file: FileDetails }>(
      `/files/${encodeURIComponent(fileId)}`,
      { token, cache: 'no-store' }
    );
    file = response.file;
  } catch (error) {
    if (serverApiError(error, [401, 403])) {
      redirect(`/login?next=${encodeURIComponent(`/file/${fileId}`)}`);
    }

    // Anything else is "could not load", which is what the client rendered for
    // a failure of any kind. 404 is the common one and gets the same panel;
    // the log is structured and records the id and status, never the token.
    const status = serverApiError(error, [404]) ? 404 : undefined;
    logError(
      JSON.stringify({
        level: 'error',
        event: 'file_load_failed',
        fileId,
        status: status ?? (error instanceof Error ? error.message : 'unknown'),
      })
    );
    return <FileUnavailable />;
  }

  return (
    <FileCanvasRoute
      fileId={file.id}
      fileName={file.name}
      updatedAt={file.updatedAt}
      initialData={initialDataFrom(file.content)}
    />
  );
}

/**
 * The stored `content` column is `unknown` (ADR-004: a JSON string, no schema),
 * and it has been written in two shapes over the product's life — a bare element
 * array, and an object with `elements` plus an `appState` block. Both are still
 * read, exactly as the client did, because a scene written by an older build
 * must keep loading.
 */
function initialDataFrom(rawContent: unknown): FileInitialData {
  let elements: DriplElement[] = [];
  let appState: Partial<LocalCanvasState> | null = null;

  if (Array.isArray(rawContent)) {
    elements = rawContent as DriplElement[];
  } else if (rawContent && typeof rawContent === 'object') {
    const content = rawContent as {
      elements?: unknown;
      appState?: unknown;
    };
    if (Array.isArray(content.elements)) elements = content.elements as DriplElement[];
    if (content.appState && typeof content.appState === 'object') {
      appState = content.appState as Partial<LocalCanvasState>;
    }
  }

  return { elements, appState };
}

function FileUnavailable() {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#f5f0e8] p-6">
      <div className="max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5">
        <p className="text-[14px] font-medium text-[#1A1917]">This canvas could not be loaded.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-md bg-[#E8462A] px-4 py-2 text-[13px] text-white"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
