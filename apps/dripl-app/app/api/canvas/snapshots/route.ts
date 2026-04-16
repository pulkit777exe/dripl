import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

type SnapshotRecord = {
  data: string;
  createdAt: number;
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { data?: string };
    if (!body?.data || typeof body.data !== 'string') {
      return NextResponse.json({ error: 'Invalid snapshot payload.' }, { status: 400 });
    }
    const id = randomUUID();
    getStore().set(id, { data: body.data, createdAt: Date.now() });
    return NextResponse.json({ id });
  } catch {
    return NextResponse.json({ error: 'Unable to create snapshot.' }, { status: 500 });
  }
}
