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

type SnapshotRecord = {
  data: string;
  createdAt: number;
  expiresAt: number;
};

declare global {
  var __driplCanvasSnapshots: Map<string, SnapshotRecord> | undefined;
}

function getStore(): Map<string, SnapshotRecord> {
  if (!globalThis.__driplCanvasSnapshots) {
    globalThis.__driplCanvasSnapshots = new Map();
  }
  return globalThis.__driplCanvasSnapshots;
}

function pruneStore(store: Map<string, SnapshotRecord>): boolean {
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
    const body = JSON.parse(raw) as { data?: unknown };
    if (typeof body?.data !== 'string' || body.data.length === 0) {
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
    });
    return NextResponse.json({ id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Snapshot too large.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Unable to create snapshot.' }, { status: 500 });
  }
}
