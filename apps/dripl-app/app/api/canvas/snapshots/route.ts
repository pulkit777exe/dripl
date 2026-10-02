import { NextRequest, NextResponse } from 'next/server';
import { DriplElementSchema, MAX_SCENE_ELEMENTS } from '@dripl/common';
import { z } from 'zod';
import { readRequestBody, RequestBodyTooLargeError } from '@/lib/server/requestBody';
import { hasAllowedOrigin } from '@/lib/server/origin';
import {
  MAX_CANVAS_ID_LENGTH,
  MAX_SNAPSHOT_BYTES,
  createSnapshot,
  listSnapshotSummaries,
} from './_lib/snapshotStore';
import { allowSnapshotRequest } from './_lib/snapshotRateLimit';
import { resolveOwnedCanvasId } from './_lib/snapshotAccess';
import { denySnapshotAccess, getSnapshotCaller, snapshotAccessCheckFailed } from './_lib/session';

/**
 * Resolve a caller-supplied slug to a canvas they own, or the denial to send
 * instead. Both refusals are one answer by construction: `resolveOwnedCanvasId`
 * filters on `{ id, userId }` in the query, so a canvas that does not exist and
 * a canvas owned by somebody else return the same `null` and take the same
 * branch here.
 */
async function authorizeCanvas(
  canvasId: string,
  userId: string,
  event: string
): Promise<{ owned: true; canvasId: string } | { owned: false; response: NextResponse }> {
  try {
    const ownedId = await resolveOwnedCanvasId(canvasId, userId);
    if (ownedId === null) {
      return { owned: false, response: denySnapshotAccess(canvasId, userId, event) };
    }
    return { owned: true, canvasId: ownedId };
  } catch {
    return { owned: false, response: snapshotAccessCheckFailed(event, userId) };
  }
}

export async function GET(request: NextRequest) {
  // Version-history listing, and the only route here that enumerates. canvasId
  // is REQUIRED, and owning it is required too: a list is a directory of ids,
  // not a share, so handing it out on a guessed slug would turn every share
  // link's canvas into an enumeration oracle. Metadata only — scene bytes stay
  // behind the per-id GET. Mirrors the [id] route (no origin gate; read-only
  // and no-store) rather than POST.
  const canvasId = request.nextUrl.searchParams.get('canvasId');
  if (!canvasId || canvasId.length > MAX_CANVAS_ID_LENGTH) {
    return NextResponse.json({ error: 'canvasId query parameter is required.' }, { status: 400 });
  }
  if (!(await allowSnapshotRequest(request))) {
    return NextResponse.json({ error: 'Too many snapshot requests' }, { status: 429 });
  }

  // Identity before existence. `getSnapshotCaller` never touches storage, so
  // the 401 for a caller with no credential is byte- and timing-identical for a
  // real canvas and a made-up one.
  const caller = getSnapshotCaller(request);
  if (!caller.authorized) return caller.response;

  const access = await authorizeCanvas(canvasId, caller.userId, 'snapshot_list_denied');
  if (!access.owned) return access.response;

  try {
    const snapshots = await listSnapshotSummaries(access.canvasId);
    return NextResponse.json({ snapshots }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // A storage failure must not masquerade as "this canvas has no versions",
    // which is the 200-with-an-empty-list answer below.
    return NextResponse.json({ error: 'Unable to list snapshots.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
  }
  if (!(await allowSnapshotRequest(request))) {
    return NextResponse.json({ error: 'Too many snapshot requests' }, { status: 429 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SNAPSHOT_BYTES + 16_384) {
    return NextResponse.json({ error: 'Snapshot too large.' }, { status: 413 });
  }

  try {
    const raw = await readRequestBody(request, MAX_SNAPSHOT_BYTES);
    if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json({ error: 'Snapshot too large.' }, { status: 413 });
    }
    const body = JSON.parse(raw) as { data?: unknown; canvasId?: unknown };
    if (typeof body?.data !== 'string' || body.data.length === 0) {
      return NextResponse.json({ error: 'Invalid snapshot payload.' }, { status: 400 });
    }
    if (
      body.canvasId !== undefined &&
      (typeof body.canvasId !== 'string' ||
        body.canvasId.length === 0 ||
        body.canvasId.length > MAX_CANVAS_ID_LENGTH)
    ) {
      return NextResponse.json({ error: 'Invalid snapshot payload.' }, { status: 400 });
    }

    // Scoping a snapshot to a canvas is the version-history feature, and it
    // writes into that canvas's owner-visible state: it consumes their live
    // capacity and shows up in their version list. So a supplied `canvasId`
    // must be resolved to a canvas this caller owns before anything is
    // written. Authorisation sits here — after the cheap origin, rate-limit and
    // size gates, before the scene is parsed and before `createSnapshot` —
    // because `canvasId` only exists inside the body. A caller who fails this
    // gate gets the same 401/403 for a real canvas and a made-up one, because
    // the lookup filters on `{ id, userId }` and returns `null` for both.
    //
    // An absent `canvasId` stays anonymous on purpose (see the comment above
    // `createSnapshot` for why), so this block is the only credential
    // requirement on the write path.
    let scopedCanvasId: string | undefined;
    if (typeof body.canvasId === 'string') {
      const caller = getSnapshotCaller(request);
      if (!caller.authorized) return caller.response;

      const access = await authorizeCanvas(body.canvasId, caller.userId, 'snapshot_create_denied');
      if (!access.owned) return access.response;
      scopedCanvasId = access.canvasId;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(body.data);
    } catch {
      return NextResponse.json({ error: 'Invalid snapshot payload.' }, { status: 400 });
    }
    const elements = z.array(DriplElementSchema).max(MAX_SCENE_ELEMENTS).safeParse(decoded);
    if (!elements.success) {
      return NextResponse.json({ error: 'Invalid snapshot payload.' }, { status: 400 });
    }

    const serialized = JSON.stringify(elements.data);
    // The request-body cap bounds the envelope; this bounds the serialized
    // scene that actually lands in the column, and mirrors the
    // `CanvasSnapshot_data_bytes` CHECK constraint on the table.
    if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json({ error: 'Snapshot too large.' }, { status: 413 });
    }

    const result = await createSnapshot({
      data: serialized,
      // The id is the one `File.id` the ownership lookup returned, not the
      // string the client sent: by this point the two are equal, and passing
      // the resolved value keeps the stored binding to a real record even if
      // the input were ever normalised upstream.
      ...(scopedCanvasId !== undefined ? { canvasId: scopedCanvasId } : {}),
    });
    if (result.status === 'capacity') {
      return NextResponse.json(
        { error: 'Snapshot capacity reached; try again later.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ id: result.id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Snapshot too large.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Unable to create snapshot.' }, { status: 500 });
  }
}
