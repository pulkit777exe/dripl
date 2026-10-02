import { NextResponse } from 'next/server';
import { isSnapshotId, readSnapshotData } from '../_lib/snapshotStore';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  // Unknown and malformed ids answer identically, so this route does not
  // confirm which ids exist.
  if (!isSnapshotId(id)) {
    return NextResponse.json({ error: 'Snapshot not found.' }, { status: 404 });
  }

  let data: string | null;
  try {
    data = await readSnapshotData(id);
  } catch {
    // Storage being unreachable is not the same claim as "no such snapshot".
    // Answering 404 here would hide exactly the class of outage this route
    // was rewritten to make visible.
    return NextResponse.json({ error: 'Unable to load snapshot.' }, { status: 500 });
  }

  // `readSnapshotData` filters `expiresAt > now`, so a null here is either an
  // unknown id or an expired one. Both are a 404, exactly as before.
  if (data === null) {
    return NextResponse.json({ error: 'Snapshot not found.' }, { status: 404 });
  }
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
