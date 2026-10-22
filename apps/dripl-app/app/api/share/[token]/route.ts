import { NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/server/api-base-url';

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;

  try {
    const response = await fetch(`${apiBaseUrl()}/share/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Share service unavailable' }, { status: 503 });
  }
}
