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

export async function GET(request: NextRequest) {
  // Version-history listing. canvasId is REQUIRED: snapshots carry no
  // ownership, so an unfiltered list would enumerate every canvas's
  // snapshot ids. Metadata only — scene bytes stay behind the per-id GET.
  // Mirrors the [id] route (no origin gate; read-only and no-store) rather
  // than POST.
  const canvasId = request.nextUrl.searchParams.get('canvasId');
  if (!canvasId || canvasId.length > MAX_CANVAS_ID_LENGTH) {
    return NextResponse.json({ error: 'canvasId query parameter is required.' }, { status: 400 });
  }
  if (!(await allowSnapshotRequest(request))) {
    return NextResponse.json({ error: 'Too many snapshot requests' }, { status: 429 });
  }

  try {
    const snapshots = await listSnapshotSummaries(canvasId);
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
      ...(typeof body.canvasId === 'string' ? { canvasId: body.canvasId } : {}),
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
