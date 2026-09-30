import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { DriplElementSchema, MAX_SCENE_ELEMENTS } from '@dripl/common';
import { z } from 'zod';
import { readRequestBody, RequestBodyTooLargeError } from '@/lib/server/requestBody';
import { hasAllowedOrigin } from '@/lib/server/origin';

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOTS = 500;
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_MINUTE = 30;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Local view of the snapshot store. The canonical declaration lives in
 * [id]/route.ts (untouched on purpose — that file has an in-flight
 * refactor next door); this widens it with the optional owning canvas
 * without redeclaring the shared global, which would collide (TS2403).
 * Extra fields ride the same records harmlessly at runtime.
 */
type ScopedSnapshotRecord = {
  data: string;
  createdAt: number;
  expiresAt: number;
  /** Owning canvas/file slug. Absent on records created before scoped
   * snapshots existed; those never appear in filtered lists. */
  canvasId?: string;
};

function getStore(): Map<string, ScopedSnapshotRecord> {
  const store = globalThis.__driplCanvasSnapshots as Map<string, ScopedSnapshotRecord> | undefined;
  if (!store) {
    const created = new Map<string, ScopedSnapshotRecord>();
    (globalThis.__driplCanvasSnapshots as unknown as Map<string, ScopedSnapshotRecord>) = created;
    return created;
  }
  return store;
}

function pruneStore(store: Map<string, ScopedSnapshotRecord>): boolean {
  const now = Date.now();
  for (const [id, record] of store) {
    if (record.expiresAt <= now) store.delete(id);
  }
  return store.size < MAX_SNAPSHOTS;
}

function allowRequest(request: NextRequest): boolean {
  const now = Date.now();
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip =
    process.env.TRUST_PROXY === 'true'
      ? forwarded?.split(',')[0]?.trim() || realIp || 'anonymous'
      : 'anonymous';
  const current = requestCounts.get(ip);
  if (!current || current.resetAt <= now) {
    if (requestCounts.size >= 10_000) {
      const oldest = requestCounts.keys().next().value;
      if (oldest) requestCounts.delete(oldest);
    }
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
}

export async function GET(request: NextRequest) {
  // Version-history listing. canvasId is REQUIRED: snapshots carry no
  // ownership, so an unfiltered list would enumerate every canvas's
  // snapshot ids process-wide. Metadata only — scene bytes stay behind
  // the per-id GET. Mirrors the [id] route (no origin gate; read-only and
  // no-store) rather than POST.
  const canvasId = request.nextUrl.searchParams.get('canvasId');
  if (!canvasId || canvasId.length > 200) {
    return NextResponse.json({ error: 'canvasId query parameter is required.' }, { status: 400 });
  }
  if (!allowRequest(request)) {
    return NextResponse.json({ error: 'Too many snapshot requests' }, { status: 429 });
  }

  const store = getStore();
  const now = Date.now();
  const snapshots: Array<{ id: string; canvasId: string; createdAt: number; expiresAt: number }> =
    [];
  for (const [id, record] of store) {
    if (record.expiresAt <= now) {
      store.delete(id);
      continue;
    }
    if (record.canvasId !== canvasId) continue;
    snapshots.push({
      id,
      canvasId: record.canvasId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ snapshots }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
  }
  if (!allowRequest(request)) {
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
        body.canvasId.length > 200)
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

    const store = getStore();
    if (!pruneStore(store)) {
      return NextResponse.json(
        { error: 'Snapshot capacity reached; try again later.' },
        { status: 503 }
      );
    }
    const id = randomUUID();
    const now = Date.now();
    store.set(id, {
      data: JSON.stringify(elements.data),
      createdAt: now,
      expiresAt: now + SNAPSHOT_TTL_MS,
      ...(body.canvasId !== undefined ? { canvasId: body.canvasId } : {}),
    });
    return NextResponse.json({ id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Snapshot too large.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Unable to create snapshot.' }, { status: 500 });
  }
}
