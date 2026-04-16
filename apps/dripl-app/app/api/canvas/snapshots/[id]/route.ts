import { NextResponse } from 'next/server';

declare global {
  var __driplCanvasSnapshots:
    | Map<string, { data: string; createdAt: number }>
    | undefined;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const record = globalThis.__driplCanvasSnapshots?.get(id);
  if (!record) {
    return NextResponse.json({ error: 'Snapshot not found.' }, { status: 404 });
  }
  return NextResponse.json({ data: record.data });
}
