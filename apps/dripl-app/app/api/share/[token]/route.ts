import { NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ token: string }>;
}

function apiBaseUrl(): string {
  const configured =
    process.env.API_SERVER_URL ??
    process.env.HTTP_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3002';
  const base = configured.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
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
