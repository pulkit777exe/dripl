import { NextResponse } from 'next/server';

type SnapshotRecord = {
  data: string;
  createdAt: number;
  expiresAt: number;
};

declare global {
  var __driplCanvasSnapshots: Map<string, SnapshotRecord> | undefined;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{1,80}$/i.test(id)) {
    return NextResponse.json({ error: 'Snapshot not found.' }, { status: 404 });
  }
  const store = globalThis.__driplCanvasSnapshots;
  const record = store?.get(id);
  if (!record || record.expiresAt <= Date.now()) {
    store?.delete(id);
    return NextResponse.json({ error: 'Snapshot not found.' }, { status: 404 });
  }
  return NextResponse.json({ data: record.data }, { headers: { 'Cache-Control': 'no-store' } });
}
