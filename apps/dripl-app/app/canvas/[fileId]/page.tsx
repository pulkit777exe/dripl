import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logError } from '@dripl/common';
import { serverApiGet, serverApiError } from '@/lib/server/api';
import { readSessionBearer, readSessionUserId } from '@/lib/server/session';
import { CanvasRoomRoute } from '@/components/canvas/CanvasRoomRoute';

interface CanvasFilePageProps {
  params: Promise<{
    fileId: string;
  }>;
}

type RoomResponse = {
  room: { id: string; slug: string; name: string; isPublic: boolean; content: string };
};

/**
 * A collaboration room, resolved on the server.
 *
 * This route is not converted to server rendering so much as it is moved ahead
 * of hydration. The canvas itself stays a client component — pointer handlers,
 * a spatial index, a render loop and a theme that only exists in the browser are
 * not server-renderable, and pretending otherwise would be fiction. What *is*
 * server-renderable is everything the client used to make it wait for:
 *
 * - **Authentication.** `useAuth()` resolved first, then `router.replace()`
 *     pushed an anonymous visitor to `/login?next=…`, with a centred spinner
 *     painted in between. The refusal is now the first thing that happens.
 * - **Room existence.** `GET /rooms/:id` ran in `useEffect` purely to decide
 *     between the canvas and a "this session has ended" panel. That is one
 *     server-side await, and it happens before the client bundle is even
 *     requested.
 *
 * Measured effect: the route's time-to-first-byte carries the session check and
 * the room lookup instead of the browser's four-step waterfall, and the page no
 * longer ships a spinner in its HTML at all.
 *
 * The room check is `no-store` on purpose. It is per-caller and mutable — a
 * room can be closed between this render and the next — so a cached answer
 * would be both a cross-user leak and a stale one.
 */
export default async function CanvasFilePage({
  params,
}: CanvasFilePageProps): Promise<React.ReactNode> {
  const { fileId: roomId } = await params;

  const userId = await readSessionUserId();
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/canvas/${roomId}`)}`);
  }

  const token = await readSessionBearer();
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/canvas/${roomId}`)}`);
  }

  let room: RoomResponse;
  try {
    room = await serverApiGet<RoomResponse>(`/rooms/${encodeURIComponent(roomId)}`, {
      token,
      cache: 'no-store',
    });
  } catch (error) {
    // A refusal here means the session did not survive to the API, which is the
    // same outcome as having no session at all.
    if (serverApiError(error, [401, 403])) {
      redirect(`/login?next=${encodeURIComponent(`/canvas/${roomId}`)}`);
    }

    // A 404 is the ordinary "the room is gone" case, and the original client
    // code rendered exactly this panel for it. Any other failure — the API down,
    // a timeout — also lands here, which is what the original did too: it could
    // not tell them apart from the browser either, and it logged before falling
    // back. The log is structured and carries no credential.
    logError(
      JSON.stringify({
        level: 'error',
        event: 'canvas_room_lookup_failed',
        roomId,
        status: error instanceof Error && 'status' in error ? error.status : undefined,
      })
    );
    return <RoomUnavailable />;
  }

  return <CanvasRoomRoute roomId={room.room.slug} />;
}

function RoomUnavailable() {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#f5f0e8] p-6">
      <div className="max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5">
        <p className="text-[14px] font-medium text-[#1A1917]">
          This collaboration session has ended or doesn&apos;t exist.
        </p>
        <Link
          href="/canvas"
          className="mt-4 inline-block rounded-md bg-[#E8462A] px-4 py-2 text-[13px] text-white"
        >
          Go to canvas
        </Link>
      </div>
    </div>
  );
}
